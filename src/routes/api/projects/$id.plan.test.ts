import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level regression coverage for the bug fixed in this incident (see
// docs/build-with-ai-stuck-project-incident.md): the preview-guard and
// rate-limit early-return paths in POST /api/projects/:id/plan must persist
// a real 'failed' state via fail_ai_project_planning before returning their
// error — otherwise the project is left indistinguishable from "still
// planning" forever. Mocks the auth/guard/rate-limit seams the same way
// routes/api/generate-ai.test.ts mocks createClient — this route builds its
// Supabase client via authenticate() -> createClient(), with no other
// dependency-injection point.

vi.mock("@/lib/ai/preview-guard.server", () => ({
  isPreviewEnvironment: vi.fn(() => mockIsPreview),
  checkAiExecutionAllowed: vi.fn(() => mockGuardResult),
}));
vi.mock("@/lib/rate-limit.server", () => ({
  claimPlanRateLimit: vi.fn(() => mockRateLimitResult()),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/projects/planner.server", () => ({
  generateProjectPlan: vi.fn(),
  PlannerError: class PlannerError extends Error {
    code = "provider_error";
  },
}));

let mockIsPreview = false;
let mockGuardResult:
  { allowed: true } | { allowed: false; status: 403 | 503; code: string; message: string } = {
  allowed: true,
};
let mockRateLimitAllowed = true;
function mockRateLimitResult() {
  if (!mockRateLimitAllowed) {
    return Promise.resolve({
      allowed: false,
      remaining: 0,
      resetAt: new Date().toISOString(),
      dailyRemaining: 0,
    });
  }
  return Promise.resolve({
    allowed: true,
    remaining: 4,
    resetAt: new Date().toISOString(),
    dailyRemaining: 19,
  });
}

let mockSupabase: ReturnType<typeof createMockSupabase>;
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

const { Route } = await import("@/routes/api/projects/$id.plan");
const handler = (
  Route.options.server as {
    handlers: { POST: (ctx: { request: Request; params: { id: string } }) => Promise<Response> };
  }
).handlers.POST;

type ProjectRow = {
  id: string;
  status: string;
  original_idea: string;
  objective: string | null;
  target_audience: string | null;
  language: string;
  plan_json: unknown;
};

function createMockSupabase(project: ProjectRow) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const rpc = vi.fn((name: string, args?: unknown) => {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  });

  function makeQuery(table: string) {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () => {
        if (table === "ai_projects") return Promise.resolve({ data: project, error: null });
        if (table === "users") return Promise.resolve({ data: { role: "user" }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  }

  return {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (table: string) => makeQuery(table),
    rpc,
    rpcCalls,
  };
}

function makeRequest() {
  return new Request("https://example.com/api/projects/proj-1/plan", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
}

const baseProject: ProjectRow = {
  id: "proj-1",
  status: "planning",
  original_idea: "Quiero una campaña para mi sitio web",
  objective: null,
  target_audience: null,
  language: "es",
  plan_json: null,
};

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  mockIsPreview = false;
  mockGuardResult = { allowed: true };
  mockRateLimitAllowed = true;
  mockSupabase = createMockSupabase({ ...baseProject });
});

describe("POST /api/projects/:id/plan — preview guard rejection", () => {
  it("persists a failed state via fail_ai_project_planning instead of leaving the project stuck in 'planning'", async () => {
    mockIsPreview = true;
    mockGuardResult = {
      allowed: false,
      status: 403,
      code: "ai_restricted_in_preview",
      message:
        "La generación con IA en este entorno de preview está restringida a la cuenta de QA.",
    };

    const res = await handler({ request: makeRequest(), params: { id: "proj-1" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ai_restricted_in_preview");

    const failCall = mockSupabase.rpcCalls.find((c) => c.name === "fail_ai_project_planning");
    expect(failCall).toBeDefined();
    expect(failCall?.args).toMatchObject({
      p_project_id: "proj-1",
      p_error_code: "ai_restricted_in_preview",
    });
  });

  it("also persists a failed state for the kill-switch-off rejection", async () => {
    mockIsPreview = true;
    mockGuardResult = {
      allowed: false,
      status: 503,
      code: "ai_disabled_in_preview",
      message: "La generación con IA está deshabilitada en este entorno de preview.",
    };

    const res = await handler({ request: makeRequest(), params: { id: "proj-1" } });
    expect(res.status).toBe(503);

    const failCall = mockSupabase.rpcCalls.find((c) => c.name === "fail_ai_project_planning");
    expect(failCall?.args).toMatchObject({ p_error_code: "ai_disabled_in_preview" });
  });
});

describe("POST /api/projects/:id/plan — rate limit rejection", () => {
  it("persists a failed state via fail_ai_project_planning instead of leaving the project stuck in 'planning'", async () => {
    mockRateLimitAllowed = false;

    const res = await handler({ request: makeRequest(), params: { id: "proj-1" } });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("rate_limited");

    const failCall = mockSupabase.rpcCalls.find((c) => c.name === "fail_ai_project_planning");
    expect(failCall).toBeDefined();
    expect(failCall?.args).toMatchObject({ p_project_id: "proj-1", p_error_code: "rate_limited" });
  });
});

describe("POST /api/projects/:id/plan — not-plannable state (regression guard)", () => {
  it("returns 409 without ever calling fail_ai_project_planning when the project isn't in a plannable state", async () => {
    mockSupabase = createMockSupabase({ ...baseProject, status: "completed" });

    const res = await handler({ request: makeRequest(), params: { id: "proj-1" } });
    expect(res.status).toBe(409);

    const failCall = mockSupabase.rpcCalls.find((c) => c.name === "fail_ai_project_planning");
    expect(failCall).toBeUndefined();
  });
});

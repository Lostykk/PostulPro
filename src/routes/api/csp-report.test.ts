import { describe, it, expect, vi, afterEach } from "vitest";
import { Route } from "@/routes/api/csp-report";

const handler = (Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } })
  .handlers.POST;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("returns 204 and logs the safe fields from a well-formed report", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("https://preview.example/api/csp-report", {
      method: "POST",
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "https://preview.example/dashboard",
          "violated-directive": "script-src",
          "blocked-uri": "https://evil.example/x.js",
          disposition: "report",
        },
      }),
    });

    const res = await handler({ request });

    expect(res.status).toBe(204);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      scope: "csp_report",
      documentUri: "https://preview.example/dashboard",
      violatedDirective: "script-src",
      blockedUri: "https://evil.example/x.js",
      disposition: "report",
    });
  });

  it("returns 204 without throwing on malformed JSON", async () => {
    const request = new Request("https://preview.example/api/csp-report", {
      method: "POST",
      body: "not json",
    });

    const res = await handler({ request });
    expect(res.status).toBe(204);
  });

  it("returns 204 and logs nothing when csp-report key is absent", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("https://preview.example/api/csp-report", {
      method: "POST",
      body: JSON.stringify({ unrelated: true }),
    });

    const res = await handler({ request });
    expect(res.status).toBe(204);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

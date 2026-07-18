import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Variable must be prefixed "mock" — Vitest only allows vi.mock() factories
// to close over outer-scope identifiers matching that naming convention
// (everything else is hoisted above its declaration and hits a TDZ/"is not
// a constructor" error).
const mockSend = vi.fn();

vi.mock("resend", () => ({
  // Must be a real `function`, not an arrow function: arrow functions have
  // no [[Construct]] slot, so `new Resend(key)` in resend.server.ts would
  // throw "is not a constructor" regardless of how the mock is wired up.
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: mockSend } };
  }),
}));

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  vi.resetModules();
  mockSend.mockReset();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

describe("sendWelcomeEmail — missing/invalid secret", () => {
  it("throws a clear error when RESEND_API_KEY is not configured (secret ausente)", async () => {
    delete process.env.RESEND_API_KEY;
    const { sendWelcomeEmail } = await import("./resend.server");
    await expect(sendWelcomeEmail("qa@example.test", "QA", "https://preview.test")).rejects.toThrow(
      "RESEND_API_KEY not configured",
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("sendWelcomeEmail — sender is fixed and on the verified domain", () => {
  it("never lets the caller control the from address", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const { sendWelcomeEmail } = await import("./resend.server");
    await sendWelcomeEmail("qa@example.test", "QA", "https://preview.test");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [payload] = mockSend.mock.calls[0] as [{ from: string; to: string }];
    expect(payload.from).toBe("PostulPro <notificaciones@auth.postulpro.com>");
    expect(payload.to).toBe("qa@example.test");
  });

  it("includes both html and text bodies", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const { sendWelcomeEmail } = await import("./resend.server");
    await sendWelcomeEmail("qa@example.test", "QA", "https://preview.test");
    const [payload] = mockSend.mock.calls[0] as [{ html: string; text: string }];
    expect(payload.html).toContain("<html");
    expect(payload.text.length).toBeGreaterThan(0);
  });

  it("builds the CTA link from the given origin, never a hardcoded domain", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const { sendWelcomeEmail } = await import("./resend.server");
    await sendWelcomeEmail(
      "qa@example.test",
      "QA",
      "https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev",
    );
    const [payload] = mockSend.mock.calls[0] as [{ html: string }];
    expect(payload.html).toContain(
      "https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/dashboard",
    );
  });
});

describe("sendEmail — error handling never leaks the secret", () => {
  it("wraps a Resend API error without including the API key", async () => {
    process.env.RESEND_API_KEY = "sk_super_secret_value_should_never_appear";
    mockSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `from` field" },
    });
    const { sendWelcomeEmail } = await import("./resend.server");
    let caught: unknown;
    try {
      await sendWelcomeEmail("qa@example.test", "QA", "https://preview.test");
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).toContain("validation_error");
    expect(String(caught)).not.toContain("sk_super_secret_value_should_never_appear");
  });
});

describe("sendEmail — idempotency key passthrough", () => {
  it("forwards a provided idempotency key to the Resend client", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const { sendWelcomeEmail } = await import("./resend.server");
    await sendWelcomeEmail("qa@example.test", "QA", "https://preview.test", "welcome/user-123");
    const [, options] = mockSend.mock.calls[0] as [unknown, { idempotencyKey?: string }];
    expect(options?.idempotencyKey).toBe("welcome/user-123");
  });

  it("omits the idempotency option entirely when no key is given", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const { sendProConfirmationEmail } = await import("./resend.server");
    await sendProConfirmationEmail("qa@example.test", "pro");
    const [, options] = mockSend.mock.calls[0] as [unknown, unknown];
    expect(options).toBeUndefined();
  });
});

describe("sendEmail — no built-in retry loop", () => {
  it("calls the Resend client exactly once per invocation, even on failure", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mockSend.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "429" },
    });
    const { sendLowCreditsEmail } = await import("./resend.server");
    await expect(
      sendLowCreditsEmail("qa@example.test", 10, "https://preview.test"),
    ).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("sendEmail — timeout", () => {
  it("rejects if the Resend call never resolves within the timeout window", async () => {
    process.env.RESEND_API_KEY = "test-key";
    vi.useFakeTimers();
    mockSend.mockImplementation(() => new Promise(() => {})); // never resolves
    const { sendPaymentFailedEmail } = await import("./resend.server");
    const pending = sendPaymentFailedEmail("qa@example.test");
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(11_000);
    await assertion;
    vi.useRealTimers();
  });
});

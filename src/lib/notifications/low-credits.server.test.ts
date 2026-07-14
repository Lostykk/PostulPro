import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { maybeSendLowCreditsEmail } from "./low-credits.server";
import * as resendModule from "@/lib/resend.server";

const ORIGINAL_THRESHOLD = process.env.LOW_CREDITS_THRESHOLD_PERCENT;

function mockSupabase(
  usersRow: { email: string; notify_email: boolean } | null,
  claimResult: boolean,
) {
  const rpc = vi.fn().mockResolvedValue({ data: claimResult, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: usersRow, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { rpc, from } as unknown as Parameters<typeof maybeSendLowCreditsEmail>[0] & {
    rpc: typeof rpc;
    from: typeof from;
  };
}

beforeEach(() => {
  delete process.env.LOW_CREDITS_THRESHOLD_PERCENT; // use the 20% default
});
afterEach(() => {
  if (ORIGINAL_THRESHOLD === undefined) delete process.env.LOW_CREDITS_THRESHOLD_PERCENT;
  else process.env.LOW_CREDITS_THRESHOLD_PERCENT = ORIGINAL_THRESHOLD;
  vi.restoreAllMocks();
});

describe("maybeSendLowCreditsEmail — saldo por encima del umbral", () => {
  it("does not query the profile or send anything", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    await maybeSendLowCreditsEmail(supabase, "user-1", 5, 20, 100, "https://preview.test");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("maybeSendLowCreditsEmail — cruce del umbral", () => {
  it("claims the slot and sends once when the profile has a confirmed opt-in email", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail").mockResolvedValue(undefined);
    // before: used 75/100 -> 25% remaining (above 20%); cost 10 -> used 85 -> 15% (below)
    await maybeSendLowCreditsEmail(supabase, "user-1", 10, 85, 100, "https://preview.test");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "claim_notification",
      expect.objectContaining({ p_kind: "low_credits" }),
    );
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      "qa@example.test",
      15,
      "https://preview.test",
      expect.any(String),
    );
  });

  it("does not send when the idempotency slot was already claimed (low-credits duplicado)", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, false);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    await maybeSendLowCreditsEmail(supabase, "user-1", 10, 85, 100, "https://preview.test");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("respects notify_email = false (usuario optó por no recibir notificaciones)", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: false }, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    await maybeSendLowCreditsEmail(supabase, "user-1", 10, 85, 100, "https://preview.test");
    expect(sendSpy).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("does nothing for a profile with no email on file (usuario inexistente/incompleto)", async () => {
    const supabase = mockSupabase(null, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    await maybeSendLowCreditsEmail(supabase, "user-1", 10, 85, 100, "https://preview.test");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("never throws even if the Resend send itself fails (best-effort, doble ejecución segura)", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, true);
    vi.spyOn(resendModule, "sendLowCreditsEmail").mockRejectedValue(new Error("boom"));
    await expect(
      maybeSendLowCreditsEmail(supabase, "user-1", 10, 85, 100, "https://preview.test"),
    ).resolves.toBeUndefined();
  });
});

describe("maybeSendLowCreditsEmail — saldo ya debajo del umbral", () => {
  it("does not re-trigger on a subsequent reservation that stays below", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    // before: used 85/100 -> 15% (already below); cost 5 -> used 90 -> 10%
    await maybeSendLowCreditsEmail(supabase, "user-1", 5, 90, 100, "https://preview.test");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("maybeSendLowCreditsEmail — compra posterior de créditos", () => {
  it("a top-up that pushes remaining back above threshold does not fire on the next small reservation", async () => {
    const supabase = mockSupabase({ email: "qa@example.test", notify_email: true }, true);
    const sendSpy = vi.spyOn(resendModule, "sendLowCreditsEmail");
    // After a credit top-up: limit jumps to 200, used resets low relative to new limit.
    await maybeSendLowCreditsEmail(supabase, "user-1", 5, 20, 200, "https://preview.test");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

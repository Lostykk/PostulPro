import { describe, it, expect } from "vitest";
import { normalizeHotmartPayload, verifyHottok } from "@/lib/hotmart/normalize";

describe("normalizeHotmartPayload", () => {
  it("maps status=approved to purchase_approved", () => {
    expect(normalizeHotmartPayload({ status: "approved" }).eventType).toBe("purchase_approved");
  });

  it("maps status=completed / complete to purchase_approved too", () => {
    expect(normalizeHotmartPayload({ status: "completed" }).eventType).toBe("purchase_approved");
    expect(normalizeHotmartPayload({ status: "complete" }).eventType).toBe("purchase_approved");
  });

  it("maps refunded/partially_refunded to refund", () => {
    expect(normalizeHotmartPayload({ status: "refunded" }).eventType).toBe("refund");
    expect(normalizeHotmartPayload({ status: "partially_refunded" }).eventType).toBe("refund");
  });

  it("maps chargeback/dispute/protested to chargeback", () => {
    expect(normalizeHotmartPayload({ status: "chargeback" }).eventType).toBe("chargeback");
    expect(normalizeHotmartPayload({ status: "dispute" }).eventType).toBe("chargeback");
    expect(normalizeHotmartPayload({ status: "protested" }).eventType).toBe("chargeback");
  });

  it("maps canceled/cancelled to subscription_cancelled", () => {
    expect(normalizeHotmartPayload({ status: "canceled" }).eventType).toBe("subscription_cancelled");
    expect(normalizeHotmartPayload({ status: "cancelled" }).eventType).toBe("subscription_cancelled");
  });

  it("maps expired to subscription_expired", () => {
    expect(normalizeHotmartPayload({ status: "expired" }).eventType).toBe("subscription_expired");
  });

  it("maps delayed/overdue/no_funds/billet_printed/waiting_payment to payment_failed", () => {
    for (const s of ["delayed", "overdue", "no_funds", "billet_printed", "printed_billet", "waiting_payment"]) {
      expect(normalizeHotmartPayload({ status: s }).eventType).toBe("payment_failed");
    }
  });

  it("maps ambiguous in-flight statuses to ignored, never a financial action", () => {
    for (const s of ["blocked", "under_analisys", "processing_transaction", "started", "pre_order"]) {
      expect(normalizeHotmartPayload({ status: s }).eventType).toBe("ignored");
    }
  });

  it("falls back to subscription_status when there is no purchase-level status", () => {
    expect(normalizeHotmartPayload({ subscription_status: "canceled" }).eventType).toBe("subscription_cancelled");
    expect(normalizeHotmartPayload({ subscription_status: "past_due" }).eventType).toBe("payment_failed");
    expect(normalizeHotmartPayload({ subscription_status: "expired" }).eventType).toBe("subscription_expired");
  });

  it("an entirely unrecognized status never defaults to a financial action", () => {
    expect(normalizeHotmartPayload({ status: "some_made_up_status" }).eventType).toBe("unrecognized_shape");
  });

  it("a non-object payload is unrecognized_shape, not a crash", () => {
    expect(normalizeHotmartPayload(null).eventType).toBe("unrecognized_shape");
    expect(normalizeHotmartPayload("a string").eventType).toBe("unrecognized_shape");
    expect(normalizeHotmartPayload(42).eventType).toBe("unrecognized_shape");
  });

  it("field extraction is case-insensitive (both Prod/Off and prod/off resolve)", () => {
    const lower = normalizeHotmartPayload({ status: "approved", prod: "P1", off: "O1" });
    const upper = normalizeHotmartPayload({ status: "approved", Prod: "P1", Off: "O1" });
    expect(lower.productId).toBe("P1");
    expect(lower.offerId).toBe("O1");
    expect(upper.productId).toBe("P1");
    expect(upper.offerId).toBe("O1");
  });

  it("email is trimmed and lowercased", () => {
    expect(normalizeHotmartPayload({ status: "approved", email: "  Buyer@Example.COM  " }).buyerEmail).toBe(
      "buyer@example.com",
    );
  });

  it("creation_date in seconds is converted to an ISO timestamp", () => {
    const seconds = 1732000000; // well below the ms threshold
    const result = normalizeHotmartPayload({ status: "approved", creation_date: seconds });
    expect(result.providerUpdatedAt).toBe(new Date(seconds * 1000).toISOString());
  });

  it("creation_date in milliseconds is converted to an ISO timestamp without double-scaling", () => {
    const ms = 1732000000000;
    const result = normalizeHotmartPayload({ status: "approved", creation_date: ms });
    expect(result.providerUpdatedAt).toBe(new Date(ms).toISOString());
  });

  it("no creation_date field means providerUpdatedAt is null, never a fabricated 'now'", () => {
    const result = normalizeHotmartPayload({ status: "approved" });
    expect(result.providerUpdatedAt).toBeNull();
  });

  it("hottok is extracted from the payload body", () => {
    expect(normalizeHotmartPayload({ status: "approved", hottok: "abc123" }).hottok).toBe("abc123");
  });
});

describe("verifyHottok", () => {
  it("accepts an exact match", () => {
    expect(verifyHottok("secret-value", "secret-value")).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(verifyHottok("wrong", "secret-value")).toBe(false);
  });

  it("rejects null (missing hottok)", () => {
    expect(verifyHottok(null, "secret-value")).toBe(false);
  });

  it("rejects a different-length value without throwing", () => {
    expect(verifyHottok("short", "a-much-longer-secret-value")).toBe(false);
  });
});

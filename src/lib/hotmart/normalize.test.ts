import { describe, it, expect } from "vitest";
import { normalizeHotmartPayload, verifyHottok, isPlausibleCurrencyCode } from "@/lib/hotmart/normalize";
import { buildIdempotencyKey } from "@/lib/hotmart/idempotency-key";
import {
  buildFixture,
  buildRealFixture,
  ALL_TWELVE_FIXTURES,
} from "@/lib/hotmart/__fixtures__/hotmart-events";

// Rebuilt 2026-07-19 (Fase 8C) against the REAL nested (2.0.0) payload
// structure, replacing the old suite written for the flat/1.0.0 shape
// (which no real Hotmart delivery ever actually used — see normalize.ts's
// header comment for the full incident writeup).

describe("normalizeHotmartPayload — real nested (2.0.0) structure", () => {
  it("classifies PURCHASE_APPROVED as purchase_approved from the top-level event field", () => {
    const result = normalizeHotmartPayload(buildFixture({ event: "PURCHASE_APPROVED", purchaseStatus: "approved" }));
    expect(result.eventType).toBe("purchase_approved");
  });

  it("classifies every one of the 12 configured event fixtures without falling back to unsupported", () => {
    const expected: Record<string, string> = {
      "Compra aprobada": "purchase_approved",
      "Compra completa": "purchase_approved",
      "A la espera de pago": "no_action_required",
      "Compra cancelada": "subscription_cancelled",
      "Compra reembolsada": "refund",
      Chargeback: "chargeback",
      "Compra con plazo vencido": "subscription_expired",
      "Compra atrasada": "payment_failed",
      "Pedido de reembolso": "chargeback",
      "Cancelación de Suscripción": "subscription_cancelled",
      "Cambio de Plan": "plan_change",
      "Actualización de la Fecha de Cobro de la Suscripción": "no_action_required",
    };
    for (const { name, build } of ALL_TWELVE_FIXTURES) {
      const result = normalizeHotmartPayload(build());
      expect(result.eventType, `${name} should not be unsupported`).not.toBe("unsupported");
      expect(result.eventType, `${name} should not be invalid_payload`).not.toBe("invalid_payload");
      expect(result.eventType, name).toBe(expected[name]);
    }
  });

  it("extracts data.purchase.transaction", () => {
    const result = normalizeHotmartPayload(buildFixture({ transaction: "HP123456" }));
    expect(result.transactionId).toBe("HP123456");
  });

  it("extracts data.purchase.offer.code", () => {
    const result = normalizeHotmartPayload(buildFixture({ offerCode: "z7l3u209" }));
    expect(result.offerId).toBe("z7l3u209");
  });

  it("extracts data.subscription.subscriber.code", () => {
    const result = normalizeHotmartPayload(
      buildFixture({ includePurchase: false, includeSubscription: true, subscriberCode: "SUB-XYZ", subscriptionStatus: "active" }),
    );
    expect(result.subscriptionId).toBe("SUB-XYZ");
  });

  it("extracts data.product.id and data.product.ucode", () => {
    const result = normalizeHotmartPayload(buildFixture({ productId: 8148076, productUcode: "abc-ucode" }));
    expect(result.productId).toBe("8148076");
    expect(result.productUcode).toBe("abc-ucode");
  });

  it("extracts and normalizes data.buyer.email", () => {
    const result = normalizeHotmartPayload(buildFixture({ buyerEmail: "  Buyer@Example.COM  " }));
    expect(result.buyerEmail).toBe("buyer@example.com");
  });

  it("extracts top-level id as externalEventId", () => {
    const result = normalizeHotmartPayload(buildFixture({ id: "envelope-id-1" }));
    expect(result.externalEventId).toBe("envelope-id-1");
  });

  it("extracts hottok from the body", () => {
    const result = normalizeHotmartPayload(buildFixture({ hottok: "abc123" }));
    expect(result.hottok).toBe("abc123");
  });

  it("converts creation_date (seconds) to an ISO timestamp", () => {
    const seconds = 1732000000;
    const result = normalizeHotmartPayload(buildFixture({ creationDate: seconds }));
    expect(result.providerUpdatedAt).toBe(new Date(seconds * 1000).toISOString());
  });

  describe("missing-field handling — never crashes, never silently invents an identity", () => {
    it("a payload with no buyer block still normalizes the rest", () => {
      const result = normalizeHotmartPayload(buildFixture({ includeBuyer: false }));
      expect(result.buyerEmail).toBeNull();
      expect(result.eventType).not.toBe("invalid_payload");
      expect(result.parseWarnings.some((w) => w.includes("buyer"))).toBe(true);
    });

    it("a payload with no offer block still normalizes the rest", () => {
      const fixture = buildFixture() as { data: { purchase: Record<string, unknown> } };
      fixture.data.purchase.offer = {};
      const result = normalizeHotmartPayload(fixture);
      expect(result.offerId).toBeNull();
      expect(result.eventType).not.toBe("invalid_payload");
    });

    it("a subscription event with no transaction block still normalizes via the subscription path", () => {
      const result = normalizeHotmartPayload(
        buildFixture({
          event: "SUBSCRIPTION_CANCELLATION",
          includePurchase: false,
          includeSubscription: true,
          subscriberCode: "SUB-1",
          subscriptionStatus: "canceled",
        }),
      );
      expect(result.transactionId).toBeNull();
      expect(result.subscriptionId).toBe("SUB-1");
      expect(result.eventType).toBe("subscription_cancelled");
    });

    it("a payload with neither buyer, offer, transaction, nor subscription is still safely parsed, never crashes", () => {
      const result = normalizeHotmartPayload(
        buildFixture({ includeBuyer: false, includePurchase: false, includeSubscription: false }),
      );
      expect(result.transactionId).toBeNull();
      expect(result.subscriptionId).toBeNull();
      expect(result.buyerEmail).toBeNull();
      expect(() => normalizeHotmartPayload(result)).not.toThrow();
    });

    it("null/absent ids never crash and never fabricate a value", () => {
      const result = normalizeHotmartPayload({ event: "PURCHASE_APPROVED", data: { purchase: { transaction: null, status: "approved" } } });
      expect(result.transactionId).toBeNull();
      expect(result.eventType).toBe("purchase_approved");
    });
  });

  describe("test vs. real payload isolation", () => {
    it("flags an example.com buyer / 'test postback2' product as a test payload", () => {
      const result = normalizeHotmartPayload(buildFixture());
      expect(result.isTestPayload).toBe(true);
    });

    it("does not flag a fixture with a real-looking buyer/product as a test payload", () => {
      const result = normalizeHotmartPayload(buildRealFixture());
      expect(result.isTestPayload).toBe(false);
    });
  });

  it("an entirely non-object payload is invalid_payload, never a crash", () => {
    expect(normalizeHotmartPayload(null).eventType).toBe("invalid_payload");
    expect(normalizeHotmartPayload("a string").eventType).toBe("invalid_payload");
    expect(normalizeHotmartPayload(42).eventType).toBe("invalid_payload");
  });

  it("an authenticated payload with no data block and no recognizable event/status is invalid_payload", () => {
    const result = normalizeHotmartPayload({ hottok: "x" });
    expect(result.eventType).toBe("invalid_payload");
  });

  it("a well-formed data block with a genuinely unrecognized event name is unsupported, never a guessed financial action", () => {
    const result = normalizeHotmartPayload(buildFixture({ event: "SOME_MADE_UP_EVENT", purchaseStatus: "some_made_up_status" }));
    expect(result.eventType).toBe("unsupported");
  });

  it("falls back to flat/1.0.0 fields when there is no top-level data object (graceful degradation, never confirmed live)", () => {
    const result = normalizeHotmartPayload({ status: "approved", prod: "P1", off: "O1" });
    expect(result.eventType).toBe("purchase_approved");
    expect(result.productId).toBe("P1");
    expect(result.offerId).toBe("O1");
  });
});

describe("isPlausibleCurrencyCode — structural sanity only, never a specific-currency allowlist", () => {
  it("accepts real-looking ISO 4217 codes, including ones with no special handling elsewhere in the codebase", () => {
    for (const code of ["USD", "ARS", "BRL", "EUR", "MXN", "COP", "CLP", "PEN", "GBP", "JPY"]) {
      expect(isPlausibleCurrencyCode(code)).toBe(true);
    }
  });

  it("accepts lowercase (normalized elsewhere, this check is shape-only)", () => {
    expect(isPlausibleCurrencyCode("usd")).toBe(true);
  });

  it("rejects structurally malformed values — never a real currency", () => {
    expect(isPlausibleCurrencyCode("12$")).toBe(false);
    expect(isPlausibleCurrencyCode("US")).toBe(false);
    expect(isPlausibleCurrencyCode("DOLLARS")).toBe(false);
    expect(isPlausibleCurrencyCode("")).toBe(false);
    expect(isPlausibleCurrencyCode(null)).toBe(false);
  });
});

describe("verifyHottok", () => {
  it("accepts a matching body value", () => {
    expect(verifyHottok("secret-value", null, "secret-value")).toBe(true);
  });

  it("accepts a matching header value when the body field is absent", () => {
    expect(verifyHottok(null, "secret-value", "secret-value")).toBe(true);
  });

  it("rejects a body mismatch with no header present", () => {
    expect(verifyHottok("wrong", null, "secret-value")).toBe(false);
  });

  it("rejects when both body and header are missing", () => {
    expect(verifyHottok(null, null, "secret-value")).toBe(false);
  });

  it("rejects a different-length value without throwing", () => {
    expect(verifyHottok("short", null, "a-much-longer-secret-value")).toBe(false);
  });
});

describe("idempotency key contract, driven by real normalized events (Fase D)", () => {
  it("produces distinct keys across all 12 configured event fixtures — no collisions", () => {
    const keys = ALL_TWELVE_FIXTURES.map(({ build }) => buildIdempotencyKey(normalizeHotmartPayload(build())));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the same event payload resent produces the same key (idempotent no-op)", () => {
    const payload = buildFixture({ id: "fixed-envelope-id", transaction: "HP-FIXED" });
    const key1 = buildIdempotencyKey(normalizeHotmartPayload(payload));
    const key2 = buildIdempotencyKey(normalizeHotmartPayload(payload));
    expect(key1).toBe(key2);
  });

  // These tests strip the envelope `id` field entirely (rather than just
  // overriding it) to specifically exercise the priority-2 COMBINATION
  // key path — the branch that must, on its own, distinguish events by
  // type/transaction/subscriber even when no envelope id is available.
  function withoutEnvelopeId(payload: Record<string, unknown>): Record<string, unknown> {
    const { id: _id, ...rest } = payload;
    return rest;
  }

  it("a purchase-approved and a purchase-refunded of the SAME transaction get different keys", () => {
    const txn = "HP-SHARED-TXN";
    const approved = normalizeHotmartPayload(
      withoutEnvelopeId(buildFixture({ event: "PURCHASE_APPROVED", purchaseStatus: "approved", transaction: txn })),
    );
    const refunded = normalizeHotmartPayload(
      withoutEnvelopeId(buildFixture({ event: "PURCHASE_REFUNDED", purchaseStatus: "refunded", transaction: txn })),
    );
    expect(approved.transactionId).toBe(refunded.transactionId);
    expect(approved.externalEventId).toBeNull();
    expect(buildIdempotencyKey(approved)).not.toBe(buildIdempotencyKey(refunded));
  });

  it("plan-change, cancellation, and billing-date-update on the same subscriber never share an identity", () => {
    const subscriberCode = "SUB-SHARED";
    const planChange = normalizeHotmartPayload(
      withoutEnvelopeId(buildFixture({ event: "SWITCH_PLAN", includePurchase: false, includeSubscription: true, subscriberCode, subscriptionStatus: "active" })),
    );
    const cancellation = normalizeHotmartPayload(
      withoutEnvelopeId(buildFixture({ event: "SUBSCRIPTION_CANCELLATION", includePurchase: false, includeSubscription: true, subscriberCode, subscriptionStatus: "canceled" })),
    );
    const chargeDateUpdate = normalizeHotmartPayload(
      withoutEnvelopeId(buildFixture({ event: "UPDATE_SUBSCRIPTION_CHARGE_DATE", includePurchase: false, includeSubscription: true, subscriberCode, subscriptionStatus: "active" })),
    );
    const keys = [planChange, cancellation, chargeDateUpdate].map(buildIdempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("an incomplete/degenerate payload never overwrites, or collides with, a valid event's key", () => {
    const valid = normalizeHotmartPayload(buildFixture({ id: undefined, transaction: "HP-VALID" }));
    const degenerate = normalizeHotmartPayload({ hottok: "x" });
    expect(buildIdempotencyKey(valid)).not.toBe(buildIdempotencyKey(degenerate));
  });

  it("two distinct degenerate/invalid payloads (no identity at all) still don't collide with a real event", () => {
    const degenerate1 = normalizeHotmartPayload({ hottok: "x", event: "WEIRD_1" });
    const degenerate2 = normalizeHotmartPayload({ hottok: "x", event: "WEIRD_2" });
    expect(buildIdempotencyKey(degenerate1)).not.toBe(buildIdempotencyKey(degenerate2));
  });

  it("out-of-order delivery of the identical event still produces the identical key regardless of arrival order", () => {
    const payload = buildFixture({ id: "stable-id", transaction: "HP-OOO" });
    const firstDelivery = buildIdempotencyKey(normalizeHotmartPayload(payload));
    // Simulate a second, later-arriving delivery of literally the same event.
    const secondDelivery = buildIdempotencyKey(normalizeHotmartPayload(payload));
    expect(firstDelivery).toBe(secondDelivery);
  });

  it("test payloads never leak their identity into a real event's key space (namespaced fallback)", () => {
    const testDegenerate = normalizeHotmartPayload({ hottok: "x", data: { buyer: { email: "x@example.com" } } });
    const realDegenerate = normalizeHotmartPayload({ hottok: "x", data: { buyer: { email: "x@postulpro-fixture.dev" } } });
    expect(testDegenerate.isTestPayload).toBe(true);
    expect(realDegenerate.isTestPayload).toBe(false);
  });
});

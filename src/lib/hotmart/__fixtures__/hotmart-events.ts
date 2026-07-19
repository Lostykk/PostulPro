// Sanitized fixtures for the 12 Hotmart event types configured on this
// account's webhook subscription (Fase 8C, Fase D of the mandate). Shaped
// exactly like the REAL nested (2.0.0) structure captured live in Fase
// 8C's diagnostic round (see normalize.ts's header comment for the exact
// confirmed field paths) — never the old flat/1.0.0 shape.
//
// All values below are synthetic: fake transaction ids, a buyer at
// example.com (deliberately triggers normalize.ts's isLikelyTestPayload
// heuristic, matching how Hotmart's own "Send test event" panel feature
// behaves — confirmed live: real test deliveries used buyer emails at
// example.com and a product named "test postback2"), no real PII, no
// real secrets. `hottok` is always the placeholder "test-hottok" — tests
// that need to exercise real auth pass their own configured value
// separately; this fixture module never encodes a real secret.
//
// buildFixture() returns the full envelope; each named export below is a
// realistic instance of one of the 12 configured event types. A second
// builder, buildRealFixture(), produces the same shapes but with a
// non-test buyer domain, for exercising the genuine commercial-processing
// path (Fase D requirement #9: "correct commercial transitions for
// controlled real fixtures") without ever touching a real account.

export type FixtureOverrides = {
  event?: string;
  id?: string;
  creationDate?: number;
  purchaseStatus?: string | null;
  subscriptionStatus?: string | null;
  transaction?: string | null;
  subscriberCode?: string | null;
  offerCode?: string | null;
  productId?: number | string;
  productUcode?: string;
  productName?: string;
  buyerEmail?: string | null;
  includeBuyer?: boolean;
  includeSubscription?: boolean;
  includePurchase?: boolean;
  hottok?: string;
  currencyValue?: string;
  priceValue?: number;
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function buildFixture(overrides: FixtureOverrides = {}): Record<string, unknown> {
  const {
    event = "PURCHASE_APPROVED",
    id = nextId("evt"),
    creationDate = 1732000000,
    purchaseStatus = "approved",
    subscriptionStatus = null,
    transaction = nextId("HP"),
    subscriberCode = null,
    offerCode = "w6nw1f3o",
    productId = 8148076,
    productUcode = "test-postback-2-ucode",
    productName = "test postback2",
    buyerEmail = "buyer@example.com",
    includeBuyer = true,
    includeSubscription = false,
    includePurchase = true,
    hottok = "test-hottok",
    currencyValue = "USD",
    priceValue = 29,
  } = overrides;

  const data: Record<string, unknown> = {
    product: {
      support_email: "support@example.com",
      has_co_production: false,
      name: productName,
      warranty_date: "2026-08-19",
      is_physical_product: false,
      id: productId,
      ucode: productUcode,
      product_format_id: 1,
      content: {},
    },
    producer: { legal_nature: "individual", document: "00000000000", name: "Test Producer" },
  };

  if (includePurchase) {
    data.purchase = {
      original_offer_price: { value: priceValue, currency_value: currencyValue },
      checkout_country: { name: "United States", iso: "US" },
      sckPaymentLink: null,
      order_bump: {},
      variants: {},
      approved_date: creationDate,
      offer: { code: offerCode },
      is_funnel: false,
      event_tickets: {},
      order_date: creationDate,
      price: { value: priceValue, currency_value: currencyValue },
      buyer_ip: "203.0.113.1",
      payment: { type: "CREDIT_CARD" },
      full_price: { value: priceValue, currency_value: currencyValue },
      business_model: "I",
      transaction,
      status: purchaseStatus,
    };
  }

  if (includeSubscription) {
    data.subscription = {
      subscriber: { code: subscriberCode ?? nextId("SUB") },
      plan: { name: "Plano Mensal", id: 1 },
      status: subscriptionStatus,
    };
  }

  if (includeBuyer && buyerEmail) {
    data.buyer = {
      checkout_phone_code: "1",
      address: {},
      document: "000000000",
      name: "Test",
      last_name: "Buyer",
      checkout_phone: "5555555555",
      first_name: "Test",
      email: buyerEmail,
      document_type: "CPF",
    };
  }

  return {
    hottok,
    id,
    creation_date: creationDate,
    event,
    version: "2.0.0",
    data,
  };
}

// A "real" (non-test) buyer variant — same shape, different buyer domain
// and product identity, so normalize.ts's isLikelyTestPayload heuristic
// does NOT flag it, exercising the genuine commercial-mutation path.
export function buildRealFixture(overrides: FixtureOverrides = {}): Record<string, unknown> {
  return buildFixture({
    buyerEmail: "real.buyer@postulpro-fixture.dev",
    productUcode: "prod-real-ucode",
    productName: "PostulPro Pro",
    ...overrides,
  });
}

// The 12 configured events, in the order the mandate lists them.

export const fixtureCompraAprobada = () =>
  buildFixture({ event: "PURCHASE_APPROVED", purchaseStatus: "approved" });

export const fixtureCompraCompleta = () =>
  buildFixture({ event: "PURCHASE_COMPLETE", purchaseStatus: "complete" });

export const fixtureALaEsperaDePago = () =>
  buildFixture({ event: "PURCHASE_BILLET_PRINTED", purchaseStatus: "waiting_payment" });

export const fixtureCompraCancelada = () =>
  buildFixture({ event: "PURCHASE_CANCELED", purchaseStatus: "canceled" });

export const fixtureCompraReembolsada = () =>
  buildFixture({ event: "PURCHASE_REFUNDED", purchaseStatus: "refunded" });

export const fixtureChargeback = () =>
  buildFixture({ event: "PURCHASE_CHARGEBACK", purchaseStatus: "chargeback" });

export const fixtureCompraConPlazoVencido = () =>
  buildFixture({ event: "PURCHASE_EXPIRED", purchaseStatus: "expired" });

export const fixtureCompraAtrasada = () =>
  buildFixture({ event: "PURCHASE_DELAYED", purchaseStatus: "delayed" });

export const fixturePedidoDeReembolso = () =>
  buildFixture({ event: "PURCHASE_PROTEST", purchaseStatus: "protested" });

export const fixtureCancelacionDeSuscripcion = () =>
  buildFixture({
    event: "SUBSCRIPTION_CANCELLATION",
    includePurchase: false,
    includeSubscription: true,
    subscriptionStatus: "canceled",
    subscriberCode: nextId("SUB"),
  });

export const fixtureCambioDePlan = () =>
  buildFixture({
    event: "SWITCH_PLAN",
    includePurchase: false,
    includeSubscription: true,
    subscriptionStatus: "active",
    subscriberCode: nextId("SUB"),
  });

export const fixtureActualizacionFechaDeCobro = () =>
  buildFixture({
    event: "UPDATE_SUBSCRIPTION_CHARGE_DATE",
    includePurchase: false,
    includeSubscription: true,
    subscriptionStatus: "active",
    subscriberCode: nextId("SUB"),
  });

export const ALL_TWELVE_FIXTURES: Array<{ name: string; build: () => Record<string, unknown> }> = [
  { name: "Compra aprobada", build: fixtureCompraAprobada },
  { name: "Compra completa", build: fixtureCompraCompleta },
  { name: "A la espera de pago", build: fixtureALaEsperaDePago },
  { name: "Compra cancelada", build: fixtureCompraCancelada },
  { name: "Compra reembolsada", build: fixtureCompraReembolsada },
  { name: "Chargeback", build: fixtureChargeback },
  { name: "Compra con plazo vencido", build: fixtureCompraConPlazoVencido },
  { name: "Compra atrasada", build: fixtureCompraAtrasada },
  { name: "Pedido de reembolso", build: fixturePedidoDeReembolso },
  { name: "Cancelación de Suscripción", build: fixtureCancelacionDeSuscripcion },
  { name: "Cambio de Plan", build: fixtureCambioDePlan },
  { name: "Actualización de la Fecha de Cobro de la Suscripción", build: fixtureActualizacionFechaDeCobro },
];

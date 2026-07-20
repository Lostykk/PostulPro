import { describe, it, expect, beforeEach } from "vitest";
import { runHotmartReconciliation } from "@/lib/hotmart/reconcile-hotmart.server";

const RPC_SECRET = "rpc-secret";

type HotmartEventRow = {
  id: string;
  idempotency_key: string;
  external_event_id: string | null;
  event_type: string;
  transaction_id: string | null;
  subscription_id: string | null;
  product_id: string | null;
  offer_id: string | null;
  buyer_email: string | null;
  processing_status: string;
  processing_attempts: number;
};

let rows: HotmartEventRow[] = [];
const rpcCalls: { name: string; args: unknown }[] = [];
let subscriptionAlreadyLinked = false;
let processHotmartEventResult: { ok: boolean; message: string } = { ok: true, message: "ok" };

// Minimal fake matching only the query/update shapes reconcileFailedEvents
// and processEvent actually issue — same style as
// routes/api/webhooks/hotmart.test.ts's makeFakeSupabase.
function makeFakeSupabase() {
  return {
    from(table: string) {
      if (table === "hotmart_events") {
        return {
          select: () => ({
            in: (_col: string, statuses: string[]) => ({
              lt: (_c: string, maxAttempts: number) => ({
                not: () => ({
                  order: () => ({
                    limit: async (n: number) => ({
                      data: rows.filter((r) => statuses.includes(r.processing_status) && r.processing_attempts < maxAttempts).slice(0, n),
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: (patch: Partial<HotmartEventRow>) => ({
            // Two real call shapes:
            //   await update(patch).eq('id', rowId)                       -- markRow (single .eq, thenable)
            //   update(patch).eq('id', rowId).eq('processing_status', s)  -- the reconciler's CAS claim (chained .eq)
            eq: (_col1: string, id: string) => ({
              eq: (_col2: string, expectedStatus: string) => ({
                select: () => ({
                  maybeSingle: async () => {
                    const row = rows.find((r) => r.id === id);
                    if (!row || row.processing_status !== expectedStatus) {
                      return { data: null, error: null }; // lost the CAS race
                    }
                    Object.assign(row, patch);
                    return { data: { id: row.id }, error: null };
                  },
                }),
              }),
              then: (resolve: (v: { error: null }) => void) => {
                const row = rows.find((r) => r.id === id);
                if (row) Object.assign(row, patch);
                resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  subscriptionAlreadyLinked ? { data: { user_id: "linked-user-1" }, error: null } : { data: null, error: null },
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "existing-user-1" }, error: null }) }) }) };
      }
      if (table === "hotmart_pending_links") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      if (name === "reconcile_hotmart_stale") {
        return Promise.resolve({ data: [{ expired_subscriptions: 0, stuck_events_flagged: 0 }], error: null });
      }
      if (name === "process_hotmart_event") {
        return Promise.resolve({
          data: [{ ok: processHotmartEventResult.ok, message: processHotmartEventResult.message, notify_email: null, notify_kind: null, notify_plan: null }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc in test: ${name}`);
      // eslint-disable-next-line no-unreachable
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  rows = [];
  rpcCalls.length = 0;
  subscriptionAlreadyLinked = false;
  processHotmartEventResult = { ok: true, message: "ok" };
});

// The exact currency-blocked-then-fixed shape of the real HP2883966668
// incident: two 'failed' rows (Compra aprobada + Compra completa both
// landing separately), product/offer correctly mapped, currency no longer
// checked (fields not even persisted on the row), zero prior attempts.
function currencyFailedRow(overrides: Partial<HotmartEventRow> = {}): HotmartEventRow {
  return {
    id: "row-1",
    idempotency_key: "key-1",
    external_event_id: "ext-1",
    event_type: "purchase_approved",
    transaction_id: "HP2883966668",
    subscription_id: "86WFIQ22",
    product_id: "8148076",
    offer_id: "w6nw1f3o", // pro_monthly real offer id
    buyer_email: "themisterywhite@example.test",
    processing_status: "failed",
    processing_attempts: 0,
    ...overrides,
  };
}

describe("runHotmartReconciliation — autonomous recovery of recoverable failures", () => {
  it("recovers a currency-blocked purchase automatically: no manual trigger, no Hottok re-check, grants via the real RPC", async () => {
    rows = [currencyFailedRow()];
    const outcome = await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.summary.reconciled).toBe(1);

    const grantCall = rpcCalls.find((c) => c.name === "process_hotmart_event");
    expect(grantCall).toBeTruthy();
    const args = grantCall!.args as Record<string, unknown>;
    expect(args.p_plan).toBe("pro");
    expect(args.p_event_type).toBe("purchase_approved");
    // No Hottok/secret of any kind reaches this path from a caller — the
    // runner only ever receives BILLING_RPC_SECRET from the Worker's own
    // environment (see tasks/reconcile-hotmart.ts), never a request.
    expect(args.p_secret).toBe(RPC_SECRET);

    const row = rows.find((r) => r.id === "row-1")!;
    expect(row.processing_status).toBe("processed");
  });

  it("processing the SAME purchase's second ledger row (Compra completa) after the first already granted access converges to a no-op renewal, never a double grant", async () => {
    rows = [currencyFailedRow({ id: "row-2", idempotency_key: "key-2", external_event_id: "ext-2" })];
    subscriptionAlreadyLinked = true; // simulates: row-1 already ran and created the subscription
    await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);

    const grantCall = rpcCalls.find((c) => c.name === "process_hotmart_event");
    expect((grantCall!.args as Record<string, unknown>).p_event_type).toBe("renewal_approved");
    expect((grantCall!.args as Record<string, unknown>).p_user_id).toBe("linked-user-1");
  });

  it("running the reconciler twice on an already-processed row is idempotent — the second pass finds nothing left to do", async () => {
    rows = [currencyFailedRow()];
    const supabase = makeFakeSupabase();
    await runHotmartReconciliation(supabase, RPC_SECRET, 200, 25);
    rpcCalls.length = 0;

    const second = await runHotmartReconciliation(supabase, RPC_SECRET, 200, 25);
    if (!second.ok) throw new Error("unreachable");
    expect(second.summary.reconciled).toBe(0);
    expect(rpcCalls.find((c) => c.name === "process_hotmart_event")).toBeUndefined();
  });

  it("caps retries at 5 attempts and moves a persistently-failing row to failed_terminal instead of retrying forever", async () => {
    processHotmartEventResult = { ok: false, message: "still broken" };
    rows = [currencyFailedRow({ processing_attempts: 4 })];
    await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);

    const row = rows.find((r) => r.id === "row-1")!;
    expect(row.processing_status).toBe("failed_terminal");
    expect(row.processing_attempts).toBe(5);
  });

  it("a row already at the attempt cap is not picked up again", async () => {
    rows = [currencyFailedRow({ processing_status: "failed_terminal", processing_attempts: 5 })];
    const outcome = await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.summary.reconciled).toBe(0);
    expect(rpcCalls.find((c) => c.name === "process_hotmart_event")).toBeUndefined();
  });

  it("a row already resolved to a non-retryable status (e.g. 'processed') is never selected as a reconciliation candidate", async () => {
    rows = [currencyFailedRow({ processing_status: "processed" })];
    await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);
    expect(rpcCalls.find((c) => c.name === "process_hotmart_event")).toBeUndefined();
  });

  // The compare-and-swap claim itself (update().eq('id', id).eq('processing_status', expected))
  // only ever succeeds when the row's status still matches what was just
  // selected — every "recovers"/"idempotent" test above only passes
  // because that claim matched. A genuine two-writer race is a property of
  // Postgres's real UPDATE ... WHERE semantics (the second writer's UPDATE
  // affects 0 rows), not something a single-threaded mock can reproduce
  // beyond re-asserting the same WHERE clause is present — which the
  // "recovers" tests already do implicitly.

  it("ignores a 'failed' row with no usable identity (no product+offer, no subscription) — never force-attempted", async () => {
    rows = [currencyFailedRow({ product_id: null, offer_id: null, subscription_id: null })];
    await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);
    expect(rpcCalls.find((c) => c.name === "process_hotmart_event")).toBeUndefined();
  });

  it("recovers a pending_link row the same way as a failed row", async () => {
    rows = [currencyFailedRow({ processing_status: "pending_link" })];
    const outcome = await runHotmartReconciliation(makeFakeSupabase(), RPC_SECRET, 200, 25);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.summary.reconciled).toBe(1);
  });

  it("a reconcile_hotmart_stale RPC error is reported and never crashes the run", async () => {
    const supabase = makeFakeSupabase();
    const originalRpc = supabase.rpc.bind(supabase);
    supabase.rpc = (name: string, args: unknown) => {
      if (name === "reconcile_hotmart_stale") return Promise.resolve({ data: null, error: { message: "db unavailable" } });
      return originalRpc(name, args);
    };
    const outcome = await runHotmartReconciliation(supabase, RPC_SECRET, 200, 25);
    expect(outcome.ok).toBe(false);
  });
});

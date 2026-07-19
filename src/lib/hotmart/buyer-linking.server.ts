import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Server-only. Buyer identity resolution for the Hotmart webhook — see
// docs/hotmart-integration-report.md §G for the full reasoning.
//
// Only called for the FIRST event on a given Hotmart subscription_id (a
// purchase_approved with no existing public.subscriptions row yet).
// Every subsequent event on that same subscription_id (renewal,
// cancellation, refund, chargeback, payment_failed, reactivation,
// plan_change) resolves its user_id from the already-linked
// subscriptions row itself, exactly like process_lemon_squeezy_event
// already does (all of its non-initial branches key purely on
// provider_subscription_id, never re-derive identity from the payload's
// email) — see the webhook route for where that lookup happens. This
// keeps "who is this buyer" a question asked exactly once per
// subscription, never re-litigated on every event.
//
// Two outcomes at that first-event point:
//   - EXISTING user: an exact, normalized email match against
//     public.users. Linked immediately — no ambiguity, no merge.
//   - NEW user: no match. A real account is created immediately via
//     Supabase Auth's admin inviteUserByEmail (creates the account +
//     sends a magic-link invite in one call, no password ever generated
//     or transmitted) so the purchase can be linked and access granted
//     right away — never gated on the buyer opening that email.
//
// Documented, accepted residual risk (see report §risks — not silently
// assumed safe): a buyer who already has a PostulPro account under a
// DIFFERENT email than the one used at Hotmart checkout will get a
// second, new account here, since Hotmart's checkout was not confirmed
// (Fase B research) to support passing our own user_id through as
// custom/tracking data the way Lemon Squeezy's checkout_data.custom
// does. hotmart_pending_links exists for exactly this class of case to
// be resolved by an admin (or a future logged-in "claim this purchase"
// self-service flow) — but auto-invite-on-no-match remains the default
// for the common case (a genuinely new customer), matching what the
// task explicitly asked for as the "usuario nuevo" path.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type BuyerResolution = { userId: string; isNewUser: boolean };

export async function resolveOrInviteBuyer(
  supabaseAdmin: SupabaseClient<Database>,
  rawEmail: string,
): Promise<BuyerResolution> {
  const email = normalizeEmail(rawEmail);

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw new Error(`buyer lookup failed: ${lookupError.message}`);
  if (existing) return { userId: existing.id, isNewUser: false };

  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited?.user) {
    throw new Error(`buyer invite failed: ${inviteError?.message ?? "no user returned"}`);
  }
  return { userId: invited.user.id, isNewUser: true };
}

// Records a purchase whose buyer_email doesn't (yet) resolve to a linked
// account for an event type that should NOT auto-invite (used only for
// the defensive fallback path — see the webhook route — when
// resolveOrInviteBuyer itself fails, e.g. Supabase Auth being
// unreachable). Never grants any plan/credits; purely an audit trail for
// admin resolution (Fase J).
export async function recordPendingLink(
  supabaseAdmin: SupabaseClient<Database>,
  args: {
    hotmartEventId: string;
    buyerEmail: string;
    transactionId: string | null;
    subscriptionId: string | null;
    productId: string | null;
    offerId: string | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("hotmart_pending_links").insert({
    hotmart_event_id: args.hotmartEventId,
    buyer_email: normalizeEmail(args.buyerEmail),
    transaction_id: args.transactionId,
    subscription_id: args.subscriptionId,
    product_id: args.productId,
    offer_id: args.offerId,
  });
  if (error) throw new Error(`recording pending link failed: ${error.message}`);
}

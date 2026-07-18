import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSubscription } from "@/lib/lemon-squeezy.server";

// Lemon Squeezy has no "create a portal session" call like Stripe's — the
// Customer Portal URL is a pre-signed field (urls.customer_portal) on the
// subscription resource itself, valid for ~24h. So "opening the portal" is
// just: look up the user's own subscription id, re-fetch it for a fresh URL,
// and redirect there.

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
        const token = auth.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: "Supabase not configured" }, 500);

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

        // .maybeSingle() errors out (returning null data) if more than one
        // row matches, so this must narrow to exactly one candidate row
        // itself via status + limit(1) rather than relying on maybeSingle
        // to enforce cardinality — a user can have multiple historical
        // subscription rows (e.g. expired + active after a resubscribe).
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("provider_subscription_id")
          .eq("user_id", userData.user.id)
          .not("status", "in", "(expired,refunded)")
          .not("provider_subscription_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!sub?.provider_subscription_id) {
          return json({ error: "Todavía no tenés una suscripción activa." }, 404);
        }

        try {
          const remote = await getSubscription(sub.provider_subscription_id);
          const url = remote.attributes.urls.customer_portal;
          if (!url) return json({ error: "Lemon Squeezy no devolvió una URL de portal" }, 501);
          return json({ url });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : "Portal failed" }, 501);
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

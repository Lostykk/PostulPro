import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getStripe, resolvePriceId, type PriceKey } from "@/lib/stripe.server";

// Creates a Stripe Checkout session for a plan subscription or a one-time
// credits pack. Contract: POST { kind: "subscription"|"credits", priceKey }
// with Bearer token. The client never chooses a raw Stripe price ID — only
// one of the fixed logical keys below, resolved server-side to an env var.

const SUBSCRIPTION_KEYS: PriceKey[] = ["pro_monthly", "pro_annual", "business_monthly", "business_annual"];

export const Route = createFileRoute("/api/billing/checkout")({
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
        const user = userData.user;

        let body: { kind?: string; priceKey?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const kind = body.kind;
        const priceKey = body.priceKey as PriceKey | undefined;
        if (kind !== "subscription" && kind !== "credits") return json({ error: "Invalid kind" }, 400);
        if (!priceKey) return json({ error: "priceKey is required" }, 400);
        if (kind === "subscription" && !SUBSCRIPTION_KEYS.includes(priceKey)) {
          return json({ error: "Invalid subscription priceKey" }, 400);
        }
        if (kind === "credits" && priceKey !== "credits_100") {
          return json({ error: "Invalid credits priceKey" }, 400);
        }

        try {
          const stripe = getStripe();
          const price = resolvePriceId(priceKey);
          const origin = new URL(request.url).origin;

          const session = await stripe.checkout.sessions.create({
            mode: kind === "subscription" ? "subscription" : "payment",
            client_reference_id: user.id,
            customer_email: user.email,
            line_items: [{ price, quantity: 1 }],
            metadata: { user_id: user.id, kind, price_key: priceKey },
            success_url: `${origin}/dashboard?checkout=success`,
            cancel_url: `${origin}/settings?checkout=cancelled`,
          });

          return json({ url: session.url });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : "Checkout failed" }, 501);
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createCheckout, resolveVariantId, VARIANT_PLAN_MAP, type VariantKey } from "@/lib/lemon-squeezy.server";

// Creates a Lemon Squeezy Checkout for a plan subscription or a one-time
// credits pack. Contract: POST { kind: "subscription"|"credits", priceKey }
// with Bearer token. The client never chooses a raw Lemon Squeezy variant id
// — only one of the fixed logical keys below, resolved server-side to an
// env var and cross-checked against VARIANT_PLAN_MAP's own "kind".

const ALL_KEYS = Object.keys(VARIANT_PLAN_MAP) as VariantKey[];

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
        if (!user.email) return json({ error: "Account has no email" }, 400);

        let body: { kind?: string; priceKey?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const kind = body.kind;
        const priceKey = body.priceKey as VariantKey | undefined;
        if (kind !== "subscription" && kind !== "credits") return json({ error: "Invalid kind" }, 400);
        if (!priceKey || !ALL_KEYS.includes(priceKey)) return json({ error: "Invalid priceKey" }, 400);

        const mapping = VARIANT_PLAN_MAP[priceKey];
        if (kind !== mapping.kind) return json({ error: "priceKey does not match kind" }, 400);

        try {
          const variantId = resolveVariantId(priceKey);
          const origin = new URL(request.url).origin;

          const url = await createCheckout({
            variantId,
            userId: user.id,
            email: user.email,
            redirectUrl: `${origin}/dashboard?checkout=success`,
          });

          return json({ url });
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

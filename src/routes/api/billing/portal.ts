import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getStripe } from "@/lib/stripe.server";

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

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", userData.user.id)
          .not("stripe_customer_id", "is", null)
          .order("created_at", { ascending: false })
          .maybeSingle();

        if (!sub?.stripe_customer_id) {
          return json({ error: "Todavía no tenés una suscripción activa con Stripe." }, 404);
        }

        try {
          const stripe = getStripe();
          const origin = new URL(request.url).origin;
          const session = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            return_url: `${origin}/settings`,
          });
          return json({ url: session.url });
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

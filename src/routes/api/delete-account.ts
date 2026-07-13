import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Deletes the authenticated user's account: their own Storage objects, then
// the auth.users row via the service-role admin API. All DB rows referencing
// users.id are declared ON DELETE CASCADE, so profile/generations/folders/
// subscriptions/products/purchases/reviews/affiliate rows/api_keys/
// conversations go with it. Never a frontend-only "delete" — this is the
// only path that actually removes the account.

export const Route = createFileRoute("/api/delete-account")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
        const token = auth.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        // Prefer the new-style Supabase secret key (sb_secret_...); fall
        // back to the legacy service_role JWT if that's what's configured.
        // Neither is required for the rest of the app to run — only this
        // one endpoint needs admin privileges — so its absence must not
        // block anything else from loading.
        const ADMIN_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY || !ADMIN_KEY) {
          // Deliberately generic — never names which env var is missing to
          // an unauthenticated-adjacent client response.
          return json(
            { error: "Esta función no está disponible en este momento.", code: "unavailable" },
            501,
          );
        }

        const asUser = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: userData, error: userErr } = await asUser.auth.getUser(token);
        if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
        const userId = userData.user.id;

        const admin = createClient<Database>(SUPABASE_URL, ADMIN_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        try {
          const { data: avatarFiles } = await admin.storage.from("avatars").list(userId);
          if (avatarFiles?.length) {
            await admin.storage
              .from("avatars")
              .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
          }

          const { data: products } = await admin
            .from("products")
            .select("id")
            .eq("seller_id", userId);
          for (const p of products ?? []) {
            const [files, thumbs] = await Promise.all([
              admin.storage.from("product-files").list(p.id),
              admin.storage.from("product-thumbnails").list(p.id),
            ]);
            if (files.data?.length) {
              await admin.storage
                .from("product-files")
                .remove(files.data.map((f) => `${p.id}/${f.name}`));
            }
            if (thumbs.data?.length) {
              await admin.storage
                .from("product-thumbnails")
                .remove(thumbs.data.map((f) => `${p.id}/${f.name}`));
            }
          }

          const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
          if (deleteErr) throw new Error(deleteErr.message);

          return json({ ok: true });
        } catch (err) {
          // Internal detail stays server-side (Worker logs) — the client
          // never sees raw error text, SQL, or storage paths.
          console.error(
            JSON.stringify({
              scope: "delete_account",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          return json(
            {
              error: "No se pudo eliminar la cuenta. Intentá de nuevo más tarde.",
              code: "delete_failed",
            },
            500,
          );
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

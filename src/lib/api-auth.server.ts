import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Some providers (observed with Google OAuth in this project's Preview
// environment) leave the top-level `user.email` field empty on the object
// returned by auth.getUser(), even for a fully signed-in, verified account —
// the real value lives in `user_metadata.email` or the first identity's
// `identity_data.email` instead. Falls through all three so "what did this
// person actually sign in with" is answered reliably regardless of provider.
function resolveAuthEmail(user: User): string | null {
  if (user.email) return user.email;
  const metaEmail = user.user_metadata?.email;
  if (typeof metaEmail === "string" && metaEmail) return metaEmail;
  const identityEmail = user.identities?.[0]?.identity_data?.email;
  if (typeof identityEmail === "string" && identityEmail) return identityEmail;
  return null;
}

// Shared "authenticate this request" helper for API routes — factors out
// the Bearer-token -> user-scoped Supabase client boilerplate that was
// duplicated across routes/api/billing/*.ts and routes/api/generate-ai.ts.
// Returns either the authenticated context or a ready-to-return Response.

export type AuthedCtx = {
  supabase: SupabaseClient<Database>;
  userId: string;
  // From the verified Supabase Auth session itself (auth.getUser), not the
  // public.users profile row — the authoritative source for "what did this
  // person actually sign in with", independent of whether a profile-table
  // column is populated/synced. See preview-guard.server.ts's email
  // allowlist for the one place this matters today.
  email: string | null;
};

export async function authenticate(request: Request): Promise<AuthedCtx | Response> {
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

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return json({ error: "Unauthorized" }, 401);

  return { supabase, userId: userData.user.id, email: resolveAuthEmail(userData.user) };
}

export function isAuthedCtx(x: AuthedCtx | Response): x is AuthedCtx {
  return !(x instanceof Response);
}

export function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { listProjectCapabilities } from "@/lib/projects/capabilities.server";

// GET /api/projects/capabilities — client-safe list of tools the AI
// Project Builder can use for the caller's plan (name/description/route/
// cost — never a system prompt or model id). Used by the plan editor's
// "add a step" picker.

export const Route = createFileRoute("/api/projects/capabilities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const { data: profile } = await supabase.from("users").select("plan").eq("id", userId).maybeSingle();
        const capabilities = listProjectCapabilities((profile?.plan as "free" | "pro" | "business") ?? "free");
        return json({ capabilities });
      },
    },
  },
});

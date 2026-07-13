import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseOAuthCallbackError } from "@/lib/auth/google-oauth";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Conectando... — PostulPro" }] }),
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  // Guards against onAuthStateChange firing a second SIGNED_IN event (e.g.
  // TOKEN_REFRESHED right after the initial sign-in) and racing a second
  // navigate/profile lookup for the same callback visit.
  const settled = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function go() {
      if (settled.current) return;

      // Google/provider errors (denied consent, misconfigured provider, etc.)
      // come back as ?error=...&error_description=... on this same URL rather
      // than a session — surface them instead of silently bouncing to login.
      const oauthError = parseOAuthCallbackError(window.location.search);
      if (oauthError) {
        settled.current = true;
        toast.error(oauthError);
        navigate({ to: "/auth/login" });
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted || settled.current) return;
      if (!data.session) {
        settled.current = true;
        navigate({ to: "/auth/login" });
        return;
      }

      settled.current = true;
      const { data: profile } = await supabase
        .from("users")
        .select("onboarding_completed")
        .eq("id", data.session.user.id)
        .maybeSingle();
      navigate({ to: profile?.onboarding_completed ? "/dashboard" : "/onboarding" });
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) go();
    });
    go();
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
        <p className="text-sm">Conectando tu cuenta...</p>
      </div>
    </div>
  );
}

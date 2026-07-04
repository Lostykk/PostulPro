import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Conectando... — PostulPro" }] }),
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  useEffect(() => {
    let mounted = true;
    async function go() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!data.session) {
        navigate({ to: "/auth/login" });
        return;
      }
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

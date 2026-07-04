import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Sparkles, Zap, Users, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PostulPro" }] }),
  component: DashboardPage,
});

type Profile = {
  name: string | null;
  email: string;
  plan: string;
  credits_used: number;
  credits_limit: number;
  affiliate_code: string | null;
  onboarding_completed: boolean;
};

function DashboardPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("users")
      .select("name,email,plan,credits_used,credits_limit,affiliate_code,onboarding_completed")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!data) return;
        setProfile(data as Profile);
        if (!data.onboarding_completed) navigate({ to: "/onboarding" });
      });
  }, [user, navigate]);

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth/login", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/5 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold">PostulPro</span>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
          >
            <LogOut className="w-4 h-4" /> Salir
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Hola{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Este es tu dashboard. Las herramientas de IA se activan en la próxima fase.
          </p>
        </div>

        {loading ? (
          <div className="h-32 rounded-xl border border-white/10 bg-white/5 animate-pulse" />
        ) : profile ? (
          <div className="grid md:grid-cols-3 gap-4">
            <StatCard
              icon={<Zap className="w-4 h-4" />}
              label="Créditos usados"
              value={`${profile.credits_used} / ${profile.credits_limit}`}
            />
            <StatCard
              icon={<Package className="w-4 h-4" />}
              label="Plan actual"
              value={profile.plan.toUpperCase()}
            />
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="Tu código de afiliado"
              value={profile.affiliate_code ?? "—"}
              mono
            />
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-8">
          <h2 className="font-display text-xl font-bold">Próximamente</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg">
            En la Fase 3 activamos las herramientas de IA (Copywriter, Business Plan, Email
            Marketing, etc.) para que empieces a generar contenido con tus créditos.
          </p>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 font-display text-2xl font-bold ${mono ? "font-mono tracking-wider" : ""}`}>
        {value}
      </div>
    </div>
  );
}

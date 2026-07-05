import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Zap, DollarSign, Clock, Flame, Copy, Trash2, Eye, Plus, ArrowRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PostulPro" }] }),
  component: DashboardPage,
});

type Generation = {
  id: string;
  tool: string;
  title: string | null;
  output: string | null;
  tokens_used: number | null;
  created_at: string;
};

const TOOL_META: Record<string, { label: string; icon: string }> = {
  copywriter: { label: "Copywriter", icon: "✍️" },
  "social-pack": { label: "Social Pack", icon: "📱" },
  "business-plan": { label: "Business Plan", icon: "📊" },
  consultant: { label: "Consultor", icon: "🧠" },
  "sales-email": { label: "Sales Email", icon: "✉️" },
  "landing-copy": { label: "Landing", icon: "🎯" },
  "email-sequences": { label: "Secuencias", icon: "📬" },
};

function DashboardPage() {
  const navigate = useNavigate();
  const { profile, loading: profileLoading } = useProfile();
  const [gens, setGens] = useState<Generation[] | null>(null);
  const [chartMetric, setChartMetric] = useState<"count" | "tokens" | "time">("count");

  useEffect(() => {
    if (profile && !profile.onboarding_completed) {
      navigate({ to: "/onboarding" });
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from("generations")
      .select("id,tool,title,output,tokens_used,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setGens((data as Generation[] | null) ?? []));
  }, [profile]);

  const stats = useMemo(() => {
    if (!gens || !profile) return null;
    const now = Date.now();
    const activeDays = new Set(
      gens.map((g) => new Date(g.created_at).toISOString().slice(0, 10)),
    ).size;
    const totalTokens = gens.reduce((a, g) => a + (g.tokens_used ?? 0), 0);
    // Estimated hours saved: ~15 min per generation
    const hoursSaved = Math.round((gens.length * 15) / 60);
    return { activeDays, totalTokens, hoursSaved };
  }, [gens, profile]);

  const chartData = useMemo(() => {
    const days: { date: string; count: number; tokens: number; time: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: d.toISOString().slice(5, 10), count: 0, tokens: 0, time: 0 });
    }
    (gens ?? []).forEach((g) => {
      const key = new Date(g.created_at).toISOString().slice(5, 10);
      const bucket = days.find((d) => d.date === key);
      if (bucket) {
        bucket.count += 1;
        bucket.tokens += g.tokens_used ?? 0;
        bucket.time += 15;
      }
    });
    return days;
  }, [gens]);

  const daysSinceJoin = profile
    ? Math.max(1, Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000))
    : 0;

  const firstName = profile?.name?.split(" ")[0] ?? "";
  const greeting = getGreeting();
  const creditsRemaining = profile ? profile.credits_limit - profile.credits_used : 0;
  const usagePercent = profile
    ? Math.round((profile.credits_used / Math.max(1, profile.credits_limit)) * 100)
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-bold">
          {greeting}{firstName ? `, ${firstName}` : ""} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Llevas <span className="text-foreground font-semibold">{daysSinceJoin} días</span> generando con IA
        </p>
      </header>

      {profileLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<DollarSign className="w-4 h-4" />}
            label="Ingresos este mes"
            value="$0"
            hint="Sin ventas registradas"
          />
          <StatCard
            icon={<Zap className="w-4 h-4" />}
            label="Generaciones"
            value={`${profile?.credits_used ?? 0}/${profile?.credits_limit ?? 0}`}
            hint={`${usagePercent}% del límite`}
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label="Horas ahorradas"
            value={String(stats?.hoursSaved ?? 0)}
            hint="Estimado ~15min/gen"
          />
          <StatCard
            icon={<Flame className="w-4 h-4" />}
            label="Días activos"
            value={String(stats?.activeDays ?? 0)}
            hint="Últimos 30 días"
          />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold">Actividad · 30 días</h2>
            <div className="flex gap-1 p-1 rounded-lg bg-white/5 text-xs">
              {(
                [
                  ["count", "Generaciones"],
                  ["tokens", "Tokens"],
                  ["time", "Tiempo"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChartMetric(k)}
                  className={`px-3 py-1 rounded-md transition ${
                    chartMetric === k
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#0f0f1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={chartMetric}
                  stroke="#a855f7"
                  fill="url(#grad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <aside className="rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-5 space-y-4">
          <div>
            <div className="text-xs text-muted-foreground">Plan actual</div>
            <div className="mt-1 font-display text-2xl font-bold">{profile?.plan.toUpperCase() ?? "—"}</div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Créditos restantes</span>
              <span className="text-foreground font-semibold">{creditsRemaining}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                style={{ width: `${100 - usagePercent}%` }}
              />
            </div>
          </div>
          <Link
            to="/settings"
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition"
          >
            Conseguir más créditos <ArrowRight className="w-4 h-4" />
          </Link>
        </aside>
      </div>

      <section>
        <h2 className="font-display font-bold mb-3">Acciones rápidas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction to="/tools/copywriter" icon="✍️" label="Crear post" />
          <QuickAction to="/tools/business-plan" icon="📊" label="Plan de negocios" />
          <QuickAction to="/tools/consultant" icon="🧠" label="Consultor IA" />
          <QuickAction to="/marketplace" icon="🛒" label="Marketplace" />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold">Actividad reciente</h2>
          <Link to="/library" className="text-xs text-muted-foreground hover:text-foreground">
            Ver todo →
          </Link>
        </div>
        {gens === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : gens.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {gens.slice(0, 10).map((g) => (
              <ActivityRow key={g.id} gen={g} onDelete={() => setGens((prev) => (prev ?? []).filter((x) => x.id !== g.id))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-2xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-violet-500/50 transition p-4 flex flex-col items-start gap-2"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold">{label}</span>
      <Plus className="w-4 h-4 text-muted-foreground group-hover:text-violet-400 transition" />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
      <div className="text-3xl mb-2">✨</div>
      <p className="text-sm text-muted-foreground mb-4">Aún no tienes generaciones.</p>
      <Link
        to="/tools/copywriter"
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
      >
        Crear la primera <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function ActivityRow({ gen, onDelete }: { gen: Generation; onDelete: () => void }) {
  const meta = TOOL_META[gen.tool] ?? { label: gen.tool, icon: "⚡" };
  const title = (gen.title ?? gen.output?.slice(0, 50) ?? "Sin título").slice(0, 50);
  const [viewing, setViewing] = useState(false);

  async function handleCopy() {
    if (!gen.output) return;
    await navigator.clipboard.writeText(gen.output);
    toast.success("Copiado al portapapeles");
  }
  async function handleDelete() {
    const { error } = await supabase.from("generations").delete().eq("id", gen.id);
    if (error) return toast.error(error.message);
    onDelete();
    toast.success("Eliminado");
  }
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition p-3">
      <span className="text-xl">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground">
          {meta.label} · {relTime(gen.created_at)}
        </div>
      </div>
      <div className="flex gap-1">
        <IconBtn label="Ver" onClick={() => setViewing(true)}>
          <Eye className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Copiar" onClick={handleCopy}>
          <Copy className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Eliminar" onClick={handleDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </IconBtn>
      </div>
      <Dialog open={viewing} onOpenChange={setViewing}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {meta.icon} {title}
            </DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
            {gen.output ?? "Sin contenido"}
          </pre>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-8 h-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
    >
      {children}
    </button>
  );
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hace instantes";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

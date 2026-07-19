import { createFileRoute, Link } from "@tanstack/react-router";
import { useProfile } from "@/hooks/use-profile";
import { Lock, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tools/")({
  head: () => ({ meta: [{ title: "Herramientas — PostulPro" }] }),
  component: ToolsIndex,
});

type ToolCard = {
  id: string;
  to: string;
  icon: string;
  name: string;
  desc: string;
  gate: "free" | "pro" | "business";
  available: boolean;
};

const TOOLS: ToolCard[] = [
  { id: "copywriter", to: "/tools/copywriter", icon: "✍️", name: "Copywriter IA", desc: "Emails, posts, anuncios y más en segundos.", gate: "free", available: true },
  { id: "social-pack", to: "/tools/social-pack", icon: "📱", name: "Social Pack", desc: "LinkedIn, X, Instagram, FB y YouTube en un click.", gate: "free", available: true },
  { id: "sales-email", to: "/tools/sales-email", icon: "✉️", name: "Sales Email", desc: "Secuencias de 5 emails outbound listos para enviar.", gate: "free", available: true },
  { id: "landing-copy", to: "/tools/landing-copy", icon: "🎯", name: "Landing Copy", desc: "Headlines, features, FAQ y CTA de conversión.", gate: "free", available: true },
  { id: "email-sequences", to: "/tools/email-sequences", icon: "📬", name: "Email Sequences", desc: "Bienvenida, nurture, carrito, re-engagement.", gate: "pro", available: true },
  { id: "business-plan", to: "/tools/business-plan", icon: "📊", name: "Business Plan", desc: "Plan de negocios completo en 5 pasos.", gate: "pro", available: true },
  { id: "consultant", to: "/tools/consultant", icon: "🧠", name: "Consultor IA", desc: "Chat con estratega de negocios élite.", gate: "pro", available: true },
  { id: "api", to: "/tools", icon: "🔌", name: "API Access", desc: "Integra PostulPro en tu stack.", gate: "business", available: false },
];

const RANK: Record<string, number> = { free: 0, pro: 1, business: 2 };

function ToolsIndex() {
  const { profile } = useProfile();
  const userRank = RANK[profile?.plan ?? "free"] ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Herramientas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ejecuta cualquier herramienta con tus créditos disponibles.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TOOLS.map((tool) => {
          const locked = RANK[tool.gate] > userRank;
          const disabled = !tool.available || locked;
          return (
            <div
              key={tool.id}
              className={`rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col transition ${
                disabled ? "opacity-70" : "hover:bg-white/[0.08] hover:border-violet-500/40"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{tool.icon}</span>
                <Badge gate={tool.gate} available={tool.available} />
              </div>
              <h3 className="font-display font-bold">{tool.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground flex-1">{tool.desc}</p>
              {disabled ? (
                <button
                  type="button"
                  disabled
                  className="mt-4 inline-flex items-center justify-center gap-2 h-9 rounded-lg text-sm text-muted-foreground bg-white/5 cursor-not-allowed"
                >
                  {locked ? <><Lock className="w-3.5 h-3.5" /> Requiere {tool.gate.toUpperCase()}</> : "Próximamente"}
                </button>
              ) : (
                <Link
                  to={tool.to as "/tools/copywriter"}
                  className="mt-4 inline-flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition"
                >
                  Usar <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Badge({ gate, available }: { gate: string; available: boolean }) {
  if (!available) {
    return <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white/10 text-muted-foreground">SOON</span>;
  }
  if (gate === "free") return <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">DISPONIBLE</span>;
  if (gate === "pro") return <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30">PRO</span>;
  return <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">BUSINESS</span>;
}

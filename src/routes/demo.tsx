import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/demo")({
  head: () => ({ meta: [{ title: "Proyecto de ejemplo — PostulPro" }] }),
  component: DemoPage,
});

// A fully static, pre-written example — no live model calls, no credits
// spent, nothing generated on demand. Every deliverable excerpt below is
// clearly fictional and labeled as such; nothing here is a real customer
// result, a testimonial, or a promise of what the AI will produce for a
// real idea.

const EXAMPLE_IDEA = "Quiero lanzar un ebook sobre finanzas personales para freelancers.";

const EXAMPLE_BRIEF = {
  name: "Finanzas Claras para Freelancers",
  audience: "Freelancers de 25 a 40 años en LATAM que facturan de forma irregular",
  valueProposition: "Un sistema simple para organizar ingresos irregulares sin depender de una hoja de cálculo compleja",
  tone: "Cercano, directo, sin jerga financiera",
};

const EXAMPLE_DELIVERABLES = [
  {
    tool: "Business Plan IA",
    title: "Brief y oferta del ebook",
    excerpt: "## Propuesta de Valor\nUn ebook práctico de 40 páginas que enseña a freelancers a separar ingresos variables en 3 cuentas simples, sin plantillas complicadas...",
  },
  {
    tool: "Landing Copy",
    title: "Copy de la página de venta",
    excerpt: "Cobrás distinto cada mes. Tu sistema de plata también debería ser distinto. — Headline propuesto para el hero de la landing.",
  },
  {
    tool: "Email Sequences",
    title: "Secuencia de lanzamiento (5 emails)",
    excerpt: "Email 1 · Bienvenida — asunto: \"Por qué el freelance rompe las hojas de cálculo comunes\"...",
  },
  {
    tool: "Social Media Pack",
    title: "Pack de contenido para redes",
    excerpt: "LinkedIn: \"3 señales de que tu forma de organizar la plata no está hecha para ingresos irregulares 🧵\"...",
  },
] as const;

function DemoPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Volver a PostulPro
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
            Proyecto de ejemplo — no es un resultado real
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-8">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground mb-4">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Construir con IA
          </div>
          <h1 className="font-display text-3xl font-bold">Así se ve un proyecto en PostulPro</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Esta es una demostración estática con datos ficticios para mostrarte el recorrido. No se ejecutó ningún modelo de
            IA para generar esto y no representa resultados garantizados.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-400 mb-2">1. La idea</p>
          <p className="text-sm italic">"{EXAMPLE_IDEA}"</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">2. El brief que arma PostulPro</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Audiencia</p>
              <p className="text-sm mt-0.5">{EXAMPLE_BRIEF.audience}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tono</p>
              <p className="text-sm mt-0.5">{EXAMPLE_BRIEF.tone}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Propuesta de valor</p>
              <p className="text-sm mt-0.5">{EXAMPLE_BRIEF.valueProposition}</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-400 mb-3">3. Los entregables coordinados</p>
          <div className="space-y-3">
            {EXAMPLE_DELIVERABLES.map((d, i) => (
              <div key={d.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> {i + 1}
                  </span>
                  <span className="text-sm font-semibold">{d.title}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{d.tool}</span>
                </div>
                <p className="text-xs text-muted-foreground italic">"{d.excerpt}"</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Los 4 entregables comparten la misma audiencia, tono y propuesta de valor — por eso no se contradicen entre sí.
          </p>
        </div>

        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-6 text-center">
          <h2 className="font-display text-xl font-bold">¿Listo para tu propia idea?</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sin tarjeta. Empezás gratis y ves el plan antes de gastar un crédito.</p>
          <a
            href="/auth/register"
            className="mt-5 inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-gradient-brand text-white font-semibold text-sm hover:opacity-95 transition"
          >
            Crear mi propio proyecto <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </main>
    </div>
  );
}

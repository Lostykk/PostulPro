import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, ChevronDown, ArrowRight, X, Plus, GripVertical } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { projectsApiFetch, ApiError } from "@/lib/projects/api-client";
import type { ProjectBrief, ProjectPlan, PlanDeliverable } from "@/lib/projects/schema";

export const Route = createFileRoute("/_authenticated/build")({
  head: () => ({ meta: [{ title: "Construir con IA — PostulPro" }] }),
  component: BuildPage,
});

const EXAMPLES = [
  "Quiero lanzar un ebook sobre finanzas personales.",
  "Quiero vender un servicio de automatización para inmobiliarias.",
  "Quiero crear un curso online de fotografía.",
  "Quiero validar una idea SaaS para restaurantes.",
];

const PRESETS = [
  { label: "Lanzar un producto digital", template: "Quiero lanzar " },
  { label: "Vender un servicio", template: "Quiero ofrecer un servicio de " },
  { label: "Crear una campaña", template: "Quiero una campaña para " },
  { label: "Construir una marca", template: "Quiero construir la marca de " },
  { label: "Validar una idea", template: "Quiero validar la idea de " },
  { label: "Otro", template: "" },
];

type Phase = "idea" | "planning" | "plan";

function BuildPage() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [phase, setPhase] = useState<Phase>("idea");
  const [idea, setIdea] = useState("");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState("es");
  const [showMore, setShowMore] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [executionMode, setExecutionMode] = useState<"guided" | "automatic">("guided");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (idea.length > 0) return;
    const id = window.setInterval(() => setExampleIdx((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => window.clearInterval(id);
  }, [idea]);

  async function handleDesign() {
    if (idea.trim().length < 8) {
      toast.error("Contanos un poco más sobre tu idea.");
      return;
    }
    setPhase("planning");
    try {
      const created = await projectsApiFetch<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          idea,
          objective: objective || undefined,
          targetAudience: audience || undefined,
          language,
          executionMode,
        }),
      });
      setProjectId(created.id);

      const planned = await projectsApiFetch<{ brief: ProjectBrief; plan: ProjectPlan }>(
        `/api/projects/${created.id}/plan`,
        { method: "POST" },
      );
      setBrief(planned.brief);
      setPlan(planned.plan);
      setPhase("plan");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo diseñar el proyecto.");
      setPhase("idea");
    }
  }

  async function handleConfirm() {
    if (!projectId) return;
    setConfirming(true);
    try {
      await projectsApiFetch(`/api/projects/${projectId}/confirm`, { method: "POST" });
      navigate({ to: "/projects/$id", params: { id: projectId } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo confirmar el plan.");
    } finally {
      setConfirming(false);
    }
  }

  function removeDeliverable(index: number) {
    if (!plan) return;
    setPlan({ ...plan, deliverables: plan.deliverables.filter((_, i) => i !== index) });
  }

  async function saveEditedPlan(next: PlanDeliverable[]) {
    if (!projectId || !plan) return;
    try {
      const result = await projectsApiFetch<{ plan: ProjectPlan }>(`/api/projects/${projectId}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ deliverables: next.map(({ estimatedCredits: _drop, ...rest }) => rest) }),
      });
      setPlan(result.plan);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo actualizar el plan.");
    }
  }

  if (phase === "plan" && plan && brief && projectId) {
    return (
      <PlanReview
        brief={brief}
        plan={plan}
        creditsRemaining={profile ? profile.credits_limit - profile.credits_used : null}
        executionMode={executionMode}
        onExecutionModeChange={setExecutionMode}
        onRemoveDeliverable={(i) => {
          removeDeliverable(i);
          void saveEditedPlan(plan.deliverables.filter((_, idx) => idx !== i));
        }}
        onConfirm={handleConfirm}
        confirming={confirming}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-12 md:py-20">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground mb-4">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Construir con IA
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">¿Qué querés construir?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Describí tu idea con tus propias palabras. PostulPro diseña el plan y elige las herramientas.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={EXAMPLES[exampleIdx]}
          rows={4}
          maxLength={4000}
          className="input min-h-[120px] resize-y text-base"
          disabled={phase === "planning"}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setIdea((prev) => (prev ? prev : p.template))}
              className="px-3 h-8 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} />
          Más detalles (opcional)
        </button>
        {showMore && (
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">Objetivo</span>
              <input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ej: conseguir mis primeros 10 clientes" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">Audiencia</span>
              <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Ej: dueños de inmobiliarias en LATAM" />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">Idioma</span>
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="es" className="bg-background">Español</option>
                <option value="en" className="bg-background">English</option>
                <option value="pt" className="bg-background">Português</option>
              </select>
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={handleDesign}
          disabled={phase === "planning" || idea.trim().length < 8}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
        >
          {phase === "planning" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Interpretando tu idea…
            </>
          ) : (
            <>
              Diseñar mi proyecto <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function PlanReview({
  brief,
  plan,
  creditsRemaining,
  executionMode,
  onExecutionModeChange,
  onRemoveDeliverable,
  onConfirm,
  confirming,
}: {
  brief: ProjectBrief;
  plan: ProjectPlan;
  creditsRemaining: number | null;
  executionMode: "guided" | "automatic";
  onExecutionModeChange: (m: "guided" | "automatic") => void;
  onRemoveDeliverable: (index: number) => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const insufficientCredits = creditsRemaining !== null && creditsRemaining < plan.totalEstimatedCredits;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 space-y-6">
      <header>
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-400">Plan de proyecto</span>
        <h1 className="font-display text-2xl md:text-3xl font-bold mt-1">{plan.title}</h1>
        {plan.summary && <p className="mt-2 text-sm text-muted-foreground">{plan.summary}</p>}
      </header>

      <div className="grid sm:grid-cols-2 gap-3">
        <InfoCard label="Audiencia" value={brief.audience || "No especificada"} />
        <InfoCard label="Propuesta de valor" value={brief.valueProposition || "No especificada"} />
      </div>

      {(plan.assumptions.length > 0 || plan.questionsOrWarnings.length > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
          {plan.assumptions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-300 mb-1">Supuestos</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {plan.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
            </div>
          )}
          {plan.questionsOrWarnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-300 mb-1">Para tener en cuenta</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {plan.questionsOrWarnings.map((q, i) => <li key={i}>• {q}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="font-display font-bold mb-3">Entregables ({plan.deliverables.length})</h2>
        <div className="space-y-2">
          {plan.deliverables.map((d, i) => (
            <div key={`${d.toolKey}-${i}`} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300">{i + 1}</span>
                  <span className="font-semibold text-sm">{d.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                {d.reason && <p className="mt-1 text-[11px] text-muted-foreground/70 italic">{d.reason}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{d.estimatedCredits} créd.</span>
                {plan.deliverables.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveDeliverable(i)}
                    aria-label="Quitar entregable"
                    className="w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Costo estimado del proyecto</p>
          <p className="font-display text-xl font-bold">{plan.totalEstimatedCredits} créditos</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Tu saldo</p>
          <p className={`font-semibold ${insufficientCredits ? "text-red-400" : ""}`}>
            {creditsRemaining !== null ? `${creditsRemaining} créditos` : "—"}
          </p>
        </div>
      </div>
      {insufficientCredits && (
        <p className="text-xs text-red-400">
          No tenés créditos suficientes para todo el plan. Podés confirmar igual y ejecutar los pasos que alcances, o sacar entregables.
        </p>
      )}

      <div>
        <h2 className="font-display font-bold mb-3">Modo de ejecución</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <ModeCard
            active={executionMode === "guided"}
            title="Guiado"
            desc="Aprobás cada entregable antes de que se genere. Podés editar, saltar o regenerar en el camino."
            onClick={() => onExecutionModeChange("guided")}
          />
          <ModeCard
            active={executionMode === "automatic"}
            title="Automático"
            desc="Se ejecutan los pasos en orden, uno por vez. Se detiene ante un error o falta de créditos."
            onClick={() => onExecutionModeChange("automatic")}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={confirming}
        className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-60"
      >
        {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Construir proyecto
      </button>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function ModeCard({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        active ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <p className="font-semibold text-sm">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

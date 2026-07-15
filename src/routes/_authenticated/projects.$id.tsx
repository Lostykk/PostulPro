import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  RotateCcw,
  SkipForward,
  Pause,
  PlayCircle,
  Copy,
  Download,
  Star,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Circle,
  Sparkles,
  ArrowRight,
  X,
  GripVertical,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { useProjectStepStream } from "@/hooks/use-project-step-stream";
import { projectsApiFetch, ApiError } from "@/lib/projects/api-client";
import { downloadTxt } from "@/hooks/use-ai-stream";
import { canClaimStep, canSkipStep, canPause, canResume } from "@/lib/projects/state-machine";
import type { ProjectBrief, ProjectPlan, ProjectStatus, StepStatus } from "@/lib/projects/schema";
import { DeliverableRenderer } from "@/components/deliverables/DeliverableRenderer";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Proyecto — PostulPro" }] }),
  component: WorkspacePage,
});

type ProjectRow = {
  id: string;
  title: string | null;
  original_idea: string;
  status: string;
  execution_mode: string;
  brief_json: ProjectBrief | null;
  plan_json: ProjectPlan | null;
  estimated_credits: number;
  spent_credits: number;
  progress_percent: number;
  current_step_id: string | null;
  last_error_code: string | null;
};

// Shown while the workspace has triggered (or is waiting on) plan
// generation — rotates so a slow provider call doesn't look frozen.
const PLANNING_MESSAGES = [
  "Creando la estructura de tu proyecto…",
  "Diseñando la estrategia…",
  "Organizando los entregables…",
];

type StepRow = {
  id: string;
  position: number;
  tool_key: string;
  title: string;
  description: string | null;
  status: string;
  credits_cost: number;
  attempts: number;
  error_code: string | null;
  error_message_safe: string | null;
  output_generation_id: string | null;
};

type GenCache = { output: string; editedOutput: string | null; approvals: Record<string, boolean> };

const TOOL_ROUTE: Record<string, string> = {
  copywriter: "/tools/copywriter",
  "social-pack": "/tools/social-pack",
  "business-plan": "/tools/business-plan",
  "sales-email": "/tools/sales-email",
  "landing-copy": "/tools/landing-copy",
  "email-sequences": "/tools/email-sequences",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  planning: "Planificando",
  awaiting_confirmation: "Por confirmar",
  ready: "Listo",
  running: "En progreso",
  paused: "Pausado",
  completed: "Completado",
  failed: "Con error",
  archived: "Archivado",
};

function WorkspacePage() {
  const { id } = Route.useParams();
  const { profile, refresh: refreshProfile } = useProfile();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genCache, setGenCache] = useState<Record<string, GenCache>>({});
  const [autoRunning, setAutoRunning] = useState(false);
  const [planningInFlight, setPlanningInFlight] = useState(false);
  const [planningMessageIdx, setPlanningMessageIdx] = useState(0);
  // Guards against re-firing the automatic trigger on every re-render/reload
  // of the same mounted page — exactly one automatic attempt per page load
  // while status is "planning". A user-initiated retry (button) bypasses
  // this ref deliberately, since that's an explicit, separate action.
  const planAutoTriggeredRef = useRef(false);
  const { output: liveOutput, streaming, activeStepId, run } = useProjectStepStream();

  const load = useCallback(async () => {
    try {
      const data = await projectsApiFetch<{ project: ProjectRow; steps: StepRow[] }>(
        `/api/projects/${id}`,
      );
      setProject(data.project);
      setSteps(data.steps);
      setSelectedId((prev) => prev ?? data.project.current_step_id ?? data.steps[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo cargar el proyecto.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rotates the "planning" copy so a slow provider call reads as progress,
  // not a frozen screen. Only runs while there's actually something to wait
  // on — no interval left running once the page moves past this state.
  useEffect(() => {
    if (!planningInFlight) return;
    const t = window.setInterval(
      () => setPlanningMessageIdx((i) => (i + 1) % PLANNING_MESSAGES.length),
      2200,
    );
    return () => window.clearInterval(t);
  }, [planningInFlight]);

  const triggerPlanning = useCallback(async () => {
    setPlanningInFlight(true);
    try {
      await projectsApiFetch(`/api/projects/${id}/plan`, { method: "POST" });
    } catch {
      // The server already persisted a real "failed" state (see
      // fail_ai_project_planning) — the reload below picks that up and
      // renders the retry UI with the server's own safe error message, so
      // nothing needs to be re-derived or toasted here.
    } finally {
      setPlanningInFlight(false);
      await load();
    }
  }, [id, load]);

  // Exactly one automatic attempt per page load while the project is still
  // "planning" — this is what recovers a project that was left stranded by
  // a previous failed attempt (see docs on fail_ai_project_planning): simply
  // opening its workspace re-triggers planning on the SAME project id,
  // never a new one. Does not fire for "awaiting_confirmation" (a plan
  // already exists there — see the render branch below) or "failed" (that
  // state requires an explicit "Reintentar" click, not another silent auto-retry).
  useEffect(() => {
    if (!project || planAutoTriggeredRef.current) return;
    if (project.status !== "planning") return;
    planAutoTriggeredRef.current = true;
    void triggerPlanning();
  }, [project, triggerPlanning]);

  const selected = steps?.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected || selected.status !== "completed" || !selected.output_generation_id) return;
    if (genCache[selected.id]) return;
    supabase
      .from("generations")
      .select("output,edited_output,approvals_json")
      .eq("id", selected.output_generation_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.output) {
          setGenCache((prev) => ({
            ...prev,
            [selected.id]: {
              output: data.output as string,
              editedOutput: (data.edited_output as string | null) ?? null,
              approvals: (data.approvals_json as Record<string, boolean> | null) ?? {},
            },
          }));
        }
      });
  }, [selected, genCache]);

  async function runStep(stepId: string) {
    const result = await run(`/api/projects/${id}/steps/${stepId}/run`, stepId);
    if (result) {
      setGenCache((prev) => ({
        ...prev,
        [stepId]: { output: result.text, editedOutput: null, approvals: {} },
      }));
      void refreshProfile();
    }
    await load();
  }

  async function retryStep(stepId: string) {
    const result = await run(`/api/projects/${id}/steps/${stepId}/retry`, stepId);
    if (result) {
      setGenCache((prev) => ({
        ...prev,
        [stepId]: { output: result.text, editedOutput: null, approvals: {} },
      }));
      void refreshProfile();
    }
    await load();
  }

  async function saveEditedOutput(stepId: string, generationId: string, newText: string) {
    const { error } = await supabase
      .from("generations")
      .update({ edited_output: newText })
      .eq("id", generationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGenCache((prev) => ({ ...prev, [stepId]: { ...prev[stepId], editedOutput: newText } }));
  }

  async function restoreGeneratedOutput(stepId: string, generationId: string) {
    const { error } = await supabase
      .from("generations")
      .update({ edited_output: null })
      .eq("id", generationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGenCache((prev) => ({ ...prev, [stepId]: { ...prev[stepId], editedOutput: null } }));
  }

  async function toggleApproval(
    stepId: string,
    generationId: string,
    blockTitle: string,
    approved: boolean,
  ) {
    const current = genCache[stepId]?.approvals ?? {};
    const next = { ...current, [blockTitle]: approved };
    const { error } = await supabase
      .from("generations")
      .update({ approvals_json: next })
      .eq("id", generationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGenCache((prev) => ({ ...prev, [stepId]: { ...prev[stepId], approvals: next } }));
  }

  async function skipStep(stepId: string) {
    try {
      await projectsApiFetch(`/api/projects/${id}/steps/${stepId}/skip`, { method: "POST" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo saltar el paso.");
    }
  }

  async function togglePause() {
    if (!project) return;
    try {
      await projectsApiFetch(
        `/api/projects/${id}/${canPause(project.status as ProjectStatus) ? "pause" : "resume"}`,
        { method: "POST" },
      );
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo actualizar el proyecto.");
    }
  }

  async function runAutomatic() {
    setAutoRunning(true);
    try {
      for (;;) {
        const current = await projectsApiFetch<{ project: ProjectRow }>(`/api/projects/${id}`);
        if (!["ready", "running", "paused"].includes(current.project.status)) break;
        const result = await run(
          `/api/projects/${id}/run-next`,
          current.project.current_step_id ?? "",
        );
        void refreshProfile();
        await load();
        if (!result) break; // error/abort — stop the auto loop, state is already persisted
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "El modo automático se detuvo por un error.",
      );
    } finally {
      setAutoRunning(false);
      await load();
    }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  }

  async function handleSave(generationId: string) {
    const { error } = await supabase
      .from("generations")
      .update({ is_favorite: true })
      .eq("id", generationId);
    if (error) return toast.error(error.message);
    toast.success("Guardado en favoritos de tu biblioteca");
  }

  if (!project || steps === null) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-3">
        <div className="h-10 w-2/3 rounded-lg bg-white/5 animate-pulse" />
        <div className="h-40 rounded-xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  // The plan hasn't been generated yet (or is being regenerated after a
  // retry) — this is the state the project sits in immediately after
  // /build creates it and navigates here, before any deliverable exists.
  if (project.status === "planning") {
    return <PlanningInProgress idea={project.original_idea} messageIdx={planningMessageIdx} />;
  }

  // Failed specifically during planning (no plan_json was ever saved) —
  // distinct from a step-execution failure, which keeps the normal
  // steps/credits view below (plan_json exists there) so real progress is
  // never hidden behind this screen.
  if (project.status === "failed" && !project.plan_json) {
    return (
      <PlanningFailed
        idea={project.original_idea}
        retrying={planningInFlight}
        onRetry={() => void triggerPlanning()}
      />
    );
  }

  if (project.status === "awaiting_confirmation" && project.brief_json && project.plan_json) {
    return (
      <PlanConfirmation
        projectId={project.id}
        brief={project.brief_json}
        plan={project.plan_json}
        initialExecutionMode={(project.execution_mode as "guided" | "automatic") ?? "guided"}
        creditsRemaining={profile ? profile.credits_limit - profile.credits_used : null}
        onConfirmed={load}
      />
    );
  }

  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">
              {project.title || "Tu proyecto"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">{project.original_idea}</p>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 whitespace-nowrap">
            {STATUS_LABEL[project.status] ?? project.status}
          </span>
        </div>
        <div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${project.progress_percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
            <span>
              {done}/{steps.length} entregables · {project.progress_percent}%
            </span>
            <span>
              {project.spent_credits}/{project.estimated_credits} créditos usados
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {project.execution_mode === "automatic" &&
            ["ready", "running", "paused"].includes(project.status) && (
              <button
                type="button"
                onClick={() => (autoRunning ? togglePause() : void runAutomatic())}
                disabled={streaming && !autoRunning}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-50"
              >
                {autoRunning ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pausar
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-3.5 h-3.5" /> Ejecutar automáticamente
                  </>
                )}
              </button>
            )}
          {(canPause(project.status as ProjectStatus) ||
            canResume(project.status as ProjectStatus)) &&
            !autoRunning && (
              <button
                type="button"
                onClick={togglePause}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                {canPause(project.status as ProjectStatus) ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pausar
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-3.5 h-3.5" /> Reanudar
                  </>
                )}
              </button>
            )}
        </div>
      </header>

      {project.status === "completed" && <CompletionBanner stepsCount={steps.length} />}

      <div className="grid md:grid-cols-[280px_1fr] gap-6">
        <nav className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`shrink-0 text-left w-64 md:w-full p-3 rounded-xl border transition ${
                selectedId === s.id
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <StepStatusIcon status={s.status} />
                <span className="text-sm font-medium truncate">{s.title}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.credits_cost} créditos · {STATUS_LABEL[s.status] ?? s.status}
              </p>
            </button>
          ))}
        </nav>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 min-h-[300px]">
          {selected && (
            <StepDetail
              step={selected}
              projectId={project.id}
              isStreaming={streaming && activeStepId === selected.id}
              liveOutput={activeStepId === selected.id ? liveOutput : ""}
              gen={genCache[selected.id]}
              toolRoute={TOOL_ROUTE[selected.tool_key]}
              onRun={() => runStep(selected.id)}
              onRetry={() => retryStep(selected.id)}
              onSkip={() => skipStep(selected.id)}
              onCopy={handleCopy}
              onFavorite={handleSave}
              onSaveEdit={(text) =>
                saveEditedOutput(selected.id, selected.output_generation_id!, text)
              }
              onRestore={() => restoreGeneratedOutput(selected.id, selected.output_generation_id!)}
              onToggleApproval={(blockTitle, approved) =>
                toggleApproval(selected.id, selected.output_generation_id!, blockTitle, approved)
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
  if (status === "running")
    return <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />;
  if (status === "skipped")
    return <SkipForward className="w-4 h-4 text-muted-foreground shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function StepDetail({
  step,
  projectId,
  isStreaming,
  liveOutput,
  gen,
  toolRoute,
  onRun,
  onRetry,
  onSkip,
  onCopy,
  onFavorite,
  onSaveEdit,
  onRestore,
  onToggleApproval,
}: {
  step: StepRow;
  projectId: string;
  isStreaming: boolean;
  liveOutput: string;
  gen?: { output: string; editedOutput: string | null; approvals: Record<string, boolean> };
  toolRoute?: string;
  onRun: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onCopy: (text: string) => void;
  onFavorite: (generationId: string) => void;
  onSaveEdit: (newText: string) => void | Promise<void>;
  onRestore: () => void | Promise<void>;
  onToggleApproval: (blockTitle: string, approved: boolean) => void | Promise<void>;
}) {
  const displayText = isStreaming ? liveOutput : (gen?.editedOutput ?? gen?.output ?? "");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{step.title}</h2>
          {step.description && (
            <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
          )}
        </div>
        {toolRoute && step.status === "completed" && (
          <Link
            to={toolRoute}
            search={{ projectId, stepId: step.id }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            Abrir herramienta <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      {step.status === "failed" && step.error_message_safe && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
          {step.error_message_safe}
        </div>
      )}

      {(step.status === "pending" || step.status === "ready") && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRun}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-95 transition"
          >
            <Play className="w-4 h-4" /> Ejecutar ({step.credits_cost} créditos)
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
          >
            <SkipForward className="w-3.5 h-3.5" /> Saltar
          </button>
        </div>
      )}

      {step.status === "failed" && canClaimStep(step.status as StepStatus) && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 transition"
          >
            <RotateCcw className="w-4 h-4" /> Reintentar
          </button>
          {canSkipStep(step.status as StepStatus) && (
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
            >
              <SkipForward className="w-3.5 h-3.5" /> Saltar
            </button>
          )}
        </div>
      )}

      {isStreaming && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
            {liveOutput}
          </pre>
          <span className="inline-block w-2 h-4 ml-0.5 bg-violet-400 animate-pulse align-middle" />
        </div>
      )}

      {!isStreaming && step.status === "completed" && gen && (
        <DeliverableRenderer
          toolKey={step.tool_key}
          output={gen.output}
          editedOutput={gen.editedOutput}
          approvals={gen.approvals}
          title={step.title}
          onSave={onSaveEdit}
          onRestore={onRestore}
          onToggleApproval={onToggleApproval}
        />
      )}

      {step.status === "completed" && displayText && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onCopy(displayText)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          <button
            type="button"
            onClick={() =>
              downloadTxt(displayText, `${step.title.slice(0, 40).replace(/\s+/g, "-")}.txt`)
            }
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Download className="w-3.5 h-3.5" /> Descargar
          </button>
          {step.output_generation_id && (
            <button
              type="button"
              onClick={() => onFavorite(step.output_generation_id!)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
            >
              <Star className="w-3.5 h-3.5" /> Guardar en favoritos
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CompletionBanner({ stepsCount }: { stepsCount: number }) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 grid place-items-center">
          <Sparkles className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <p className="font-semibold text-sm">Tus {stepsCount} entregables están listos.</p>
          <p className="text-xs text-muted-foreground">
            Revisalos, editalos o descargalos — quedan guardados en tu Biblioteca.
          </p>
        </div>
      </div>
      <Link
        to="/build"
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
      >
        Crear otro proyecto <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

function PlanningInProgress({ idea, messageIdx }: { idea: string; messageIdx: number }) {
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-20 text-center">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-10">
        <Loader2 className="w-10 h-10 mx-auto mb-4 text-violet-300 animate-spin" />
        <h1 className="font-display text-xl font-bold">{PLANNING_MESSAGES[messageIdx]}</h1>
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{idea}</p>
      </div>
    </div>
  );
}

function PlanningFailed({
  idea,
  retrying,
  onRetry,
}: {
  idea: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-red-500/10 to-red-500/5 p-10">
        <AlertTriangle className="w-10 h-10 mx-auto mb-4 text-red-300" />
        <h1 className="font-display text-xl font-bold">
          No pudimos completar la planificación. Tu saldo no fue afectado. Podés reintentar este
          mismo proyecto.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{idea}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-6 inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          Reintentar
        </button>
      </div>
    </div>
  );
}

function PlanConfirmation({
  projectId,
  brief,
  plan: initialPlan,
  initialExecutionMode,
  creditsRemaining,
  onConfirmed,
}: {
  projectId: string;
  brief: ProjectBrief;
  plan: ProjectPlan;
  initialExecutionMode: "guided" | "automatic";
  creditsRemaining: number | null;
  onConfirmed: () => void | Promise<void>;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [executionMode, setExecutionMode] = useState(initialExecutionMode);
  const [confirming, setConfirming] = useState(false);
  const insufficientCredits =
    creditsRemaining !== null && creditsRemaining < plan.totalEstimatedCredits;

  async function saveEditedPlan(next: typeof plan.deliverables) {
    try {
      const result = await projectsApiFetch<{ plan: ProjectPlan }>(
        `/api/projects/${projectId}/plan`,
        {
          method: "PATCH",
          body: JSON.stringify({
            deliverables: next.map(({ estimatedCredits: _drop, ...rest }) => rest),
          }),
        },
      );
      setPlan(result.plan);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo actualizar el plan.");
    }
  }

  function removeDeliverable(index: number) {
    const next = plan.deliverables.filter((_, i) => i !== index);
    setPlan({ ...plan, deliverables: next });
    void saveEditedPlan(next);
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      await projectsApiFetch(`/api/projects/${projectId}/confirm`, { method: "POST" });
      await onConfirmed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo confirmar el plan.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 space-y-6">
      <header>
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-400">
          Plan de proyecto
        </span>
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
                {plan.assumptions.map((a, i) => (
                  <li key={i}>• {a}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.questionsOrWarnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-300 mb-1">Para tener en cuenta</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {plan.questionsOrWarnings.map((q, i) => (
                  <li key={i}>• {q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="font-display font-bold mb-3">Entregables ({plan.deliverables.length})</h2>
        <div className="space-y-2">
          {plan.deliverables.map((d, i) => (
            <div
              key={`${d.toolKey}-${i}`}
              className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-sm">{d.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                {d.reason && (
                  <p className="mt-1 text-[11px] text-muted-foreground/70 italic">{d.reason}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{d.estimatedCredits} créd.</span>
                {plan.deliverables.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDeliverable(i)}
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
          No tenés créditos suficientes para todo el plan. Podés confirmar igual y ejecutar los
          pasos que alcances, o sacar entregables.
        </p>
      )}

      <div>
        <h2 className="font-display font-bold mb-3">Modo de ejecución</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <ModeCard
            active={executionMode === "guided"}
            title="Guiado"
            desc="Aprobás cada entregable antes de que se genere. Podés editar, saltar o regenerar en el camino."
            onClick={() => setExecutionMode("guided")}
          />
          <ModeCard
            active={executionMode === "automatic"}
            title="Automático"
            desc="Se ejecutan los pasos en orden, uno por vez. Se detiene ante un error o falta de créditos."
            onClick={() => setExecutionMode("automatic")}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleConfirm}
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

function ModeCard({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        active
          ? "border-violet-500 bg-violet-500/10"
          : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <p className="font-semibold text-sm">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

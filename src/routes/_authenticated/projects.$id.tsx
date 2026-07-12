import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { useProjectStepStream } from "@/hooks/use-project-step-stream";
import { projectsApiFetch, ApiError } from "@/lib/projects/api-client";
import { downloadTxt } from "@/hooks/use-ai-stream";
import { canClaimStep, canSkipStep, canPause, canResume } from "@/lib/projects/state-machine";
import type { ProjectBrief, ProjectStatus, StepStatus } from "@/lib/projects/schema";

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
  estimated_credits: number;
  spent_credits: number;
  progress_percent: number;
  current_step_id: string | null;
  last_error_code: string | null;
};

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
  const { refresh: refreshProfile } = useProfile();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outputCache, setOutputCache] = useState<Record<string, string>>({});
  const [autoRunning, setAutoRunning] = useState(false);
  const { output: liveOutput, streaming, activeStepId, run } = useProjectStepStream();

  const load = useCallback(async () => {
    try {
      const data = await projectsApiFetch<{ project: ProjectRow; steps: StepRow[] }>(`/api/projects/${id}`);
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

  const selected = steps?.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected || selected.status !== "completed" || !selected.output_generation_id) return;
    if (outputCache[selected.id]) return;
    supabase
      .from("generations")
      .select("output")
      .eq("id", selected.output_generation_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.output) setOutputCache((prev) => ({ ...prev, [selected.id]: data.output as string }));
      });
  }, [selected, outputCache]);

  async function runStep(stepId: string) {
    const result = await run(`/api/projects/${id}/steps/${stepId}/run`, stepId);
    if (result) {
      setOutputCache((prev) => ({ ...prev, [stepId]: result.text }));
      void refreshProfile();
    }
    await load();
  }

  async function retryStep(stepId: string) {
    const result = await run(`/api/projects/${id}/steps/${stepId}/retry`, stepId);
    if (result) {
      setOutputCache((prev) => ({ ...prev, [stepId]: result.text }));
      void refreshProfile();
    }
    await load();
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
      await projectsApiFetch(`/api/projects/${id}/${canPause(project.status as ProjectStatus) ? "pause" : "resume"}`, { method: "POST" });
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
        const result = await run(`/api/projects/${id}/run-next`, current.project.current_step_id ?? "");
        void refreshProfile();
        await load();
        if (!result) break; // error/abort — stop the auto loop, state is already persisted
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "El modo automático se detuvo por un error.");
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
    const { error } = await supabase.from("generations").update({ is_favorite: true }).eq("id", generationId);
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

  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">{project.title || "Tu proyecto"}</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">{project.original_idea}</p>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 whitespace-nowrap">
            {STATUS_LABEL[project.status] ?? project.status}
          </span>
        </div>
        <div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${project.progress_percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
            <span>{done}/{steps.length} entregables · {project.progress_percent}%</span>
            <span>{project.spent_credits}/{project.estimated_credits} créditos usados</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {project.execution_mode === "automatic" && ["ready", "running", "paused"].includes(project.status) && (
            <button
              type="button"
              onClick={() => (autoRunning ? togglePause() : void runAutomatic())}
              disabled={streaming && !autoRunning}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-50"
            >
              {autoRunning ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><PlayCircle className="w-3.5 h-3.5" /> Ejecutar automáticamente</>}
            </button>
          )}
          {(canPause(project.status as ProjectStatus) || canResume(project.status as ProjectStatus)) && !autoRunning && (
            <button
              type="button"
              onClick={togglePause}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
            >
              {canPause(project.status as ProjectStatus) ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><PlayCircle className="w-3.5 h-3.5" /> Reanudar</>}
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
                selectedId === s.id ? "border-violet-500/50 bg-violet-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <StepStatusIcon status={s.status} />
                <span className="text-sm font-medium truncate">{s.title}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{s.credits_cost} créditos · {STATUS_LABEL[s.status] ?? s.status}</p>
            </button>
          ))}
        </nav>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 min-h-[300px]">
          {selected && (
            <StepDetail
              step={selected}
              isStreaming={streaming && activeStepId === selected.id}
              liveOutput={activeStepId === selected.id ? liveOutput : ""}
              cachedOutput={outputCache[selected.id]}
              toolRoute={TOOL_ROUTE[selected.tool_key]}
              onRun={() => runStep(selected.id)}
              onRetry={() => retryStep(selected.id)}
              onSkip={() => skipStep(selected.id)}
              onCopy={handleCopy}
              onSave={handleSave}
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
  if (status === "running") return <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />;
  if (status === "skipped") return <SkipForward className="w-4 h-4 text-muted-foreground shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function StepDetail({
  step,
  isStreaming,
  liveOutput,
  cachedOutput,
  toolRoute,
  onRun,
  onRetry,
  onSkip,
  onCopy,
  onSave,
}: {
  step: StepRow;
  isStreaming: boolean;
  liveOutput: string;
  cachedOutput?: string;
  toolRoute?: string;
  onRun: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onCopy: (text: string) => void;
  onSave: (generationId: string) => void;
}) {
  const displayText = isStreaming ? liveOutput : cachedOutput ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{step.title}</h2>
          {step.description && <p className="text-sm text-muted-foreground mt-1">{step.description}</p>}
        </div>
        {toolRoute && step.status === "completed" && (
          <Link to={toolRoute} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap">
            Abrir herramienta <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      {step.status === "failed" && step.error_message_safe && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">{step.error_message_safe}</div>
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

      {(isStreaming || displayText) && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">{displayText}</pre>
          {isStreaming && <span className="inline-block w-2 h-4 ml-0.5 bg-violet-400 animate-pulse align-middle" />}
        </div>
      )}

      {step.status === "completed" && displayText && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => onCopy(displayText)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition">
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          <button
            type="button"
            onClick={() => downloadTxt(displayText, `${step.title.slice(0, 40).replace(/\s+/g, "-")}.txt`)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Download className="w-3.5 h-3.5" /> Descargar
          </button>
          {step.output_generation_id && (
            <button
              type="button"
              onClick={() => onSave(step.output_generation_id!)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
            >
              <Star className="w-3.5 h-3.5" /> Guardar
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
          <p className="text-xs text-muted-foreground">Revisalos, editalos o descargalos — quedan guardados en tu Biblioteca.</p>
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

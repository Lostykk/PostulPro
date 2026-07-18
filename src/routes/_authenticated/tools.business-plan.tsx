import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Download, FileDown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAiStream, downloadTxt } from "@/hooks/use-ai-stream";
import { exportReportPdf } from "@/lib/pdf-export";
import { useProjectStepContext, type StepGeneration } from "@/hooks/use-project-step-context";
import { saveEditedOutput, restoreGeneratedOutput } from "@/lib/deliverables/generation-actions";
import { DeliverableRenderer } from "@/components/deliverables/DeliverableRenderer";
import { ProjectContextBanner } from "@/components/deliverables/ProjectContextBanner";
import { SimpleSelect } from "@/components/ui/simple-select";

export const Route = createFileRoute("/_authenticated/tools/business-plan")({
  head: () => ({ meta: [{ title: "Business Plan — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { projectId?: string; stepId?: string } => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
    stepId: typeof search.stepId === "string" ? search.stepId : undefined,
  }),
  component: BusinessPlanPage,
});

const REVENUE_STREAMS = [
  "Suscripción",
  "Venta única",
  "Freemium",
  "Marketplace/Comisión",
  "Publicidad",
  "Licencias",
];
const LAUNCH_TYPES = [
  "Soft launch",
  "Lanzamiento público",
  "Beta cerrada",
  "Product Hunt",
  "Crowdfunding",
];

type FormState = {
  name: string;
  oneLiner: string;
  problem: string;
  solution: string;
  industry: string;
  country: string;
  model: "B2B" | "B2C";
  marketSize: string;
  competitors: string;
  revenueStreams: string[];
  price: string;
  cac: string;
  channel: string;
  initialInvestment: string;
  goalMonth1: string;
  goalMonth6: string;
  goalMonth12: string;
  fixedCosts: string;
  advantage: string;
  launchType: string;
  timeline: string;
};

const EMPTY: FormState = {
  name: "",
  oneLiner: "",
  problem: "",
  solution: "",
  industry: "",
  country: "",
  model: "B2C",
  marketSize: "",
  competitors: "",
  revenueStreams: [],
  price: "",
  cac: "",
  channel: "",
  initialInvestment: "",
  goalMonth1: "",
  goalMonth6: "",
  goalMonth12: "",
  fixedCosts: "",
  advantage: "",
  launchType: LAUNCH_TYPES[0],
  timeline: "",
};

function buildPrompt(f: FormState): string {
  return `Genera un business plan completo y profesional en español para la siguiente idea de negocio. Enfoque en LATAM y modelos digitales.

## Idea
Nombre: ${f.name}
Descripción en una frase: ${f.oneLiner}
Problema: ${f.problem}
Solución: ${f.solution}
Industria: ${f.industry}

## Mercado
País: ${f.country}
Tipo: ${f.model}
Tamaño de mercado estimado por el usuario: ${f.marketSize || "no especificado"}
Competidores: ${f.competitors || "no especificados"}

## Modelo de negocio
Fuentes de ingreso: ${f.revenueStreams.join(", ") || "no especificadas"}
Precio: ${f.price || "no especificado"}
CAC estimado: ${f.cac || "no especificado"}
Canal principal: ${f.channel || "no especificado"}

## Finanzas
Inversión inicial: ${f.initialInvestment || "no especificada"}
Meta mes 1: ${f.goalMonth1 || "no especificada"}
Meta mes 6: ${f.goalMonth6 || "no especificada"}
Meta mes 12: ${f.goalMonth12 || "no especificada"}
Costos fijos mensuales: ${f.fixedCosts || "no especificados"}

## Estrategia
Ventaja competitiva: ${f.advantage || "no especificada"}
Tipo de lanzamiento: ${f.launchType}
Timeline: ${f.timeline || "no especificado"}

Estructura la respuesta con estas secciones marcadas con "## ":
Resumen Ejecutivo, Análisis de Mercado, Propuesta de Valor, Modelo de Negocio, Plan Financiero (incluye una tabla de proyecciones mes a mes para 12 meses), Marketing y Ventas, Roadmap, Riesgos, KPIs, Próximos 10 Pasos.

IMPORTANTE: cualquier cifra de mercado, proyección financiera o estimación que no venga de los datos provistos por el usuario debe etiquetarse explícitamente como "Estimación", "Proyección" o "Supuesto" — nunca lo presentes como un hecho verificado.`;
}

function BusinessPlanPage() {
  const { projectId, stepId } = Route.useSearch();
  const stepCtx = useProjectStepContext(projectId, stepId);
  const [gen, setGen] = useState<StepGeneration | null>(null);
  const prefilledRef = useRef(false);

  const { output, streaming, generate } = useAiStream("business-plan");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => setGen(stepCtx.generation), [stepCtx.generation]);

  useEffect(() => {
    if (stepCtx.loading || stepCtx.generation || prefilledRef.current || !stepCtx.brief) return;
    prefilledRef.current = true;
    setForm((f) => ({
      ...f,
      name: stepCtx.brief!.name || f.name,
      oneLiner: stepCtx.brief!.description || f.oneLiner,
      problem: stepCtx.brief!.problem || f.problem,
      solution: stepCtx.brief!.solution || f.solution,
      advantage: stepCtx.brief!.valueProposition || f.advantage,
    }));
  }, [stepCtx]);

  if (projectId && gen) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <ProjectContextBanner projectId={projectId} />
        <h1 className="font-display text-2xl font-bold mb-4">📊 {form.name || "Business Plan"}</h1>
        <DeliverableRenderer
          toolKey="business-plan"
          output={gen.output}
          editedOutput={gen.editedOutput}
          title={`Business Plan — ${form.name || "PostulPro"}`}
          onSave={async (text) => {
            await saveEditedOutput(gen.id, text);
            setGen({ ...gen, editedOutput: text });
          }}
          onRestore={async () => {
            await restoreGeneratedOutput(gen.id);
            setGen({ ...gen, editedOutput: null });
          }}
        />
      </div>
    );
  }

  const canNext =
    (step === 1 && form.name.trim() && form.problem.trim() && form.solution.trim()) ||
    (step === 2 && form.country.trim()) ||
    (step === 3 && form.revenueStreams.length > 0) ||
    (step === 4 && true);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleGenerate() {
    await generate(buildPrompt(form), { title: `Business Plan · ${form.name.slice(0, 40)}` });
  }

  function handleExportPdf() {
    if (!output) return;
    exportReportPdf(`Business Plan — ${form.name || "PostulPro"}`, output);
  }

  async function handleCopy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    toast.success("Copiado al portapapeles");
  }

  function handleDownload() {
    if (!output) return;
    downloadTxt(
      output,
      `business-plan-${(form.name || "postulpro").slice(0, 40).replace(/\s+/g, "-")}.txt`,
    );
  }

  if (output || streaming) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-2xl font-bold">📊 {form.name || "Tu Business Plan"}</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!output || streaming}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-40"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!output || streaming}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Descargar
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={!output || streaming}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-40"
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar PDF
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
            >
              Nuevo plan
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          {streaming && !output && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Generando tu plan de negocios…
            </div>
          )}
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{output}</pre>
          {streaming && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-violet-400 animate-pulse align-middle" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">📊 Business Plan IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          5 créditos · wizard de 5 pasos · exportable a PDF
        </p>
      </header>

      <ProgressBar step={step} total={5} />

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        {step === 1 && (
          <>
            <h2 className="font-display font-bold text-lg">Paso 1 · Idea</h2>
            <Field label="Nombre">
              <input
                className="input"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Nombre de tu negocio"
              />
            </Field>
            <Field label="Descripción en una frase">
              <input
                className="input"
                value={form.oneLiner}
                onChange={(e) => update("oneLiner", e.target.value)}
                placeholder="¿Qué hace tu negocio?"
              />
            </Field>
            <Field label="Problema">
              <textarea
                className="input min-h-[70px] resize-y"
                value={form.problem}
                onChange={(e) => update("problem", e.target.value)}
                placeholder="¿Qué problema resuelve?"
              />
            </Field>
            <Field label="Solución">
              <textarea
                className="input min-h-[70px] resize-y"
                value={form.solution}
                onChange={(e) => update("solution", e.target.value)}
                placeholder="¿Cómo lo resuelve?"
              />
            </Field>
            <Field label="Industria">
              <input
                className="input"
                value={form.industry}
                onChange={(e) => update("industry", e.target.value)}
                placeholder="Ej: EdTech, FinTech, E-commerce"
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="font-display font-bold text-lg">Paso 2 · Mercado</h2>
            <Field label="País">
              <input
                className="input"
                value={form.country}
                onChange={(e) => update("country", e.target.value)}
                placeholder="Ej: Argentina"
              />
            </Field>
            <Field label="Tipo">
              <div className="flex gap-2">
                {(["B2B", "B2C"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => update("model", m)}
                    className={`flex-1 h-10 rounded-lg text-sm font-medium transition ${
                      form.model === m
                        ? "bg-violet-500/20 border border-violet-500/50 text-violet-200"
                        : "bg-white/5 border border-white/10 text-muted-foreground"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Tamaño de mercado (opcional)">
              <input
                className="input"
                value={form.marketSize}
                onChange={(e) => update("marketSize", e.target.value)}
                placeholder="Si tenés un dato propio, indicalo"
              />
            </Field>
            <Field label="Hasta 3 competidores">
              <input
                className="input"
                value={form.competitors}
                onChange={(e) => update("competitors", e.target.value)}
                placeholder="Separados por coma"
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-display font-bold text-lg">Paso 3 · Modelo</h2>
            <Field label="Fuentes de ingreso">
              <div className="flex flex-wrap gap-2">
                {REVENUE_STREAMS.map((r) => {
                  const active = form.revenueStreams.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() =>
                        update(
                          "revenueStreams",
                          active
                            ? form.revenueStreams.filter((x) => x !== r)
                            : [...form.revenueStreams, r],
                        )
                      }
                      className={`px-3 h-8 rounded-full text-xs font-medium transition ${
                        active
                          ? "bg-violet-500/20 border border-violet-500/50 text-violet-200"
                          : "bg-white/5 border border-white/10 text-muted-foreground"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Precio">
              <input
                className="input"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="Ej: $29/mes"
              />
            </Field>
            <Field label="CAC estimado">
              <input
                className="input"
                value={form.cac}
                onChange={(e) => update("cac", e.target.value)}
                placeholder="Costo de adquisición de cliente"
              />
            </Field>
            <Field label="Canal principal">
              <input
                className="input"
                value={form.channel}
                onChange={(e) => update("channel", e.target.value)}
                placeholder="Ej: Ads, contenido, referidos"
              />
            </Field>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="font-display font-bold text-lg">Paso 4 · Finanzas</h2>
            <Field label="Inversión inicial">
              <input
                className="input"
                value={form.initialInvestment}
                onChange={(e) => update("initialInvestment", e.target.value)}
                placeholder="Ej: $5,000"
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Meta mes 1">
                <input
                  className="input"
                  value={form.goalMonth1}
                  onChange={(e) => update("goalMonth1", e.target.value)}
                  placeholder="$"
                />
              </Field>
              <Field label="Meta mes 6">
                <input
                  className="input"
                  value={form.goalMonth6}
                  onChange={(e) => update("goalMonth6", e.target.value)}
                  placeholder="$"
                />
              </Field>
              <Field label="Meta mes 12">
                <input
                  className="input"
                  value={form.goalMonth12}
                  onChange={(e) => update("goalMonth12", e.target.value)}
                  placeholder="$"
                />
              </Field>
            </div>
            <Field label="Costos fijos mensuales">
              <input
                className="input"
                value={form.fixedCosts}
                onChange={(e) => update("fixedCosts", e.target.value)}
                placeholder="Ej: $800/mes"
              />
            </Field>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="font-display font-bold text-lg">Paso 5 · Estrategia</h2>
            <Field label="Ventaja competitiva">
              <textarea
                className="input min-h-[70px] resize-y"
                value={form.advantage}
                onChange={(e) => update("advantage", e.target.value)}
                placeholder="¿Por qué vos y no otro?"
              />
            </Field>
            <Field label="Tipo de lanzamiento">
              <SimpleSelect
                value={form.launchType}
                onValueChange={(v) => update("launchType", v)}
                options={LAUNCH_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Timeline (1-12 meses)">
              <textarea
                className="input min-h-[70px] resize-y"
                value={form.timeline}
                onChange={(e) => update("timeline", e.target.value)}
                placeholder="Hitos clave por mes"
              />
            </Field>
          </>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowLeft className="w-4 h-4" /> Atrás
        </button>
        {step < 5 ? (
          <button
            type="button"
            onClick={() =>
              canNext ? setStep((s) => s + 1) : toast.error("Completa los campos requeridos")
            }
            className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition"
          >
            Siguiente <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={streaming}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-60"
          >
            {streaming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generando…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Generar plan (5 créditos)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Paso {step} de {total}
        </span>
        <span>{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}

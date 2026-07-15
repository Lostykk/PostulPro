import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Rocket, Copy, Loader2, ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { useAiStream } from "@/hooks/use-ai-stream";
import { parseSections } from "@/lib/ai/parse-sections";
import { useProjectStepContext, type StepGeneration } from "@/hooks/use-project-step-context";
import {
  saveEditedOutput,
  restoreGeneratedOutput,
  toggleApproval,
} from "@/lib/deliverables/generation-actions";
import { DeliverableRenderer } from "@/components/deliverables/DeliverableRenderer";
import { ProjectContextBanner } from "@/components/deliverables/ProjectContextBanner";

export const Route = createFileRoute("/_authenticated/tools/social-pack")({
  head: () => ({ meta: [{ title: "Social Pack — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { projectId?: string; stepId?: string } => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
    stepId: typeof search.stepId === "string" ? search.stepId : undefined,
  }),
  component: SocialPackPage,
});

const OBJECTIVES = ["Vender", "Educar", "Entretener", "Inspirar", "Anunciar"];
const TONES = ["Profesional", "Casual", "Urgente", "Inspirador", "Divertido", "Técnico"];

const CHANNEL_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  X: "X (Twitter)",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  CALENDARIO: "Calendario semanal",
};

function SocialPackPage() {
  const { projectId, stepId } = Route.useSearch();
  const stepCtx = useProjectStepContext(projectId, stepId);
  const [gen, setGen] = useState<StepGeneration | null>(null);
  const prefilledRef = useRef(false);

  const { output, streaming, generate } = useAiStream("social-pack");
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState(OBJECTIVES[0]);
  const [industry, setIndustry] = useState("");
  const [tone, setTone] = useState(TONES[0]);
  const [activeTab, setActiveTab] = useState(0);

  const sections = useMemo(() => parseSections(output), [output]);

  useEffect(() => setGen(stepCtx.generation), [stepCtx.generation]);

  useEffect(() => {
    if (stepCtx.loading || stepCtx.generation || prefilledRef.current || !stepCtx.brief) return;
    prefilledRef.current = true;
    setTopic(stepCtx.brief.valueProposition || stepCtx.brief.description || "");
  }, [stepCtx]);

  if (projectId && gen) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <ProjectContextBanner projectId={projectId} />
        <h1 className="font-display text-2xl font-bold mb-4">📱 Social Pack</h1>
        <DeliverableRenderer
          toolKey="social-pack"
          output={gen.output}
          editedOutput={gen.editedOutput}
          approvals={gen.approvals}
          title="Social Pack"
          onSave={async (text) => {
            await saveEditedOutput(gen.id, text);
            setGen({ ...gen, editedOutput: text });
          }}
          onRestore={async () => {
            await restoreGeneratedOutput(gen.id);
            setGen({ ...gen, editedOutput: null });
          }}
          onToggleApproval={async (title, approved) => {
            const next = await toggleApproval(gen.id, gen.approvals, title, approved);
            setGen({ ...gen, approvals: next });
          }}
        />
      </div>
    );
  }

  async function handleGenerate() {
    if (!topic.trim()) {
      toast.error("Completa el tema");
      return;
    }
    const prompt = `Genera un pack de contenido social multicanal en español.
Tema: ${topic}
Objetivo: ${objective}
Industria: ${industry || "no especificada"}
Tono: ${tone}

Devuelve EXACTAMENTE en este formato, sin texto fuera de los bloques:

===LINKEDIN===
BODY:
post de hasta 1500 caracteres, con formato y saltos de línea apropiados para LinkedIn

===X===
BODY:
hilo de 8 posts numerados (1/8 .. 8/8), cada uno de hasta 280 caracteres

===INSTAGRAM===
BODY:
caption + bloque de hashtags relevantes al final

===FACEBOOK===
BODY:
post + CTA claro al final

===YOUTUBE===
SUBJECT: título del video
BODY:
descripción del video
CTA: tags separados por coma

===CALENDARIO===
BODY:
sugerencia de calendario semanal (Lunes a Domingo) indicando qué canal publicar cada día y por qué`;
    setActiveTab(0);
    await generate(prompt, { title: `Social Pack · ${topic.slice(0, 40)}` });
  }

  async function copyChannel(i: number) {
    const s = sections[i];
    if (!s) return;
    const text = s.fields.subject
      ? `${s.fields.subject}\n\n${s.body}${s.fields.cta ? `\n\n${s.fields.cta}` : ""}`
      : s.body;
    await navigator.clipboard.writeText(text);
    toast.success("Copiado");
  }
  async function copyAll() {
    await navigator.clipboard.writeText(output);
    toast.success("Pack completo copiado");
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">📱 Social Pack</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          3 créditos · LinkedIn, X, Instagram, Facebook, YouTube + calendario
        </p>
      </header>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 h-fit">
          <Field label="Tema">
            <input
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej: Lanzamiento de producto"
            />
          </Field>
          <Field label="Objetivo">
            <Select value={objective} onChange={setObjective} options={OBJECTIVES} />
          </Field>
          <Field label="Industria">
            <input
              className="input"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Ej: SaaS B2B"
            />
          </Field>
          <Field label="Tono">
            <Select value={tone} onChange={setTone} options={TONES} />
          </Field>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={streaming}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition disabled:opacity-60"
          >
            {streaming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generando…
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" /> Generar (3 créditos)
              </>
            )}
          </button>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-[color:var(--surface-1)]/60 min-h-[500px] flex flex-col">
          {sections.length > 0 ? (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 gap-2 overflow-x-auto">
                <div className="flex gap-1">
                  {sections.map((s, i) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => setActiveTab(i)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition ${
                        activeTab === i
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {CHANNEL_LABEL[s.title] ?? s.title}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={copyAll}
                  className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition whitespace-nowrap"
                >
                  <ClipboardCopy className="w-3.5 h-3.5" /> Copiar todo
                </button>
              </div>
              <div className="flex-1 p-6 overflow-auto">
                {sections[activeTab] && (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      {sections[activeTab].fields.subject && (
                        <div className="font-semibold">{sections[activeTab].fields.subject}</div>
                      )}
                      <button
                        type="button"
                        onClick={() => copyChannel(activeTab)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition shrink-0 ml-auto"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {sections[activeTab].body}
                    </pre>
                    {sections[activeTab].fields.cta && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Tags</div>
                        <div className="text-sm text-violet-300">
                          {sections[activeTab].fields.cta}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-center text-muted-foreground p-6">
              {streaming ? (
                <div>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
                  <pre className="whitespace-pre-wrap font-sans text-xs text-left max-w-lg opacity-60">
                    {output}
                  </pre>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">📱</div>
                  <p className="text-sm">
                    Completa el panel y presiona <span className="text-foreground">Generar</span>.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o} className="bg-background">
          {o}
        </option>
      ))}
    </select>
  );
}

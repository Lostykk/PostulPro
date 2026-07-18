import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Copy, Loader2, ClipboardCopy } from "lucide-react";
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
import { SimpleSelect } from "@/components/ui/simple-select";

export const Route = createFileRoute("/_authenticated/tools/email-sequences")({
  head: () => ({ meta: [{ title: "Email Sequences — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { projectId?: string; stepId?: string } => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
    stepId: typeof search.stepId === "string" ? search.stepId : undefined,
  }),
  component: EmailSequencesPage,
});

const SEQUENCE_TYPES = [
  { id: "bienvenida", label: "Bienvenida", count: 5 },
  { id: "nurture", label: "Nurture", count: 8 },
  { id: "carrito", label: "Carrito abandonado", count: 3 },
  { id: "reengagement", label: "Re-engagement", count: 4 },
  { id: "lanzamiento", label: "Lanzamiento", count: 7 },
] as const;

function EmailSequencesPage() {
  const { projectId, stepId } = Route.useSearch();
  const stepCtx = useProjectStepContext(projectId, stepId);
  const [gen, setGen] = useState<StepGeneration | null>(null);
  const prefilledRef = useRef(false);

  const { output, streaming, generate } = useAiStream("email-sequences");
  const [sequenceId, setSequenceId] = useState<(typeof SEQUENCE_TYPES)[number]["id"]>("bienvenida");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [activeTab, setActiveTab] = useState(0);

  const sequence = SEQUENCE_TYPES.find((s) => s.id === sequenceId)!;
  const sections = useMemo(() => parseSections(output), [output]);

  useEffect(() => setGen(stepCtx.generation), [stepCtx.generation]);

  useEffect(() => {
    if (stepCtx.loading || stepCtx.generation || prefilledRef.current || !stepCtx.brief) return;
    prefilledRef.current = true;
    setProduct(stepCtx.brief.name || stepCtx.brief.description || "");
    setAudience(stepCtx.brief.audience || "");
    setObjective(stepCtx.brief.mainCta || "");
  }, [stepCtx]);

  if (projectId && gen) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <ProjectContextBanner projectId={projectId} />
        <h1 className="font-display text-2xl font-bold mb-4">📬 Email Sequences</h1>
        <DeliverableRenderer
          toolKey="email-sequences"
          output={gen.output}
          editedOutput={gen.editedOutput}
          approvals={gen.approvals}
          title="Email Sequences"
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
    if (!product.trim() || !audience.trim()) {
      toast.error("Completa producto y audiencia");
      return;
    }
    const blocks = Array.from({ length: sequence.count }, (_, i) => i + 1)
      .map(
        (n) => `===EMAIL ${n}===
SUBJECT: asunto del email ${n}
PREVIEW: preview de bandeja de entrada
BODY:
cuerpo completo del email ${n} de la secuencia`,
      )
      .join("\n\n");

    const prompt = `Genera una secuencia de email marketing de tipo "${sequence.label}" (${sequence.count} emails) en español.
Producto/servicio: ${product}
Audiencia: ${audience}
Objetivo: ${objective || "no especificado"}

Cada email debe ser completo y tener sentido en su posición dentro de la secuencia (progresión lógica).
Devuelve EXACTAMENTE en este formato, sin texto fuera de los bloques:

${blocks}`;
    setActiveTab(0);
    await generate(prompt, { title: `${sequence.label} · ${product.slice(0, 40)}` });
  }

  async function copyEmail(i: number) {
    const s = sections[i];
    if (!s) return;
    const text = `${s.fields.subject ?? ""}\n\n${s.body}`.trim();
    await navigator.clipboard.writeText(text);
    toast.success("Email copiado");
  }
  async function copyAll() {
    await navigator.clipboard.writeText(output);
    toast.success("Secuencia completa copiada");
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">📬 Email Sequences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          3 créditos · secuencias completas de email marketing
        </p>
      </header>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 h-fit">
          <Field label="Tipo de secuencia">
            <SimpleSelect
              value={sequenceId}
              onValueChange={(v) => setSequenceId(v as typeof sequenceId)}
              options={SEQUENCE_TYPES.map((s) => ({
                value: s.id,
                label: `${s.label} (${s.count} emails)`,
              }))}
            />
          </Field>
          <Field label="Producto / servicio">
            <input
              className="input"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Ej: Curso online"
            />
          </Field>
          <Field label="Audiencia">
            <input
              className="input"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Ej: nuevos suscriptores"
            />
          </Field>
          <Field label="Objetivo">
            <textarea
              className="input min-h-[80px] resize-y"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="¿Qué querés lograr con esta secuencia?"
            />
          </Field>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={streaming}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60"
          >
            {streaming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generando…
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" /> Generar (3 créditos)
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
                      {s.title.replace("EMAIL ", "Email ")}
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
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Asunto</div>
                        <div className="font-semibold">{sections[activeTab].fields.subject}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyEmail(activeTab)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </button>
                    </div>
                    {sections[activeTab].fields.preview && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Preview</div>
                        <div className="text-sm text-muted-foreground italic">
                          {sections[activeTab].fields.preview}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Cuerpo</div>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                        {sections[activeTab].body}
                      </pre>
                    </div>
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
                  <div className="text-4xl mb-3">📬</div>
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

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Copy, Loader2, ClipboardCopy } from "lucide-react";
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
import { RichContentRenderer } from "@/components/deliverables/RichContentRenderer";

export const Route = createFileRoute("/_authenticated/tools/sales-email")({
  head: () => ({ meta: [{ title: "Sales Email — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { projectId?: string; stepId?: string } => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
    stepId: typeof search.stepId === "string" ? search.stepId : undefined,
  }),
  component: SalesEmailPage,
});

function SalesEmailPage() {
  const { projectId, stepId } = Route.useSearch();
  const stepCtx = useProjectStepContext(projectId, stepId);
  const [gen, setGen] = useState<StepGeneration | null>(null);
  const prefilledRef = useRef(false);

  const { output, streaming, generate } = useAiStream("sales-email");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [product, setProduct] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [activeTab, setActiveTab] = useState(0);

  const sections = useMemo(() => parseSections(output), [output]);

  useEffect(() => setGen(stepCtx.generation), [stepCtx.generation]);

  useEffect(() => {
    if (stepCtx.loading || stepCtx.generation || prefilledRef.current || !stepCtx.brief) return;
    prefilledRef.current = true;
    setCompany(stepCtx.brief.name || "");
    setProduct(stepCtx.brief.offer || stepCtx.brief.description || "");
    setPainPoint(stepCtx.brief.problem || "");
  }, [stepCtx]);

  if (projectId && gen) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <ProjectContextBanner projectId={projectId} />
        <h1 className="font-display text-2xl font-bold mb-4">✉️ Sales Email</h1>
        <DeliverableRenderer
          toolKey="sales-email"
          output={gen.output}
          editedOutput={gen.editedOutput}
          approvals={gen.approvals}
          title="Sales Email"
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
    if (!company.trim() || !product.trim()) {
      toast.error("Completa empresa objetivo y producto");
      return;
    }
    const prompt = `Genera una secuencia de 5 emails de venta outbound en español para el email #1 a #5, más una variante A/B del email 1 con un ángulo distinto de asunto y apertura.
Empresa objetivo: ${company}
Cargo del contacto: ${role || "no especificado"}
Producto/servicio: ${product}
Pain point principal: ${painPoint || "no especificado"}

Usa los placeholders {{nombre}} y {{empresa}} donde corresponda para personalización.

Devuelve EXACTAMENTE en este formato, sin texto fuera de los bloques:

===EMAIL 1===
SUBJECT: asunto del email
PREVIEW: texto de preview de bandeja de entrada
BODY:
cuerpo completo del email
CTA: llamado a la acción final

===EMAIL 2===
SUBJECT: ...
PREVIEW: ...
BODY:
...
CTA: ...

===EMAIL 3===
(igual formato)

===EMAIL 4===
(igual formato)

===EMAIL 5===
(igual formato)

===EMAIL 1B===
(variante A/B del email 1, mismo formato)`;
    setActiveTab(0);
    await generate(prompt, { title: `Sales Email · ${company.slice(0, 40)}` });
  }

  async function copyEmail(i: number) {
    const s = sections[i];
    if (!s) return;
    const text = `${s.fields.subject ?? ""}\n\n${s.body}\n\n${s.fields.cta ?? ""}`.trim();
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
        <h1 className="font-display text-3xl font-bold">✉️ Sales Email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          2 créditos · secuencia de 5 emails + variante A/B
        </p>
      </header>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 h-fit">
          <Field label="Empresa objetivo">
            <input
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ej: Acme Corp"
            />
          </Field>
          <Field label="Cargo del contacto">
            <input
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Ej: Head of Growth"
            />
          </Field>
          <Field label="Producto / servicio">
            <input
              className="input"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Ej: Plataforma de automatización"
            />
          </Field>
          <Field label="Pain point">
            <textarea
              className="input min-h-[90px] resize-y"
              value={painPoint}
              onChange={(e) => setPainPoint(e.target.value)}
              placeholder="¿Qué problema resuelve tu producto?"
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
                <Send className="w-4 h-4" /> Generar (2 créditos)
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
                      <RichContentRenderer content={sections[activeTab].body} />
                    </div>
                    {sections[activeTab].fields.cta && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">CTA</div>
                        <div className="text-sm font-medium text-violet-300">
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
                  <div className="text-4xl mb-3">✉️</div>
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

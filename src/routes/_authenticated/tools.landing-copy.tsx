import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Target, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAiStream } from "@/hooks/use-ai-stream";
import { useProjectStepContext, type StepGeneration } from "@/hooks/use-project-step-context";
import { saveEditedOutput, restoreGeneratedOutput } from "@/lib/deliverables/generation-actions";
import { DeliverableRenderer } from "@/components/deliverables/DeliverableRenderer";
import { ProjectContextBanner } from "@/components/deliverables/ProjectContextBanner";
import { parseLandingJson, type LandingPageData } from "@/lib/deliverables/parse-landing";

export const Route = createFileRoute("/_authenticated/tools/landing-copy")({
  head: () => ({ meta: [{ title: "Landing Copy — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { projectId?: string; stepId?: string } => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
    stepId: typeof search.stepId === "string" ? search.stepId : undefined,
  }),
  component: LandingCopyPage,
});

type LandingData = LandingPageData;

function LandingCopyPage() {
  const { projectId, stepId } = Route.useSearch();
  const stepCtx = useProjectStepContext(projectId, stepId);
  const [gen, setGen] = useState<StepGeneration | null>(null);
  const prefilledRef = useRef(false);

  const { output, streaming, generate } = useAiStream("landing-copy");
  const [product, setProduct] = useState("");
  const [icp, setIcp] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [price, setPrice] = useState("");
  const [data, setData] = useState<LandingData | null>(null);

  useEffect(() => setGen(stepCtx.generation), [stepCtx.generation]);

  // Deep-linked from a project step with no deliverable yet — prefill the
  // wizard from the project's brief instead of generating anything (opening
  // the tool must never itself consume credits).
  useEffect(() => {
    if (stepCtx.loading || stepCtx.generation || prefilledRef.current || !stepCtx.brief) return;
    prefilledRef.current = true;
    setProduct(stepCtx.brief.name || stepCtx.brief.description || "");
    setIcp(stepCtx.brief.audience || "");
    setValueProp(stepCtx.brief.valueProposition || "");
    setPrice(
      typeof stepCtx.stepInput?.price === "string" ? (stepCtx.stepInput.price as string) : "",
    );
  }, [stepCtx]);

  useEffect(() => {
    if (!streaming && output) {
      const parsed = parseLandingJson(output);
      if (parsed) {
        setData(parsed);
      } else {
        toast.error("No pudimos interpretar la respuesta de la IA. Probá generar de nuevo.");
      }
    }
  }, [streaming, output]);

  if (projectId && gen) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <ProjectContextBanner projectId={projectId} />
        <h1 className="font-display text-2xl font-bold mb-4">🎯 Landing Copy</h1>
        <DeliverableRenderer
          toolKey="landing-copy"
          output={gen.output}
          editedOutput={gen.editedOutput}
          title="Landing Copy"
          generationId={gen.id}
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

  async function handleGenerate() {
    if (!product.trim() || !icp.trim()) {
      toast.error("Completa producto e ICP");
      return;
    }
    setData(null);
    const prompt = `Genera copy de landing page de conversión en español para:
Producto/servicio: ${product}
ICP (cliente ideal): ${icp}
Propuesta de valor: ${valueProp || "no especificada"}
Precio: ${price || "no especificado"}

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto fuera del JSON) con exactamente esta forma:
{
  "headlines": ["variante 1", "variante 2", "variante 3"],
  "subheadline": "...",
  "hero": "párrafo completo del hero",
  "features": ["feature 1", "feature 2", "feature 3"],
  "social_proof": "copy sugerido de prueba social, EDITABLE, no una afirmación factual",
  "faq": [{"q": "pregunta 1", "a": "respuesta 1"}, ... 6 preguntas],
  "cta": "texto del CTA final",
  "meta_title": "...",
  "meta_description": "..."
}`;
    await generate(prompt, { title: `Landing Copy · ${product.slice(0, 40)}` });
  }

  async function copyAll() {
    if (!data) return;
    const text = [
      `# ${data.headlines[0] ?? ""}`,
      data.subheadline,
      "",
      data.hero,
      "",
      "## Features",
      ...data.features.map((f) => `- ${f}`),
      "",
      "## Social proof (sugerido — editar antes de publicar)",
      data.social_proof,
      "",
      "## FAQ",
      ...data.faq.map((f) => `**${f.q}**\n${f.a}`),
      "",
      `## CTA\n${data.cta}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Copiado");
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">🎯 Landing Copy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            2 créditos · headlines, hero, features, FAQ y CTA — editable inline
          </p>
        </div>
        {data && (
          <button
            type="button"
            onClick={copyAll}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition shrink-0"
          >
            <Copy className="w-3.5 h-3.5" /> Copiar todo
          </button>
        )}
      </header>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 h-fit">
          <Field label="Producto / servicio">
            <input
              className="input"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Ej: App de finanzas personales"
            />
          </Field>
          <Field label="ICP (cliente ideal)">
            <input
              className="input"
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
              placeholder="Ej: freelancers 25-40 años"
            />
          </Field>
          <Field label="Propuesta de valor">
            <textarea
              className="input min-h-[80px] resize-y"
              value={valueProp}
              onChange={(e) => setValueProp(e.target.value)}
              placeholder="¿Qué te hace distinto?"
            />
          </Field>
          <Field label="Precio">
            <input
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Ej: $19/mes"
            />
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
                <Target className="w-4 h-4" /> Generar (2 créditos)
              </>
            )}
          </button>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-[color:var(--surface-1)]/60 min-h-[500px] p-6 overflow-auto">
          {data ? (
            <div className="space-y-6 max-w-2xl">
              <div>
                <SectionLabel>Headlines (3 variantes)</SectionLabel>
                <div className="space-y-2">
                  {data.headlines.map((h, i) => (
                    <EditableInput
                      key={i}
                      value={h}
                      onChange={(v) =>
                        setData({
                          ...data,
                          headlines: data.headlines.map((x, j) => (j === i ? v : x)),
                        })
                      }
                      big
                    />
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel>Subheadline</SectionLabel>
                <EditableTextarea
                  value={data.subheadline}
                  onChange={(v) => setData({ ...data, subheadline: v })}
                />
              </div>
              <div>
                <SectionLabel>Hero</SectionLabel>
                <EditableTextarea
                  value={data.hero}
                  onChange={(v) => setData({ ...data, hero: v })}
                  rows={4}
                />
              </div>
              <div>
                <SectionLabel>Features</SectionLabel>
                <div className="space-y-2">
                  {data.features.map((f, i) => (
                    <EditableInput
                      key={i}
                      value={f}
                      onChange={(v) =>
                        setData({
                          ...data,
                          features: data.features.map((x, j) => (j === i ? v : x)),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel>Social proof (sugerido — editar antes de publicar)</SectionLabel>
                <EditableTextarea
                  value={data.social_proof}
                  onChange={(v) => setData({ ...data, social_proof: v })}
                />
              </div>
              <div>
                <SectionLabel>FAQ</SectionLabel>
                <div className="space-y-3">
                  {data.faq.map((f, i) => (
                    <div key={i} className="space-y-1">
                      <EditableInput
                        value={f.q}
                        onChange={(v) =>
                          setData({
                            ...data,
                            faq: data.faq.map((x, j) => (j === i ? { ...x, q: v } : x)),
                          })
                        }
                      />
                      <EditableTextarea
                        value={f.a}
                        onChange={(v) =>
                          setData({
                            ...data,
                            faq: data.faq.map((x, j) => (j === i ? { ...x, a: v } : x)),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel>CTA final</SectionLabel>
                <EditableInput
                  value={data.cta}
                  onChange={(v) => setData({ ...data, cta: v })}
                  big
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3 pt-4 border-t border-white/5">
                <div>
                  <SectionLabel>Meta title</SectionLabel>
                  <EditableInput
                    value={data.meta_title}
                    onChange={(v) => setData({ ...data, meta_title: v })}
                  />
                </div>
                <div>
                  <SectionLabel>Meta description</SectionLabel>
                  <EditableTextarea
                    value={data.meta_description}
                    onChange={(v) => setData({ ...data, meta_description: v })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full grid place-items-center text-center text-muted-foreground">
              {streaming ? (
                <div>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
                  <p className="text-sm">Generando copy…</p>
                </div>
              ) : output ? (
                <div>
                  <div className="text-4xl mb-3">⚠️</div>
                  <p className="text-sm">
                    No pudimos interpretar la respuesta.{" "}
                    <button
                      type="button"
                      onClick={handleGenerate}
                      className="text-foreground underline"
                    >
                      Reintentar
                    </button>
                  </p>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">🎯</div>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {children}
    </div>
  );
}

function EditableInput({
  value,
  onChange,
  big,
}: {
  value: string;
  onChange: (v: string) => void;
  big?: boolean;
}) {
  return (
    <input
      className={`input ${big ? "font-display font-bold text-base h-11" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EditableTextarea({
  value,
  onChange,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      className="input resize-y"
      style={{ minHeight: `${rows * 1.5 + 1}rem` }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}

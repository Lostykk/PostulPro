import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, ChevronDown, ArrowRight } from "lucide-react";
import { projectsApiFetch, ApiError } from "@/lib/projects/api-client";
import { SimpleSelect } from "@/components/ui/simple-select";

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

// This page's only job is: create the bare project row and navigate to its
// workspace immediately — it does NOT wait for the plan to be generated.
// The workspace (/projects/$id) owns the entire planning lifecycle (trigger,
// progress, retry, review, confirm) so a slow/failed planner call is always
// tied to a real, revisitable project instead of stranding the user on this
// form with no way back to what was already created.
function BuildPage() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState("es");
  const [showMore, setShowMore] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [executionMode, setExecutionMode] = useState<"guided" | "automatic">("guided");
  const [creating, setCreating] = useState(false);

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
    setCreating(true);
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
      navigate({ to: "/projects/$id", params: { id: created.id } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo crear el proyecto.");
    } finally {
      setCreating(false);
    }
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
          disabled={creating}
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
              <SimpleSelect
                value={language}
                onValueChange={setLanguage}
                options={[
                  { value: "es", label: "Español" },
                  { value: "en", label: "English" },
                  { value: "pt", label: "Português" },
                ]}
              />
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={handleDesign}
          disabled={creating || idea.trim().length < 8}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Creando tu proyecto…
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

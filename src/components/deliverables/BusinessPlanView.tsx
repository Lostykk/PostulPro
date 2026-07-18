import { useEffect, useMemo, useState } from "react";
import { Copy, FileDown, Maximize2, Minimize2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  isDegenerateSection,
  parseMarkdownSections,
  serializeMarkdownSections,
  type MarkdownSection,
} from "@/lib/deliverables/parse-business-plan";
import { exportReportPdf } from "@/lib/pdf-export";
import { RichContentRenderer } from "@/components/deliverables/RichContentRenderer";
import { TiptapEditor } from "@/components/deliverables/TiptapEditor";

type Mode = "view" | "edit" | "raw";
type SaveState = "idle" | "saving" | "saved" | "error";

export function BusinessPlanView({
  text,
  title,
  onSave,
}: {
  text: string;
  title: string;
  onSave: (newText: string) => Promise<void> | void;
}) {
  const parsed = useMemo(() => parseMarkdownSections(text), [text]);
  const [sections, setSections] = useState<MarkdownSection[]>(parsed);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [maximized, setMaximized] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    setSections(parsed);
    setSaveState("idle");
    // Keep the user's place across saves (re-parsing the same content they
    // just saved shouldn't bounce them back to the top). Only fall back to
    // the first non-degenerate section when the previous index no longer
    // points at real content (new/shorter document, or a leading "---"-only
    // section on first load).
    setActiveIdx((prev) => {
      if (prev < parsed.length && !isDegenerateSection(parsed[prev])) return prev;
      const firstReal = parsed.findIndex((s) => !isDegenerateSection(s));
      return firstReal >= 0 ? firstReal : 0;
    });
  }, [parsed]);

  const dirty = serializeMarkdownSections(sections) !== serializeMarkdownSections(parsed);
  const active = sections[activeIdx];
  const navSections = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isDegenerateSection(s));

  function updateBody(i: number, body: string) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, body } : s)));
    if (saveState === "saved") setSaveState("idle");
  }

  async function copySection(s: MarkdownSection) {
    await navigator.clipboard.writeText(s.heading ? `## ${s.heading}\n${s.body}` : s.body);
    toast.success("Sección copiada");
  }
  async function copyAll() {
    await navigator.clipboard.writeText(serializeMarkdownSections(sections));
    toast.success("Documento completo copiado");
  }
  function handleExportPdf() {
    exportReportPdf(title, serializeMarkdownSections(sections), { projectTitle: title });
  }
  function discardChanges() {
    setSections(parsed);
    setSaveState("idle");
  }
  async function handleSave() {
    setSaveState("saving");
    try {
      await onSave(serializeMarkdownSections(sections));
      setSaveState("saved");
      toast.success("Cambios guardados");
    } catch {
      setSaveState("error");
      toast.error("No se pudo guardar. Intentá de nuevo.");
    }
  }

  if (sections.length === 0) return null;

  return (
    <div className={maximized ? "fixed inset-0 z-50 bg-background p-6 flex flex-col" : ""}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3 shrink-0">
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1">
          <ModeButton active={mode === "view"} onClick={() => setMode("view")}>
            Ver
          </ModeButton>
          <ModeButton active={mode === "edit"} onClick={() => setMode("edit")}>
            Editar
          </ModeButton>
          <ModeButton active={mode === "raw"} onClick={() => setMode("raw")}>
            Contenido técnico
          </ModeButton>
        </div>
        <button
          type="button"
          onClick={() => setMaximized((v) => !v)}
          aria-label={maximized ? "Minimizar" : "Maximizar"}
          className="w-8 h-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
        >
          {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      <div className={`grid md:grid-cols-[200px_1fr] gap-4 ${maximized ? "flex-1 min-h-0" : ""}`}>
        <nav
          className={`flex md:flex-col gap-1 overflow-x-auto ${maximized ? "md:overflow-y-auto" : "md:overflow-visible"}`}
        >
          {navSections.map(({ s, i }) => (
            <button
              key={`${s.heading}-${i}`}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`shrink-0 text-left px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap md:whitespace-normal transition ${
                activeIdx === i ? "bg-violet-500/15 text-violet-200" : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              {s.heading || "Introducción"}
            </button>
          ))}
        </nav>

        <div className={`space-y-4 min-w-0 ${maximized ? "flex flex-col min-h-0" : ""}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
            <h3 className="font-display font-bold text-base">{active.heading || "Introducción"}</h3>
            {mode !== "edit" && (
              <button
                type="button"
                onClick={() => copySection(active)}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                <Copy className="w-3.5 h-3.5" /> Copiar sección
              </button>
            )}
          </div>

          <div
            className={
              mode === "edit"
                ? maximized
                  ? "flex-1 min-h-0 overflow-y-auto"
                  : ""
                : `rounded-xl border border-white/10 bg-black/20 p-5 overflow-y-auto ${
                    maximized ? "flex-1 min-h-0" : "max-h-[500px]"
                  }`
            }
          >
            {mode === "view" && <RichContentRenderer content={active.body} size="lg" />}
            {mode === "edit" && (
              <TiptapEditor markdown={active.body} onChange={(md) => updateBody(activeIdx, md)} />
            )}
            {mode === "raw" && (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
                {active.body}
              </pre>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-white/5 shrink-0">
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={copyAll}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                <Copy className="w-3.5 h-3.5" /> Copiar documento completo
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                <FileDown className="w-3.5 h-3.5" /> Exportar PDF
              </button>
              <button
                type="button"
                disabled
                title="Exportación a DOCX todavía no está disponible"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/5 text-muted-foreground/50 cursor-not-allowed"
              >
                <FileDown className="w-3.5 h-3.5" /> Exportar DOCX (próximamente)
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={discardChanges}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restaurar original
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <SaveStatusLabel state={saveState} dirty={dirty} />
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saveState === "saving"}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-40 transition"
              >
                <Save className="w-3.5 h-3.5" /> Guardar cambios
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SaveStatusLabel({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === "saving") return <span className="text-xs text-muted-foreground">Guardando…</span>;
  if (state === "error") return <span className="text-xs text-red-400">Error al guardar</span>;
  if (state === "saved" && !dirty) return <span className="text-xs text-emerald-400">Guardado</span>;
  if (dirty) return <span className="text-xs text-amber-300">Cambios sin guardar</span>;
  return <span className="text-xs text-muted-foreground">Sin cambios</span>;
}

import { useEffect, useState } from "react";
import { Copy, Download, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { downloadTxt } from "@/hooks/use-ai-stream";
import { RichContentRenderer } from "@/components/deliverables/RichContentRenderer";
import { TiptapEditor } from "@/components/deliverables/TiptapEditor";

type Mode = "view" | "edit" | "raw";
type SaveState = "idle" | "saving" | "saved" | "error";

// Fallback for tool_keys with deliverableType "text" that aren't the
// business plan's "## " section convention (e.g. copywriter, or any future
// tool) — still editable/saveable, just without a section index.
export function GenericMarkdownView({
  text,
  filename,
  onSave,
}: {
  text: string;
  filename: string;
  onSave: (newText: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(text);
  const [mode, setMode] = useState<Mode>("view");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    setValue(text);
    setSaveState("idle");
  }, [text]);

  const dirty = value !== text;

  async function handleSave() {
    setSaveState("saving");
    try {
      await onSave(value);
      setSaveState("saved");
      toast.success("Cambios guardados");
    } catch {
      setSaveState("error");
      toast.error("No se pudo guardar. Intentá de nuevo.");
    }
  }
  async function copyAll() {
    await navigator.clipboard.writeText(value);
    toast.success("Copiado");
  }
  function discardChanges() {
    setValue(text);
    setSaveState("idle");
  }
  function updateValue(v: string) {
    setValue(v);
    if (saveState === "saved") setSaveState("idle");
  }

  return (
    <div className="space-y-3">
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

      <div className={mode === "edit" ? "" : "rounded-xl border border-white/10 bg-black/20 p-5 max-h-[500px] overflow-y-auto"}>
        {mode === "view" && <RichContentRenderer content={value} size="lg" />}
        {mode === "edit" && <TiptapEditor markdown={value} onChange={updateValue} />}
        {mode === "raw" && (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">{value}</pre>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={copyAll}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          <button
            type="button"
            onClick={() => downloadTxt(value, filename)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Download className="w-3.5 h-3.5" /> Descargar
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

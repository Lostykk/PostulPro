import { useEffect, useState } from "react";
import { Copy, Download, Save } from "lucide-react";
import { toast } from "sonner";
import { downloadTxt } from "@/hooks/use-ai-stream";

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
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(text), [text]);

  const dirty = value !== text;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(value);
      toast.success("Cambios guardados");
    } finally {
      setSaving(false);
    }
  }
  async function copyAll() {
    await navigator.clipboard.writeText(value);
    toast.success("Copiado");
  }

  return (
    <div className="space-y-3">
      <textarea
        className="input min-h-[240px] resize-y font-sans text-sm leading-relaxed"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
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
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-40 transition"
        >
          <Save className="w-3.5 h-3.5" /> Guardar cambios
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Copy, FileDown, Save } from "lucide-react";
import { toast } from "sonner";
import {
  parseMarkdownSections,
  serializeMarkdownSections,
  type MarkdownSection,
} from "@/lib/deliverables/parse-business-plan";
import { exportReportPdf } from "@/lib/pdf-export";

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSections(parsed);
    setActiveIdx(0);
  }, [parsed]);

  const dirty = serializeMarkdownSections(sections) !== serializeMarkdownSections(parsed);
  const active = sections[activeIdx];

  function updateBody(i: number, body: string) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, body } : s)));
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
    exportReportPdf(title, serializeMarkdownSections(sections));
  }
  async function handleSave() {
    setSaving(true);
    try {
      await onSave(serializeMarkdownSections(sections));
      toast.success("Cambios guardados");
    } finally {
      setSaving(false);
    }
  }

  if (sections.length === 0) return null;

  return (
    <div className="grid md:grid-cols-[200px_1fr] gap-4">
      <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
        {sections.map((s, i) => (
          <button
            key={`${s.heading}-${i}`}
            type="button"
            onClick={() => setActiveIdx(i)}
            className={`shrink-0 text-left px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap md:whitespace-normal transition ${
              activeIdx === i
                ? "bg-violet-500/15 text-violet-200"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            {s.heading || "Introducción"}
          </button>
        ))}
      </nav>

      <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-display font-bold text-base">{active.heading || "Introducción"}</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copySection(active)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar sección
            </button>
          </div>
        </div>
        <textarea
          className="input min-h-[240px] resize-y font-sans text-sm leading-relaxed"
          value={active.body}
          onChange={(e) => updateBody(activeIdx, e.target.value)}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-white/5">
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
    </div>
  );
}

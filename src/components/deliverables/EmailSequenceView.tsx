import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Copy, Download, FileSpreadsheet, Save } from "lucide-react";
import { toast } from "sonner";
import { parseSections, serializeSections, type ParsedSection } from "@/lib/ai/parse-sections";
import { exportSectionsCsv, exportSectionsTxt } from "@/lib/deliverables/export";

export function EmailSequenceView({
  text,
  approvals,
  onSave,
  onToggleApproval,
}: {
  text: string;
  approvals: Record<string, boolean>;
  onSave: (newText: string) => Promise<void> | void;
  onToggleApproval?: (blockTitle: string, approved: boolean) => Promise<void> | void;
}) {
  const parsed = parseSections(text);
  const [sections, setSections] = useState<ParsedSection[]>(parsed);
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSections(parsed);
    setActiveTab(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (sections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
        No pudimos separar esto en emails individuales. Usá "Ver contenido técnico" para revisar el
        texto original.
      </div>
    );
  }

  const dirty = serializeSections(sections) !== serializeSections(parsed);
  const active = sections[activeTab];

  function updateField(i: number, key: string, value: string) {
    setSections((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, fields: { ...s.fields, [key]: value } } : s)),
    );
  }
  function updateBody(i: number, body: string) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, body } : s)));
  }

  async function copyEmail(s: ParsedSection) {
    await navigator.clipboard.writeText(
      [s.fields.subject, s.body, s.fields.cta].filter(Boolean).join("\n\n"),
    );
    toast.success("Email copiado");
  }
  async function copyAll() {
    await navigator.clipboard.writeText(serializeSections(sections));
    toast.success("Secuencia completa copiada");
  }
  async function handleSave() {
    setSaving(true);
    try {
      await onSave(serializeSections(sections));
      toast.success("Cambios guardados");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 overflow-x-auto">
          {sections.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === i
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {approvals[s.title] && <Check className="w-3 h-3 text-emerald-400" />}
              {s.title.replace("EMAIL ", "Email ")}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition whitespace-nowrap"
        >
          <ClipboardCopy className="w-3.5 h-3.5" /> Copiar todo
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="text-xs text-muted-foreground">Asunto</div>
            <input
              className="input"
              value={active.fields.subject ?? ""}
              onChange={(e) => updateField(activeTab, "subject", e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0 pt-5">
            <button
              type="button"
              onClick={() => copyEmail(active)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar
            </button>
            {onToggleApproval && (
              <button
                type="button"
                onClick={() => onToggleApproval(active.title, !approvals[active.title])}
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-medium transition ${
                  approvals[active.title]
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                }`}
              >
                <Check className="w-3.5 h-3.5" />{" "}
                {approvals[active.title] ? "Aprobado" : "Marcar aprobado"}
              </button>
            )}
          </div>
        </div>
        {"preview" in active.fields && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Preview</div>
            <input
              className="input text-sm italic"
              value={active.fields.preview ?? ""}
              onChange={(e) => updateField(activeTab, "preview", e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Cuerpo</div>
          <textarea
            className="input min-h-[180px] resize-y font-sans text-sm leading-relaxed"
            value={active.body}
            onChange={(e) => updateBody(activeTab, e.target.value)}
          />
        </div>
        {"cta" in active.fields && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">CTA</div>
            <input
              className="input text-sm font-medium"
              value={active.fields.cta ?? ""}
              onChange={(e) => updateField(activeTab, "cta", e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-white/5">
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => exportSectionsTxt(sections, "email-sequence")}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Download className="w-3.5 h-3.5" /> Exportar TXT
          </button>
          <button
            type="button"
            onClick={() => exportSectionsCsv(sections, "email-sequence")}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Exportar CSV
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

import { useEffect, useState } from "react";
import { Check, Copy, Download, Save } from "lucide-react";
import { toast } from "sonner";
import { parseSections, serializeSections, type ParsedSection } from "@/lib/ai/parse-sections";
import { exportSectionsTxt } from "@/lib/deliverables/export";
import { socialChannelLabel, socialFormatLabel } from "@/lib/deliverables/labels";

export function SocialContentView({
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
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSections(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (sections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
        No pudimos separar esto en publicaciones individuales. Usá "Ver contenido técnico" para
        revisar el texto original.
      </div>
    );
  }

  const dirty = serializeSections(sections) !== serializeSections(parsed);
  const visible =
    platformFilter === "all" ? sections : sections.filter((s) => s.title === platformFilter);

  function updateBody(title: string, body: string) {
    setSections((prev) => prev.map((s) => (s.title === title ? { ...s, body } : s)));
  }
  async function copyBlock(s: ParsedSection) {
    await navigator.clipboard.writeText(
      [s.fields.subject, s.body, s.fields.cta].filter(Boolean).join("\n\n"),
    );
    toast.success("Copiado");
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
      <div className="flex items-center gap-1 overflow-x-auto">
        <FilterButton active={platformFilter === "all"} onClick={() => setPlatformFilter("all")}>
          Todas
        </FilterButton>
        {sections.map((s) => (
          <FilterButton
            key={s.title}
            active={platformFilter === s.title}
            onClick={() => setPlatformFilter(s.title)}
          >
            {socialChannelLabel(s.title)}
          </FilterButton>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {visible.map((s) => (
          <div key={s.title} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{socialChannelLabel(s.title)}</p>
                <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
                  {socialFormatLabel(s.title)}
                </span>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => copyBlock(s)}
                  aria-label="Copiar"
                  className="w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {onToggleApproval && (
                  <button
                    type="button"
                    onClick={() => onToggleApproval(s.title, !approvals[s.title])}
                    aria-label="Marcar aprobado"
                    className={`w-7 h-7 grid place-items-center rounded-md transition ${
                      approvals[s.title]
                        ? "text-emerald-400 bg-emerald-500/15"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {s.fields.subject && <p className="text-sm font-medium">{s.fields.subject}</p>}
            <textarea
              className="input min-h-[120px] resize-y font-sans text-sm leading-relaxed"
              value={s.body}
              onChange={(e) => updateBody(s.title, e.target.value)}
            />
            {s.fields.cta && <p className="text-xs text-violet-300">{s.fields.cta}</p>}
            <p className="text-[10px] text-muted-foreground/60">
              {approvals[s.title] ? "Aprobado" : "Pendiente de revisión"}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={() => exportSectionsTxt(sections, "social-pack")}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <Download className="w-3.5 h-3.5" /> Exportar TXT
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-brand text-white disabled:opacity-40 transition"
        >
          <Save className="w-3.5 h-3.5" /> Guardar cambios
        </button>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition ${
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

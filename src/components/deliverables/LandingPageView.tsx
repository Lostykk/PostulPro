import { useEffect, useState } from "react";
import { Copy, Download, FileCode2, Monitor, Save, Smartphone, Tablet, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  emptyLandingData,
  parseLandingJson,
  serializeLandingJson,
  type LandingPageData,
} from "@/lib/deliverables/parse-landing";
import { exportLandingHtml, exportLandingJson } from "@/lib/deliverables/export";
import { EditableInput, EditableTextarea, SectionLabel } from "@/components/deliverables/editable";

const VIEWPORTS = { desktop: "max-w-3xl", tablet: "max-w-md", mobile: "max-w-[360px]" } as const;
type Viewport = keyof typeof VIEWPORTS;

export function LandingPageView({
  text,
  onSave,
}: {
  text: string;
  onSave: (newText: string) => Promise<void> | void;
}) {
  const parsed = parseLandingJson(text) ?? emptyLandingData();
  const [data, setData] = useState<LandingPageData>(parsed);
  const [mode, setMode] = useState<"visual" | "edit">("visual");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [saving, setSaving] = useState(false);

  useEffect(() => setData(parsed), [text]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!parseLandingJson(text)) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
        No pudimos interpretar este contenido como landing page estructurada. Usá "Ver contenido
        técnico" para revisar el texto original.
      </div>
    );
  }

  const dirty = serializeLandingJson(data) !== serializeLandingJson(parsed);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(serializeLandingJson(data));
      toast.success("Cambios guardados");
    } finally {
      setSaving(false);
    }
  }
  async function copyAll() {
    const t = [
      `# ${data.headlines[0] ?? ""}`,
      data.subheadline,
      "",
      data.hero,
      "",
      "## Features",
      ...data.features.map((f) => `- ${f}`),
      "",
      "## Prueba social (sugerido — editar antes de publicar)",
      data.social_proof,
      "",
      "## FAQ",
      ...data.faq.map((f) => `**${f.q}**\n${f.a}`),
      "",
      `## CTA\n${data.cta}`,
    ].join("\n");
    await navigator.clipboard.writeText(t);
    toast.success("Copy completo copiado");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1">
          <TabButton active={mode === "visual"} onClick={() => setMode("visual")}>
            Vista visual
          </TabButton>
          <TabButton active={mode === "edit"} onClick={() => setMode("edit")}>
            Editar
          </TabButton>
        </div>
        {mode === "visual" && (
          <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1">
            <IconTabButton
              active={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
              label="Escritorio"
            >
              <Monitor className="w-3.5 h-3.5" />
            </IconTabButton>
            <IconTabButton
              active={viewport === "tablet"}
              onClick={() => setViewport("tablet")}
              label="Tablet"
            >
              <Tablet className="w-3.5 h-3.5" />
            </IconTabButton>
            <IconTabButton
              active={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
              label="Móvil"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </IconTabButton>
          </div>
        )}
      </div>

      {mode === "visual" ? (
        <div
          className={`mx-auto ${VIEWPORTS[viewport]} rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden`}
        >
          <div className="p-8 text-center space-y-4">
            {data.heroImageUrl ? (
              <img src={data.heroImageUrl} alt="" className="w-full rounded-xl" />
            ) : (
              <div className="h-40 rounded-xl border border-dashed border-white/20 bg-white/5 grid place-items-center text-xs text-muted-foreground">
                Imagen hero — sin reemplazar
              </div>
            )}
            <h1 className="font-display text-2xl font-bold">
              {data.headlines[0] || "Tu headline"}
            </h1>
            {data.subheadline && <p className="text-muted-foreground">{data.subheadline}</p>}
            {data.hero && (
              <p className="text-sm text-muted-foreground/80 max-w-xl mx-auto">{data.hero}</p>
            )}
            <a className="inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm">
              {data.cta || "Empezar ahora"}
            </a>
          </div>
          {data.features.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3 p-6 border-t border-white/5">
              {data.features.map((f, i) => (
                <div key={i} className="rounded-lg bg-white/5 border border-white/10 p-3 text-sm">
                  {f}
                </div>
              ))}
            </div>
          )}
          {data.social_proof && (
            <div className="p-6 border-t border-white/5 text-center text-sm text-muted-foreground italic">
              {data.social_proof}
            </div>
          )}
          {data.faq.length > 0 && (
            <div className="p-6 border-t border-white/5 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Preguntas frecuentes
              </p>
              {data.faq.map((f, i) => (
                <div key={i}>
                  <p className="text-sm font-medium">{f.q}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.a}</p>
                </div>
              ))}
            </div>
          )}
          <div className="p-6 border-t border-white/5 text-center">
            <a className="inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm">
              {data.cta || "Empezar ahora"}
            </a>
            <p className="mt-3 text-[11px] text-muted-foreground/60">
              Preview local — no publicado en un dominio real.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6 max-w-2xl">
          <div>
            <SectionLabel>Imagen hero</SectionLabel>
            <EditableInput
              value={data.heroImageUrl ?? ""}
              onChange={(v) => setData({ ...data, heroImageUrl: v || undefined })}
              placeholder="Pegá una URL real de imagen (opcional) — si la dejás vacía se muestra un placeholder"
            />
          </div>
          <div>
            <SectionLabel>Headlines</SectionLabel>
            <div className="space-y-2">
              {data.headlines.map((h, i) => (
                <EditableInput
                  key={i}
                  value={h}
                  onChange={(v) =>
                    setData({ ...data, headlines: data.headlines.map((x, j) => (j === i ? v : x)) })
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
                    setData({ ...data, features: data.features.map((x, j) => (j === i ? v : x)) })
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Prueba social (sugerido — editar antes de publicar)</SectionLabel>
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
            <EditableInput value={data.cta} onChange={(v) => setData({ ...data, cta: v })} big />
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
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-white/5">
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={copyAll}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Copy className="w-3.5 h-3.5" /> Copiar todo el copy
          </button>
          <button
            type="button"
            onClick={() => exportLandingHtml(data, data.heroImageUrl)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <FileCode2 className="w-3.5 h-3.5" /> Exportar HTML
          </button>
          <button
            type="button"
            onClick={() => exportLandingJson(data)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Download className="w-3.5 h-3.5" /> Exportar JSON
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setData(parsed)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
            >
              <Undo2 className="w-3.5 h-3.5" /> Descartar cambios sin guardar
            </button>
          )}
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

function TabButton({
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
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function IconTabButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-md transition ${active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

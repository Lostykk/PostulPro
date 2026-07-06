import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Zap, Copy, RefreshCw, Download, Save, Loader2 } from "lucide-react";
import { useAiStream, downloadTxt } from "@/hooks/use-ai-stream";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tools/copywriter")({
  head: () => ({ meta: [{ title: "Copywriter IA — PostulPro" }] }),
  component: CopywriterPage,
});

const CONTENT_TYPES = [
  "Email de ventas",
  "Post LinkedIn",
  "Tweet / Hilo",
  "Anuncio Facebook",
  "Anuncio Google",
  "Caption Instagram",
  "Guión YouTube",
  "Artículo Blog",
  "Mensaje WhatsApp",
  "Cold Email",
];
const TONES = ["Profesional", "Casual", "Urgente", "Inspirador", "Divertido", "Técnico"];
const LENGTHS = ["Corto", "Medio", "Largo"];
const LANGS = ["Español", "English", "Português", "Français", "Deutsch", "Italiano", "日本語", "中文", "Русский", "العربية"];

function CopywriterPage() {
  const { output, streaming, generationId, saved, generate, save } = useAiStream("copywriter");
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState(TONES[0]);
  const [length, setLength] = useState(LENGTHS[1]);
  const [language, setLanguage] = useState(LANGS[0]);
  const [context, setContext] = useState("");

  const words = output.trim() ? output.trim().split(/\s+/).length : 0;

  async function handleGenerate() {
    if (!product.trim() || !audience.trim()) {
      toast.error("Completa producto y audiencia");
      return;
    }
    const prompt = `Escribe un ${contentType} en ${language}.
Producto/servicio: ${product}
Audiencia objetivo: ${audience}
Tono: ${tone}
Longitud: ${length}
${context ? `Contexto adicional: ${context}` : ""}

Devuelve solo el copy final, sin comentarios ni explicaciones.`;
    await generate(prompt, { title: `${contentType} · ${product.slice(0, 40)}` });
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(output);
    toast.success("Copiado");
  }
  function handleDownload() {
    downloadTxt(output, `postulpro-${Date.now()}.txt`);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">✍️ Copywriter IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">1 crédito por generación · streaming en tiempo real</p>
      </header>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 h-fit">
          <Field label="Tipo de contenido">
            <Select value={contentType} onChange={setContentType} options={CONTENT_TYPES} />
          </Field>
          <Field label="Producto / servicio">
            <input
              className="input"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Ej: CRM para agencias"
            />
          </Field>
          <Field label="Audiencia objetivo">
            <input
              className="input"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Ej: fundadores B2B LATAM"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tono">
              <Select value={tone} onChange={setTone} options={TONES} />
            </Field>
            <Field label="Longitud">
              <Select value={length} onChange={setLength} options={LENGTHS} />
            </Field>
          </div>
          <Field label="Idioma">
            <Select value={language} onChange={setLanguage} options={LANGS} />
          </Field>
          <Field label="Contexto adicional (opcional)">
            <textarea
              className="input min-h-[90px] resize-y"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Datos de la marca, palabras clave, ejemplos…"
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
                <Zap className="w-4 h-4" /> Generar (1 crédito)
              </>
            )}
          </button>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-[color:var(--surface-1)]/60 min-h-[500px] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="text-xs text-muted-foreground">
              {words} {words === 1 ? "palabra" : "palabras"}
            </div>
            <div className="flex gap-1">
              <ToolbarBtn onClick={handleCopy} disabled={!output} icon={<Copy className="w-3.5 h-3.5" />} label="Copiar" />
              <ToolbarBtn onClick={handleGenerate} disabled={streaming || !product} icon={<RefreshCw className="w-3.5 h-3.5" />} label="Regenerar" />
              <ToolbarBtn onClick={handleDownload} disabled={!output} icon={<Download className="w-3.5 h-3.5" />} label="TXT" />
              <ToolbarBtn onClick={save} disabled={!generationId || streaming || saved} icon={<Save className="w-3.5 h-3.5" />} label={saved ? "Guardado" : "Guardar"} />
            </div>
          </div>
          <div className="flex-1 p-6 overflow-auto">
            {output ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {output}
                {streaming && <span className="inline-block w-2 h-4 ml-0.5 bg-violet-400 animate-pulse align-middle" />}
              </pre>
            ) : (
              <div className="h-full grid place-items-center text-center text-muted-foreground">
                <div>
                  <div className="text-4xl mb-3">✨</div>
                  <p className="text-sm">Completa el panel y presiona <span className="text-foreground">Generar</span>.</p>
                </div>
              </div>
            )}
          </div>
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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-background">
          {o}
        </option>
      ))}
    </select>
  );
}

function ToolbarBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition disabled:opacity-40 disabled:pointer-events-none"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

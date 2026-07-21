import { useState } from "react";
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { LandingImage, LandingSection, SectionContent } from "@/lib/landing/schema";
import { deleteLandingImage, uploadLandingImage, validateLandingImage } from "@/lib/landing/images";

// Type-specific form controls (Fase H): title/subtitle/body/CTA/link plus
// add/remove for list-shaped fields (items, faq, testimonials, pricing).
// Every field maps 1:1 onto `section.content` — no hidden state.
export function SectionEditor({
  section,
  onChange,
  userId,
}: {
  section: LandingSection;
  onChange: (content: SectionContent) => void;
  userId?: string;
}) {
  const c = section.content;
  const set = (patch: Partial<SectionContent>) => onChange({ ...c, ...patch });

  return (
    <div className="space-y-3">
      {"title" in defaultsFor(section.type) && (
        <TextField label={fieldLabel(section.type, "title")} value={c.title ?? ""} onChange={(v) => set({ title: v })} />
      )}
      {"eyebrow" in defaultsFor(section.type) && (
        <TextField label="Eyebrow" value={c.eyebrow ?? ""} onChange={(v) => set({ eyebrow: v })} />
      )}
      {"subtitle" in defaultsFor(section.type) && (
        <TextAreaField label="Subtítulo" value={c.subtitle ?? ""} onChange={(v) => set({ subtitle: v })} />
      )}
      {"body" in defaultsFor(section.type) && (
        <TextAreaField label="Cuerpo" value={c.body ?? ""} onChange={(v) => set({ body: v })} />
      )}
      {"ctaLabel" in defaultsFor(section.type) && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Texto del botón" value={c.ctaLabel ?? ""} onChange={(v) => set({ ctaLabel: v })} />
          <TextField label="Link del botón" value={c.ctaHref ?? ""} onChange={(v) => set({ ctaHref: v })} />
        </div>
      )}
      {section.type === "hero" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Texto botón secundario"
            value={c.secondaryCtaLabel ?? ""}
            onChange={(v) => set({ secondaryCtaLabel: v })}
          />
          <TextField
            label="Link botón secundario"
            value={c.secondaryCtaHref ?? ""}
            onChange={(v) => set({ secondaryCtaHref: v })}
          />
        </div>
      )}
      {section.type === "hero" && (
        <HeroImageField
          image={c.image}
          userId={userId}
          onChange={(image) => set({ image })}
        />
      )}

      {(section.type === "benefits" || section.type === "features" || section.type === "how_it_works" || section.type === "comparison") && (
        <ListEditor
          label="Elementos"
          items={c.items ?? []}
          onChange={(items) => set({ items })}
          renderItem={(item, update) => (
            <>
              <TextField label="Título" value={item.title} onChange={(v) => update({ ...item, title: v })} />
              <TextAreaField label="Descripción" value={item.body} onChange={(v) => update({ ...item, body: v })} />
            </>
          )}
          newItem={{ title: "Nuevo elemento", body: "" }}
        />
      )}

      {section.type === "faq" && (
        <ListEditor
          label="Preguntas"
          items={c.faq ?? []}
          onChange={(faq) => set({ faq })}
          renderItem={(item, update) => (
            <>
              <TextField label="Pregunta" value={item.q} onChange={(v) => update({ ...item, q: v })} />
              <TextAreaField label="Respuesta" value={item.a} onChange={(v) => update({ ...item, a: v })} />
            </>
          )}
          newItem={{ q: "Nueva pregunta", a: "" }}
        />
      )}

      {section.type === "testimonials" && (
        <ListEditor
          label="Testimonios"
          items={c.testimonials ?? []}
          onChange={(testimonials) => set({ testimonials })}
          renderItem={(item, update) => (
            <>
              {item.source === "ai_suggested" && (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                  Ejemplo sugerido por IA — editalo para confirmar que es real
                </p>
              )}
              <TextAreaField
                label="Cita"
                value={item.quote}
                onChange={(v) => update({ ...item, quote: v, source: "user_confirmed" })}
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Nombre" value={item.name} onChange={(v) => update({ ...item, name: v, source: "user_confirmed" })} />
                <TextField label="Rol" value={item.role} onChange={(v) => update({ ...item, role: v, source: "user_confirmed" })} />
              </div>
            </>
          )}
          newItem={{ quote: "", name: "", role: "", source: "user_confirmed" }}
        />
      )}

      {section.type === "statistics" && (
        <ListEditor
          label="Estadísticas"
          items={c.stats ?? []}
          onChange={(stats) => set({ stats })}
          renderItem={(item, update) => (
            <>
              {item.source === "ai_suggested" && (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                  Ejemplo sugerido por IA — editalo para confirmar que es real
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Valor" value={item.value} onChange={(v) => update({ ...item, value: v, source: "user_confirmed" })} />
                <TextField label="Etiqueta" value={item.label} onChange={(v) => update({ ...item, label: v, source: "user_confirmed" })} />
              </div>
            </>
          )}
          newItem={{ label: "Etiqueta", value: "0", source: "user_confirmed" }}
        />
      )}

      {section.type === "pricing" && (
        <ListEditor
          label="Planes"
          items={c.pricing ?? []}
          onChange={(pricing) => set({ pricing })}
          renderItem={(item, update) => (
            <>
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Nombre" value={item.name} onChange={(v) => update({ ...item, name: v })} />
                <TextField label="Precio" value={item.price} onChange={(v) => update({ ...item, price: v })} />
              </div>
              <TextField
                label="Características (separadas por coma)"
                value={item.features.join(", ")}
                onChange={(v) => update({ ...item, features: v.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <TextField label="Texto del botón" value={item.ctaLabel} onChange={(v) => update({ ...item, ctaLabel: v })} />
            </>
          )}
          newItem={{ name: "Plan", price: "$0", period: "/mes", features: [], ctaLabel: "Elegir plan", highlighted: false }}
        />
      )}

      {section.type === "navigation" && (
        <ListEditor
          label="Links de navegación"
          items={c.navLinks ?? []}
          onChange={(navLinks) => set({ navLinks })}
          renderItem={(item, update) => (
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Texto" value={item.label} onChange={(v) => update({ ...item, label: v })} />
              <TextField label="Link" value={item.href} onChange={(v) => update({ ...item, href: v })} />
            </div>
          )}
          newItem={{ label: "Link", href: "#" }}
        />
      )}

      {section.type === "trust_logos" && (
        <TextField
          label="Logos (nombres separados por coma)"
          value={(c.logos ?? []).join(", ")}
          onChange={(v) => set({ logos: v.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      )}

      {section.type === "lead_form" && (
        <TextField
          label="Campos del formulario (separados por coma)"
          value={(c.formFields ?? []).join(", ")}
          onChange={(v) => set({ formFields: v.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      )}
    </div>
  );
}

function HeroImageField({
  image,
  userId,
  onChange,
}: {
  image?: LandingImage;
  userId?: string;
  onChange: (image: LandingImage) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    const err = validateLandingImage(file);
    if (err) {
      toast.error(err);
      return;
    }
    if (!userId) {
      toast.error("Guardá la generación antes de subir una imagen");
      return;
    }
    setUploading(true);
    try {
      const previousUrl = image?.url;
      const url = await uploadLandingImage(userId, file);
      onChange({ url, alt: image?.alt ?? "" });
      toast.success("Imagen subida");
      if (previousUrl) void deleteLandingImage(previousUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    if (image?.url) void deleteLandingImage(image.url);
    onChange({ url: null, alt: "" });
  }

  return (
    <div>
      <FieldLabel>Imagen de portada</FieldLabel>
      {image?.url ? (
        <div className="relative mb-2">
          <img src={image.url} alt={image.alt} className="w-full h-32 object-cover rounded-lg border border-white/10" />
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Quitar imagen"
            className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white hover:bg-black/80"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="h-20 rounded-lg border-2 border-dashed border-white/15 grid place-items-center text-xs text-muted-foreground mb-2">
          Imagen de portada pendiente
        </div>
      )}
      <div className="flex gap-2">
        <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition cursor-pointer">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Subir imagen
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <input
        className="input mt-2"
        value={image?.url ?? ""}
        onChange={(e) => onChange({ url: e.target.value || null, alt: image?.alt ?? "" })}
        placeholder="...o pegá una URL real de imagen"
      />
      <input
        className="input mt-2"
        value={image?.alt ?? ""}
        onChange={(e) => onChange({ url: image?.url ?? null, alt: e.target.value })}
        placeholder="Texto alternativo (alt) para accesibilidad"
      />
    </div>
  );
}

function fieldLabel(type: string, field: "title"): string {
  if (field === "title") {
    if (type === "hero" || type === "final_cta") return "Título";
    if (type === "footer") return "Nombre de marca";
    if (type === "navigation") return "Nombre de marca";
    return "Título";
  }
  return field;
}

// Which optional content fields make sense for each section type — drives
// which inputs show up in the editor panel above.
function defaultsFor(type: LandingSection["type"]): Partial<SectionContent> {
  switch (type) {
    case "hero":
      return { eyebrow: "", title: "", subtitle: "", body: "", ctaLabel: "" };
    case "navigation":
      return { title: "", ctaLabel: "" };
    case "problem":
    case "solution":
    case "guarantee":
      return { title: "", body: "" };
    case "offer":
      return { title: "", body: "", ctaLabel: "" };
    case "benefits":
    case "features":
    case "how_it_works":
    case "comparison":
    case "testimonials":
    case "faq":
    case "pricing":
      return { title: "" };
    case "trust_logos":
      return { title: "" };
    case "final_cta":
      return { title: "", ctaLabel: "" };
    case "footer":
      return { title: "", body: "" };
    case "announcement_bar":
      return { body: "", ctaLabel: "" };
    case "lead_form":
      return { title: "", ctaLabel: "" };
    default:
      return {};
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-muted-foreground mb-1">{children}</span>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <textarea className="input min-h-[70px] resize-y" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ListEditor<T>({
  label,
  items,
  onChange,
  renderItem,
  newItem,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, update: (next: T) => void) => React.ReactNode;
  newItem: T;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 relative">
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label="Quitar elemento"
              className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-white/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {renderItem(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, newItem])}
        className="mt-2 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition"
      >
        <Plus className="w-3.5 h-3.5" /> Agregar
      </button>
    </div>
  );
}

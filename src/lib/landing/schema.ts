// landing_page_v2: the modular, section-based document the visual builder
// (LandingBuilder) reads and writes. Stored as JSON text in the same
// generations.edited_output column every other deliverable already uses
// (see generation-actions.ts) — no new table for the working document,
// only for publish snapshots (see ../publish.ts).
//
// A generation produced by the landing-copy tool is v1 (LandingPageData,
// see parse-landing.ts): headline/subheadline/features/faq/etc, no concept
// of sections, themes or ordering. migrateLegacyLanding maps that shape to
// v2 sections purely (no AI call, no new copy) so existing generations gain
// the builder without regenerating or losing what the model wrote.

import type { LandingPageData } from "@/lib/deliverables/parse-landing";
import { THEME_PRESETS } from "@/lib/landing/themes";

export const SECTION_TYPES = [
  "announcement_bar",
  "navigation",
  "hero",
  "trust_logos",
  "problem",
  "solution",
  "benefits",
  "features",
  "how_it_works",
  "statistics",
  "testimonials",
  "comparison",
  "pricing",
  "offer",
  "guarantee",
  "faq",
  "lead_form",
  "final_cta",
  "footer",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType, string> = {
  announcement_bar: "Barra de anuncio",
  navigation: "Navegación",
  hero: "Hero",
  trust_logos: "Logos de confianza",
  problem: "Problema",
  solution: "Solución",
  benefits: "Beneficios",
  features: "Características",
  how_it_works: "Cómo funciona",
  statistics: "Estadísticas",
  testimonials: "Testimonios",
  comparison: "Comparación",
  pricing: "Precios",
  offer: "Oferta",
  guarantee: "Garantía",
  faq: "Preguntas frecuentes",
  lead_form: "Formulario de contacto",
  final_cta: "CTA final",
  footer: "Footer",
};

export type LandingImage = {
  url: string | null;
  alt: string;
  overlay?: boolean;
  aspect?: "square" | "video" | "wide" | "portrait";
};

export type LandingItem = { title: string; body: string };
export type LandingFaqItem = { q: string; a: string };
export type LandingTestimonial = { quote: string; name: string; role: string };
export type LandingPricingTier = {
  name: string;
  price: string;
  period: string;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
};
export type LandingNavLink = { label: string; href: string };
export type LandingStat = { label: string; value: string };

export type SectionContent = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  image?: LandingImage;
  items?: LandingItem[];
  faq?: LandingFaqItem[];
  testimonials?: LandingTestimonial[];
  pricing?: LandingPricingTier[];
  navLinks?: LandingNavLink[];
  stats?: LandingStat[];
  logos?: string[];
  formFields?: string[];
};

export type LandingSection = {
  id: string;
  type: SectionType;
  content: SectionContent;
  visible: boolean;
  order: number;
};

export type LandingThemeId = "authority_dark" | "conversion_light" | "bold_brand";

export type LandingTheme = {
  id: LandingThemeId;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  buttonStyle: "solid" | "outline" | "gradient";
  radius: "none" | "md" | "lg" | "full";
  shadow: boolean;
  maxWidth: number;
  spacing: "compact" | "normal" | "spacious";
  font: "sans" | "display";
  intensity: "subtle" | "balanced" | "bold";
};

export type LandingSeo = {
  title: string;
  description: string;
  slug: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonical: string;
  noindex: boolean;
};

export type LandingFormConfig = {
  enabled: boolean;
  fields: string[];
  consentText: string;
  successMessage: string;
};

export type LandingPublishConfig = {
  status: "draft" | "published";
  slug: string | null;
  publishedAt: string | null;
};

export type LandingPageV2 = {
  version: 2;
  metadata: { name: string; createdAt: string; updatedAt: string };
  theme: LandingTheme;
  seo: LandingSeo;
  sections: LandingSection[];
  form_config: LandingFormConfig;
  publish_config: LandingPublishConfig;
};

let idCounter = 0;
export function genSectionId(type: SectionType): string {
  idCounter += 1;
  return `${type}_${Date.now().toString(36)}_${idCounter}`;
}

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function emptyLandingV2(name = "Landing sin título"): LandingPageV2 {
  const now = new Date().toISOString();
  return {
    version: 2,
    metadata: { name, createdAt: now, updatedAt: now },
    theme: THEME_PRESETS.conversion_light,
    seo: {
      title: name,
      description: "",
      slug: slugify(name) || "landing",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      canonical: "",
      noindex: true,
    },
    sections: [],
    form_config: {
      enabled: false,
      fields: ["Nombre", "Email"],
      consentText: "Acepto ser contactado sobre este producto.",
      successMessage: "¡Gracias! Te vamos a contactar pronto.",
    },
    publish_config: { status: "draft", slug: null, publishedAt: null },
  };
}

// Factory used by the "Agregar sección" picker — sensible, non-empty
// defaults so a freshly added section never renders as a blank block.
export function createSection(type: SectionType, order: number): LandingSection {
  const base: LandingSection = {
    id: genSectionId(type),
    type,
    visible: true,
    order,
    content: {},
  };
  switch (type) {
    case "announcement_bar":
      return { ...base, content: { body: "🎉 Oferta por tiempo limitado", ctaLabel: "Ver más", ctaHref: "#" } };
    case "navigation":
      return {
        ...base,
        content: {
          title: "Tu marca",
          navLinks: [
            { label: "Características", href: "#features" },
            { label: "Precios", href: "#pricing" },
            { label: "FAQ", href: "#faq" },
          ],
          ctaLabel: "Empezar ahora",
          ctaHref: "#cta",
        },
      };
    case "hero":
      return {
        ...base,
        content: {
          eyebrow: "Nuevo",
          title: "Tu headline principal",
          subtitle: "Un subtítulo que explica el valor en una frase.",
          ctaLabel: "Empezar ahora",
          ctaHref: "#cta",
          image: { url: null, alt: "" },
        },
      };
    case "trust_logos":
      return { ...base, content: { title: "Confían en nosotros", logos: [] } };
    case "problem":
      return { ...base, content: { title: "El problema", body: "Describí el dolor que resuelve tu producto." } };
    case "solution":
      return { ...base, content: { title: "La solución", body: "Describí cómo tu producto lo resuelve." } };
    case "benefits":
      return {
        ...base,
        content: {
          title: "Beneficios",
          items: [
            { title: "Beneficio 1", body: "Descripción breve." },
            { title: "Beneficio 2", body: "Descripción breve." },
            { title: "Beneficio 3", body: "Descripción breve." },
          ],
        },
      };
    case "features":
      return {
        ...base,
        content: {
          title: "Características",
          items: [
            { title: "Característica 1", body: "Descripción breve." },
            { title: "Característica 2", body: "Descripción breve." },
          ],
        },
      };
    case "how_it_works":
      return {
        ...base,
        content: {
          title: "Cómo funciona",
          items: [
            { title: "Paso 1", body: "Descripción." },
            { title: "Paso 2", body: "Descripción." },
            { title: "Paso 3", body: "Descripción." },
          ],
        },
      };
    case "statistics":
      return {
        ...base,
        content: {
          stats: [
            { label: "Clientes", value: "1,000+" },
            { label: "Satisfacción", value: "98%" },
          ],
        },
      };
    case "testimonials":
      return {
        ...base,
        content: {
          title: "Lo que dicen nuestros clientes",
          testimonials: [{ quote: "Excelente producto.", name: "Cliente satisfecho", role: "" }],
        },
      };
    case "comparison":
      return {
        ...base,
        content: {
          title: "Por qué elegirnos",
          items: [
            { title: "Nosotros", body: "Ventaja clave." },
            { title: "Alternativa", body: "Limitación típica." },
          ],
        },
      };
    case "pricing":
      return {
        ...base,
        content: {
          title: "Precios",
          pricing: [
            {
              name: "Plan único",
              price: "$0",
              period: "/mes",
              features: ["Incluye esto", "Incluye esto también"],
              ctaLabel: "Elegir plan",
              highlighted: true,
            },
          ],
        },
      };
    case "offer":
      return { ...base, content: { title: "Oferta especial", body: "Detalle de la oferta.", ctaLabel: "Aprovechar oferta", ctaHref: "#cta" } };
    case "guarantee":
      return { ...base, content: { title: "Garantía", body: "Describí tu garantía o política de devolución." } };
    case "faq":
      return {
        ...base,
        content: { title: "Preguntas frecuentes", faq: [{ q: "¿Pregunta frecuente?", a: "Respuesta." }] },
      };
    case "lead_form":
      return { ...base, content: { title: "Dejanos tus datos", formFields: ["Nombre", "Email"], ctaLabel: "Enviar" } };
    case "final_cta":
      return { ...base, content: { title: "¿Listo para empezar?", ctaLabel: "Empezar ahora", ctaHref: "#" } };
    case "footer":
      return { ...base, content: { title: "Tu marca", body: `© ${new Date().getFullYear()} Todos los derechos reservados.` } };
    default:
      return base;
  }
}

// Maps the legacy v1 landing-copy output (see parse-landing.ts) to a v2
// document with a sensible starter section layout — no regeneration, no
// content invented beyond what the model already produced.
export function migrateLegacyLanding(data: LandingPageData, name = "Landing page"): LandingPageV2 {
  const doc = emptyLandingV2(name);
  const sections: LandingSection[] = [];
  let order = 0;

  sections.push({
    id: "legacy_hero",
    type: "hero",
    visible: true,
    order: order++,
    content: {
      title: data.headlines[0] || "Tu headline",
      subtitle: data.subheadline || undefined,
      body: data.hero || undefined,
      ctaLabel: data.cta || "Empezar ahora",
      ctaHref: "#cta",
      image: { url: data.heroImageUrl ?? null, alt: "" },
    },
  });

  if (data.headlines.length > 1) {
    sections.push({
      id: "legacy_alt_headlines",
      type: "announcement_bar",
      visible: false,
      order: order++,
      content: { body: data.headlines.slice(1).join(" · ") },
    });
  }

  if (data.features.length > 0) {
    sections.push({
      id: "legacy_features",
      type: "benefits",
      visible: true,
      order: order++,
      content: {
        title: "Beneficios",
        items: data.features.map((f) => {
          const [title, ...rest] = f.split(":");
          return rest.length > 0
            ? { title: title.trim(), body: rest.join(":").trim() }
            : { title: f, body: "" };
        }),
      },
    });
  }

  if (data.social_proof) {
    sections.push({
      id: "legacy_social_proof",
      type: "testimonials",
      visible: true,
      order: order++,
      content: {
        title: "Lo que dicen",
        testimonials: data.social_proof
          .split(/\n\n+/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block) => {
            const m = block.match(/^"?(.+?)"?\s*—\s*(.+)$/);
            return m ? { quote: m[1], name: m[2], role: "" } : { quote: block, name: "", role: "" };
          }),
      },
    });
  }

  if (data.faq.length > 0) {
    sections.push({
      id: "legacy_faq",
      type: "faq",
      visible: true,
      order: order++,
      content: { title: "Preguntas frecuentes", faq: data.faq },
    });
  }

  sections.push({
    id: "legacy_final_cta",
    type: "final_cta",
    visible: true,
    order: order++,
    content: { title: data.cta || "¿Listo para empezar?", ctaLabel: data.cta || "Empezar ahora", ctaHref: "#" },
  });

  doc.sections = sections;
  doc.seo.title = data.meta_title || doc.seo.title;
  doc.seo.description = data.meta_description || "";
  return doc;
}

export function isLandingV2(raw: unknown): raw is LandingPageV2 {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { version?: unknown }).version === 2 &&
    Array.isArray((raw as { sections?: unknown }).sections)
  );
}

export function parseLandingV2(raw: string): LandingPageV2 | null {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (isLandingV2(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function serializeLandingV2(doc: LandingPageV2): string {
  return JSON.stringify({ ...doc, metadata: { ...doc.metadata, updatedAt: new Date().toISOString() } }, null, 2);
}

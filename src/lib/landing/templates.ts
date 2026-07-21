import type { LandingTemplateId, LandingThemeId, SectionType } from "@/lib/landing/schema";

// The 8 structural "modelos". Each one is a bundle of LAYOUT decisions
// (hero composition, nav chrome, grid density, card treatment, footer
// shape, heading case, which sections a fresh landing starts with, and
// which abstract fallback visual fills an empty image) — never content and
// never color. Colors/typography/spacing live in the preset (themes.ts).
// This is what gives the 8 templates real structural differences instead
// of just reskins: LandingSectionRenderer and export.ts both branch on
// these fields, not on 8 separate copies of the section markup.
export type HeroLayout = "split-right" | "split-left" | "centered" | "fullbleed" | "editorial";
export type NavStyle = "simple" | "boxed" | "minimal-centered" | "bold-underline";
export type CardStyle = "flat" | "bordered" | "shadow-lift" | "gradient-top";
export type FooterStyle = "minimal" | "columns" | "cta-band";
export type FallbackVisualId =
  | "dashboard-mockup"
  | "abstract-arch"
  | "grid-pattern"
  | "editorial-shape"
  | "device-frame"
  | "circuit-lines"
  | "warm-texture";

export type LandingTemplateConfig = {
  id: LandingTemplateId;
  name: string;
  shortDescription: string;
  recommendedFor: string;
  heroLayout: HeroLayout;
  navStyle: NavStyle;
  gridColumns: 2 | 3 | 4;
  cardStyle: CardStyle;
  footerStyle: FooterStyle;
  headingTransform: "none" | "uppercase";
  defaultPresetId: LandingThemeId;
  fallbackVisualId: FallbackVisualId;
  defaultSectionTypes: SectionType[];
};

export const LANDING_TEMPLATES: Record<LandingTemplateId, LandingTemplateConfig> = {
  saas_premium: {
    id: "saas_premium",
    name: "SaaS Premium",
    shortDescription: "Producto tecnológico con demostración clara y estética moderna.",
    recommendedFor: "Software, dashboards, herramientas B2B/B2C con un producto visual para mostrar.",
    heroLayout: "split-right",
    navStyle: "boxed",
    gridColumns: 3,
    cardStyle: "shadow-lift",
    footerStyle: "columns",
    headingTransform: "none",
    defaultPresetId: "tecnologico",
    fallbackVisualId: "dashboard-mockup",
    defaultSectionTypes: [
      "navigation",
      "hero",
      "trust_logos",
      "benefits",
      "features",
      "how_it_works",
      "testimonials",
      "pricing",
      "faq",
      "final_cta",
      "footer",
    ],
  },
  startup_bold: {
    id: "startup_bold",
    name: "Startup Bold",
    shortDescription: "Títulos grandes, alto contraste y energía de lanzamiento.",
    recommendedFor: "Lanzamientos, productos nuevos que necesitan generar impacto inmediato.",
    heroLayout: "centered",
    navStyle: "bold-underline",
    gridColumns: 2,
    cardStyle: "gradient-top",
    footerStyle: "cta-band",
    headingTransform: "uppercase",
    defaultPresetId: "bold_brand",
    fallbackVisualId: "abstract-arch",
    defaultSectionTypes: [
      "announcement_bar",
      "navigation",
      "hero",
      "problem",
      "solution",
      "benefits",
      "statistics",
      "final_cta",
      "footer",
    ],
  },
  minimal_elegant: {
    id: "minimal_elegant",
    name: "Minimal Elegante",
    shortDescription: "Composición limpia, espacios deliberados y jerarquía clara.",
    recommendedFor: "Marcas que priorizan la sensación premium sobre la densidad de información.",
    heroLayout: "split-left",
    navStyle: "minimal-centered",
    gridColumns: 3,
    cardStyle: "flat",
    footerStyle: "minimal",
    headingTransform: "none",
    defaultPresetId: "minimalista",
    fallbackVisualId: "grid-pattern",
    defaultSectionTypes: ["navigation", "hero", "features", "how_it_works", "testimonials", "faq", "final_cta", "footer"],
  },
  luxury_editorial: {
    id: "luxury_editorial",
    name: "Luxury Editorial",
    shortDescription: "Estética editorial, tipografía sofisticada y ritmo aspiracional.",
    recommendedFor: "Productos o servicios de alto valor percibido, posicionamiento premium.",
    heroLayout: "editorial",
    navStyle: "minimal-centered",
    gridColumns: 2,
    cardStyle: "bordered",
    footerStyle: "minimal",
    headingTransform: "uppercase",
    defaultPresetId: "elegante",
    fallbackVisualId: "editorial-shape",
    defaultSectionTypes: ["navigation", "hero", "solution", "benefits", "testimonials", "guarantee", "final_cta", "footer"],
  },
  corporate_trust: {
    id: "corporate_trust",
    name: "Corporate Trust",
    shortDescription: "Credibilidad B2B: estructura sólida, casos de uso y comparación.",
    recommendedFor: "Servicios B2B donde la confianza y la evidencia pesan más que el impacto visual.",
    heroLayout: "split-right",
    navStyle: "boxed",
    gridColumns: 4,
    cardStyle: "bordered",
    footerStyle: "columns",
    headingTransform: "none",
    defaultPresetId: "conversion_light",
    fallbackVisualId: "grid-pattern",
    defaultSectionTypes: [
      "navigation",
      "hero",
      "trust_logos",
      "problem",
      "solution",
      "features",
      "comparison",
      "testimonials",
      "faq",
      "final_cta",
      "footer",
    ],
  },
  personal_brand: {
    id: "personal_brand",
    name: "Marca Personal",
    shortDescription: "Historia, autoridad y contacto directo para creadores y consultores.",
    recommendedFor: "Coaches, consultores, creadores de contenido, profesionales independientes.",
    heroLayout: "centered",
    navStyle: "minimal-centered",
    gridColumns: 2,
    cardStyle: "flat",
    footerStyle: "minimal",
    headingTransform: "none",
    defaultPresetId: "calido",
    fallbackVisualId: "device-frame",
    defaultSectionTypes: [
      "navigation",
      "hero",
      "solution",
      "benefits",
      "how_it_works",
      "testimonials",
      "offer",
      "faq",
      "final_cta",
      "footer",
    ],
  },
  product_launch: {
    id: "product_launch",
    name: "Lanzamiento de Producto",
    shortDescription: "Problema, solución, mecanismo, oferta y urgencia ética.",
    recommendedFor: "Lanzamiento de un producto o infoproducto con oferta por tiempo limitado.",
    heroLayout: "fullbleed",
    navStyle: "bold-underline",
    gridColumns: 3,
    cardStyle: "gradient-top",
    footerStyle: "cta-band",
    headingTransform: "uppercase",
    defaultPresetId: "authority_dark",
    fallbackVisualId: "circuit-lines",
    defaultSectionTypes: [
      "announcement_bar",
      "navigation",
      "hero",
      "problem",
      "solution",
      "how_it_works",
      "benefits",
      "offer",
      "guarantee",
      "faq",
      "final_cta",
      "footer",
    ],
  },
  local_service: {
    id: "local_service",
    name: "Servicio o Negocio Local",
    shortDescription: "Propuesta clara, servicios, zona de cobertura y contacto directo.",
    recommendedFor: "Negocios locales y servicios con área geográfica y contacto como CTA principal.",
    heroLayout: "split-left",
    navStyle: "simple",
    gridColumns: 3,
    cardStyle: "bordered",
    footerStyle: "columns",
    headingTransform: "none",
    defaultPresetId: "calido",
    fallbackVisualId: "warm-texture",
    defaultSectionTypes: [
      "navigation",
      "hero",
      "trust_logos",
      "features",
      "how_it_works",
      "testimonials",
      "pricing",
      "faq",
      "lead_form",
      "final_cta",
      "footer",
    ],
  },
};

export const LANDING_TEMPLATE_LIST = Object.values(LANDING_TEMPLATES);

export function templateConfig(id: LandingTemplateId): LandingTemplateConfig {
  return LANDING_TEMPLATES[id] ?? LANDING_TEMPLATES.saas_premium;
}

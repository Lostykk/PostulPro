import type { LandingTheme, LandingThemeId } from "@/lib/landing/schema";

// 8 genuinely different presets ("Landing Studio"). The original 3 ids
// (authority_dark/conversion_light/bold_brand) are kept forever unrenamed —
// only their display `name` changed to line up with the 8 named presets —
// so documents saved before Landing Studio still resolve correctly. Each
// preset is fully customizable afterward (colors, button style, radius,
// shadow, spacing, font, intensity) without ever losing section content —
// applying a preset only ever touches `doc.theme`, never `doc.sections`.
export const THEME_PRESETS: Record<LandingThemeId, LandingTheme> = {
  authority_dark: {
    id: "authority_dark",
    name: "Oscuro Premium",
    primary: "#8b5cf6",
    secondary: "#d946ef",
    background: "#0b0b12",
    surface: "#16161f",
    text: "#f5f5f7",
    muted: "#9d9db0",
    buttonStyle: "gradient",
    radius: "lg",
    shadow: true,
    maxWidth: 1100,
    spacing: "normal",
    font: "display",
    intensity: "bold",
  },
  conversion_light: {
    id: "conversion_light",
    name: "Profesional",
    primary: "#2563eb",
    secondary: "#0891b2",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    muted: "#64748b",
    buttonStyle: "solid",
    radius: "md",
    shadow: false,
    maxWidth: 1040,
    spacing: "normal",
    font: "sans",
    intensity: "balanced",
  },
  bold_brand: {
    id: "bold_brand",
    name: "Energético",
    primary: "#f97316",
    secondary: "#ec4899",
    background: "#fff7ed",
    surface: "#ffffff",
    text: "#1c1917",
    muted: "#78716c",
    buttonStyle: "solid",
    radius: "full",
    shadow: true,
    maxWidth: 1200,
    spacing: "spacious",
    font: "display",
    intensity: "bold",
  },
  moderno: {
    id: "moderno",
    name: "Moderno",
    primary: "#0ea5e9",
    secondary: "#14b8a6",
    background: "#f5f8fb",
    surface: "#ffffff",
    text: "#101828",
    muted: "#5c6b82",
    buttonStyle: "solid",
    radius: "md",
    shadow: true,
    maxWidth: 1120,
    spacing: "normal",
    font: "sans",
    intensity: "balanced",
  },
  minimalista: {
    id: "minimalista",
    name: "Minimalista",
    primary: "#111111",
    secondary: "#555555",
    background: "#fefefe",
    surface: "#f4f4f4",
    text: "#141414",
    muted: "#767676",
    buttonStyle: "outline",
    radius: "none",
    shadow: false,
    maxWidth: 980,
    spacing: "spacious",
    font: "sans",
    intensity: "subtle",
  },
  elegante: {
    id: "elegante",
    name: "Elegante",
    primary: "#9c7a3c",
    secondary: "#4b3f2f",
    background: "#faf7f2",
    surface: "#ffffff",
    text: "#211c15",
    muted: "#7a6f5f",
    buttonStyle: "outline",
    radius: "none",
    shadow: false,
    maxWidth: 1000,
    spacing: "spacious",
    font: "display",
    intensity: "subtle",
  },
  tecnologico: {
    id: "tecnologico",
    name: "Tecnológico",
    primary: "#3b82f6",
    secondary: "#22d3ee",
    background: "#0a0f1e",
    surface: "#131a2e",
    text: "#e8ecf5",
    muted: "#8a94ad",
    buttonStyle: "gradient",
    radius: "lg",
    shadow: true,
    maxWidth: 1120,
    spacing: "normal",
    font: "display",
    intensity: "bold",
  },
  calido: {
    id: "calido",
    name: "Cálido",
    primary: "#c9683f",
    secondary: "#e0a458",
    background: "#fff3e8",
    surface: "#ffffff",
    text: "#3b2a1e",
    muted: "#8a7360",
    buttonStyle: "solid",
    radius: "lg",
    shadow: false,
    maxWidth: 1080,
    spacing: "normal",
    font: "sans",
    intensity: "balanced",
  },
};

export const THEME_LIST = Object.values(THEME_PRESETS);

const RADIUS_PX: Record<LandingTheme["radius"], string> = {
  none: "0px",
  md: "10px",
  lg: "18px",
  full: "999px",
};

const SPACING_PX: Record<LandingTheme["spacing"], string> = {
  compact: "2.5rem",
  normal: "4rem",
  spacious: "6rem",
};

// Drives the preview/export root's CSS custom properties — one source of
// truth for both the in-app live preview and the exported static HTML.
export function themeToCssVars(theme: LandingTheme): Record<string, string> {
  return {
    "--lp-primary": theme.primary,
    "--lp-secondary": theme.secondary,
    "--lp-bg": theme.background,
    "--lp-surface": theme.surface,
    "--lp-text": theme.text,
    "--lp-muted": theme.muted,
    "--lp-radius": RADIUS_PX[theme.radius],
    "--lp-shadow": theme.shadow ? "0 8px 30px rgba(0,0,0,0.12)" : "none",
    "--lp-max-width": `${theme.maxWidth}px`,
    "--lp-spacing": SPACING_PX[theme.spacing],
    "--lp-font": theme.font === "display" ? "'Space Grotesk', system-ui, sans-serif" : "system-ui, sans-serif",
  };
}

export function themeCssVarsInline(theme: LandingTheme): string {
  return Object.entries(themeToCssVars(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export function buttonClassName(theme: LandingTheme): string {
  const radius =
    theme.radius === "none" ? "rounded-none" : theme.radius === "md" ? "rounded-md" : theme.radius === "lg" ? "rounded-xl" : "rounded-full";
  const base = `inline-flex items-center justify-center gap-2 px-6 py-3 font-semibold text-sm transition ${radius}`;
  if (theme.buttonStyle === "outline") {
    return `${base} border-2`;
  }
  return base;
}

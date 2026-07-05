// Server-only configuration for AI tools: model routing + credit costs.
// Never import this from the client — the UI must not know which model
// each tool uses. Update this file to change models without touching UI.

export type ToolId =
  | "copywriter"
  | "social-pack"
  | "business-plan"
  | "consultant"
  | "sales-email"
  | "landing-copy"
  | "email-sequences";

export type Provider = "anthropic" | "openai";

export type ToolConfig = {
  provider: Provider;
  model: string;
  credits: number;
  maxTokens: number;
  planGate?: "pro" | "business"; // minimum plan required
  systemPrompt: string;
};

// Model ids — Anthropic latest Sonnet 4.5, OpenAI gpt-4o.
// The user's spec named "claude-sonnet-4-6" which does not exist; using
// the current Sonnet 4.5 stable id instead.
const CLAUDE = "claude-sonnet-4-5-20250929";
const GPT4O = "gpt-4o";

export const TOOLS: Record<ToolId, ToolConfig> = {
  copywriter: {
    provider: "openai",
    model: GPT4O,
    credits: 1,
    maxTokens: 1200,
    systemPrompt:
      "Eres un copywriter senior especializado en marketing digital hispano. Escribes copy claro, persuasivo y adaptado al tono y formato solicitado. Respondes SOLO con el contenido pedido, sin preámbulos ni explicaciones.",
  },
  "social-pack": {
    provider: "openai",
    model: GPT4O,
    credits: 3,
    maxTokens: 2500,
    systemPrompt:
      "Eres un estratega de contenido social. Generas paquetes multicanal (LinkedIn, X, Instagram, Facebook, YouTube) con la voz correcta para cada plataforma.",
  },
  "business-plan": {
    provider: "anthropic",
    model: CLAUDE,
    credits: 5,
    maxTokens: 8000,
    systemPrompt:
      "Eres un consultor de negocios que redacta business plans profesionales, con foco en LATAM y modelos digitales. Estructura clara, secciones marcadas con ## y tablas cuando aporten.",
  },
  consultant: {
    provider: "anthropic",
    model: CLAUDE,
    credits: 2,
    maxTokens: 4000,
    planGate: "pro",
    systemPrompt:
      "Eres un consultor de negocios élite especializado en startups, marketing digital y monetización con IA. Conoces profundamente el mercado latinoamericano y global. Responde siempre con estrategias concretas y accionables.",
  },
  "sales-email": {
    provider: "openai",
    model: GPT4O,
    credits: 2,
    maxTokens: 2500,
    systemPrompt:
      "Eres un experto en outbound B2B. Escribes secuencias de email frías y de nurture con asuntos altos-CTR y llamados a la acción claros.",
  },
  "landing-copy": {
    provider: "openai",
    model: GPT4O,
    credits: 2,
    maxTokens: 2000,
    systemPrompt:
      "Eres un copywriter de conversión para landing pages SaaS/infoproducto. Devuelves headlines, subheadline, features, social proof, FAQ y CTA en JSON estructurado cuando se pida.",
  },
  "email-sequences": {
    provider: "openai",
    model: GPT4O,
    credits: 3,
    maxTokens: 3500,
    systemPrompt:
      "Eres un email marketer. Diseñas secuencias completas (bienvenida, nurture, carrito, re-engagement, lanzamiento) con asunto, preview y cuerpo por email.",
  },
};

export function getTool(id: string): ToolConfig | null {
  return (TOOLS as Record<string, ToolConfig>)[id] ?? null;
}

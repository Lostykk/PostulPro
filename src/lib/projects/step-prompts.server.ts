import type { ToolId } from "@/lib/ai/tools-config.server";
import type { ProjectBrief } from "@/lib/projects/schema";

// Builds the actual natural-language prompt sent to the model for a given
// project step. Every builder starts from the SAME canonical brief so
// deliverables stay consistent with each other (same audience, same
// value proposition, same tone) — this is what turns seven isolated tool
// calls into one coherent project. Each builder's shape mirrors what the
// corresponding /tools/* page already sends today, just populated from
// the brief + the step's own input instead of a user-filled form.

type StepInput = Record<string, unknown>;

function str(input: StepInput, key: string, fallback = ""): string {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function briefContext(brief: ProjectBrief): string {
  const lines = [
    `Nombre del proyecto: ${brief.name || "no especificado"}`,
    `Descripción: ${brief.description || "no especificada"}`,
    `Problema que resuelve: ${brief.problem || "no especificado"}`,
    `Solución: ${brief.solution || "no especificada"}`,
    `Audiencia: ${brief.audience || "no especificada"}`,
    `Propuesta de valor: ${brief.valueProposition || "no especificada"}`,
    `Oferta: ${brief.offer || "no especificada"}`,
    `Tono: ${brief.tone || "profesional y cercano"}`,
    `CTA principal: ${brief.mainCta || "no especificado"}`,
  ];
  if (brief.constraints.length) lines.push(`Restricciones: ${brief.constraints.join("; ")}`);
  if (brief.knownFacts.length) lines.push(`Hechos confirmados por el usuario: ${brief.knownFacts.join("; ")}`);
  if (brief.assumptions.length) lines.push(`Supuestos (aclaralo si los usás): ${brief.assumptions.join("; ")}`);
  return `## Contexto del proyecto\n${lines.join("\n")}\n\nIMPORTANTE: usá este contexto de forma consistente — no contradigas la audiencia, el tono, la propuesta de valor ni la oferta definidos acá.`;
}

function copywriter(brief: ProjectBrief, input: StepInput): string {
  const format = str(input, "format", "post para redes sociales");
  return `${briefContext(brief)}\n\n## Tarea\nEscribí ${format} sobre: ${brief.name || brief.description}.\n${str(input, "extra") ? `Contexto adicional: ${str(input, "extra")}\n` : ""}Idioma: ${brief.language}.`;
}

function socialPack(brief: ProjectBrief, input: StepInput): string {
  const topic = str(input, "topic", brief.valueProposition || brief.description);
  return `${briefContext(brief)}\n\n## Tarea\nGenerá un pack de contenido multicanal (LinkedIn, X, Instagram, Facebook, YouTube) sobre: ${topic}.\nUsá EXACTAMENTE el formato de bloques ===CANAL=== por cada plataforma.\nIdioma: ${brief.language}.`;
}

function businessPlan(brief: ProjectBrief, input: StepInput): string {
  const country = str(input, "country", "no especificado");
  const revenueStreams = str(input, "revenueStreams", "no especificadas");
  return `Genera un business plan completo y profesional en ${brief.language === "es" ? "español" : brief.language} para la siguiente idea de negocio. Enfoque en LATAM y modelos digitales si aplica.

## Idea
Nombre: ${brief.name}
Descripción: ${brief.description}
Problema: ${brief.problem}
Solución: ${brief.solution}

## Mercado
País: ${country}
Audiencia: ${brief.audience}
Propuesta de valor: ${brief.valueProposition}

## Modelo de negocio
Oferta: ${brief.offer || "no especificada"}
Fuentes de ingreso: ${revenueStreams}

Estructura la respuesta con estas secciones marcadas con "## ":
Resumen Ejecutivo, Análisis de Mercado, Propuesta de Valor, Modelo de Negocio, Plan Financiero (incluye una tabla de proyecciones mes a mes para 12 meses), Marketing y Ventas, Roadmap, Riesgos, KPIs, Próximos 10 Pasos.

IMPORTANTE: cualquier cifra de mercado, proyección financiera o estimación que no venga de los datos provistos debe etiquetarse explícitamente como "Estimación", "Proyección" o "Supuesto" — nunca la presentes como un hecho verificado. No prometas resultados de ventas garantizados.`;
}

function salesEmail(brief: ProjectBrief, input: StepInput): string {
  return `${briefContext(brief)}\n\n## Tarea\nEscribí una secuencia de 5 emails de outbound B2B (+ 1 variante A/B del primero) para vender: ${brief.offer || brief.description}.\nEmpresa/remitente: ${brief.name}.\nUsá EXACTAMENTE el formato de bloques ===TITULO=== por cada email.\nIdioma: ${brief.language}.${str(input, "extra") ? `\nContexto adicional: ${str(input, "extra")}` : ""}`;
}

function landingCopy(brief: ProjectBrief, input: StepInput): string {
  const price = str(input, "price");
  return `${briefContext(brief)}\n\n## Tarea\nGenerá el copy completo de una landing page para: ${brief.name || brief.description}.\nICP (perfil de cliente ideal): ${brief.audience}.\n${price ? `Precio: ${price}.\n` : ""}Devolvé ÚNICAMENTE el JSON pedido (headlines, subheadline, hero, features, social_proof, faq, cta, meta_title, meta_description), sin texto adicional.\nIdioma: ${brief.language}.`;
}

function emailSequences(brief: ProjectBrief, input: StepInput): string {
  const sequenceType = str(input, "sequenceType", "lanzamiento");
  return `${briefContext(brief)}\n\n## Tarea\nDiseñá una secuencia de email marketing de tipo "${sequenceType}" para: ${brief.name || brief.description}.\nUsá EXACTAMENTE el formato de bloques ===TITULO=== por cada email (asunto, preview y cuerpo).\nIdioma: ${brief.language}.`;
}

const BUILDERS: Partial<Record<ToolId, (brief: ProjectBrief, input: StepInput) => string>> = {
  copywriter,
  "social-pack": socialPack,
  "business-plan": businessPlan,
  "sales-email": salesEmail,
  "landing-copy": landingCopy,
  "email-sequences": emailSequences,
};

export function buildStepPrompt(toolKey: string, brief: ProjectBrief, input: StepInput): string {
  const builder = BUILDERS[toolKey as ToolId];
  if (!builder) {
    // Generic fallback — should not happen for allowlisted tools, but
    // keeps this function total instead of throwing mid-execution.
    return `${briefContext(brief)}\n\n## Tarea\n${str(input, "description", brief.description)}`;
  }
  return builder(brief, input);
}

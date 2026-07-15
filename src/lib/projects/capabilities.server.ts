import { TOOLS, type ToolId } from "@/lib/ai/tools-config.server";

// Client-safe capability metadata for the AI Project Builder. This is the
// ONLY thing that ever crosses the server/client boundary about a tool —
// system prompts, models and raw TOOLS entries stay in tools-config.server
// and are never imported from client code.
//
// Every "capability" here maps 1:1 to a real ToolId in tools-config.server
// — nothing is invented. `consultant` is deliberately excluded: it's a
// stateful chat tool, not a single-shot deliverable generator, so it does
// not fit the planner's "step produces one artifact" model.

export type DeliverableType = "text" | "structured_json" | "multi_block";

export type CapabilityMeta = {
  toolKey: ToolId;
  name: string;
  description: string;
  route: string;
  deliverableType: DeliverableType;
  supportsStreaming: boolean;
  planGate?: "pro" | "business";
  credits: number;
};

const CAPABILITY_META: Record<Exclude<ToolId, "consultant">, Omit<CapabilityMeta, "toolKey" | "credits" | "planGate">> = {
  copywriter: {
    name: "Copywriter IA",
    description: "Una pieza de copy puntual: email, post, anuncio o guion.",
    route: "/tools/copywriter",
    deliverableType: "text",
    supportsStreaming: true,
  },
  "social-pack": {
    name: "Social Media Pack",
    description: "Pack de contenido multicanal (LinkedIn, X, Instagram, Facebook, YouTube).",
    route: "/tools/social-pack",
    deliverableType: "multi_block",
    supportsStreaming: true,
  },
  "business-plan": {
    name: "Business Plan IA",
    description: "Plan de negocio estructurado con proyecciones y roadmap.",
    route: "/tools/business-plan",
    deliverableType: "text",
    supportsStreaming: true,
  },
  "sales-email": {
    name: "Sales Email",
    description: "Secuencia de emails de venta outbound.",
    route: "/tools/sales-email",
    deliverableType: "multi_block",
    supportsStreaming: true,
  },
  "landing-copy": {
    name: "Landing Copy",
    description: "Copy estructurado para una landing page (headlines, features, FAQ, CTA).",
    route: "/tools/landing-copy",
    deliverableType: "structured_json",
    supportsStreaming: true,
  },
  "email-sequences": {
    name: "Email Sequences",
    description: "Secuencias de email marketing (bienvenida, nurture, lanzamiento).",
    route: "/tools/email-sequences",
    deliverableType: "multi_block",
    supportsStreaming: true,
  },
};

const PROJECT_TOOL_KEYS = Object.keys(CAPABILITY_META) as Array<keyof typeof CAPABILITY_META>;

// The allowlist the planner is restricted to — a hardcoded array, not
// derived from anything the model can influence.
export const PLANNER_ALLOWLIST: ToolId[] = [...PROJECT_TOOL_KEYS];

export function isProjectCapability(toolKey: string): toolKey is (typeof PROJECT_TOOL_KEYS)[number] {
  return (PROJECT_TOOL_KEYS as string[]).includes(toolKey);
}

// List of capabilities available to a given plan — used both by the
// planner (to know what it may propose) and by the UI (to render "add a
// step" options). Costs are always read fresh from TOOLS, never cached or
// passed through from the client. `isOwnerUser` lifts the plan gate for the
// internal owner/founder entitlement (see lib/auth/is-owner.ts) — it never
// changes `plan` itself, so commercial data stays untouched.
export function listProjectCapabilities(plan: "free" | "pro" | "business", isOwnerUser = false): CapabilityMeta[] {
  const rank: Record<string, number> = { free: 0, pro: 1, business: 2 };
  return PROJECT_TOOL_KEYS.filter((key) => {
    const gate = TOOLS[key].planGate;
    if (!gate || isOwnerUser) return true;
    return (rank[plan] ?? 0) >= (rank[gate] ?? 0);
  }).map((key) => toCapabilityMeta(key));
}

export function getCapabilityMeta(toolKey: string): CapabilityMeta | null {
  if (!isProjectCapability(toolKey)) return null;
  return toCapabilityMeta(toolKey);
}

function toCapabilityMeta(key: (typeof PROJECT_TOOL_KEYS)[number]): CapabilityMeta {
  const cfg = TOOLS[key];
  return {
    toolKey: key,
    ...CAPABILITY_META[key],
    planGate: cfg.planGate,
    credits: cfg.credits,
  };
}

// Server-side recalculation of a deliverable's cost — the planner (LLM)
// output's estimatedCredits is NEVER trusted; this is the only number
// that's ever charged.
export function realCreditsFor(toolKey: string): number {
  if (!isProjectCapability(toolKey)) return 0;
  return TOOLS[toolKey].credits;
}

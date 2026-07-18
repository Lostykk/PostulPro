import { MARKETPLACE_ENABLED } from "@/lib/features";

// Single source of truth for plan pricing/limits/features, shared by the
// public pricing page, the settings billing tab, and the admin MRR calc —
// previously hardcoded independently in all three (same numbers, but no
// shared source, so they could silently drift).
export type PlanKey = "free" | "pro" | "business";

export type Plan = {
  key: PlanKey;
  name: string;
  monthlyPrice: number;
  yearlyMonthlyPrice: number; // per-month price when billed annually
  popular?: boolean;
  cta: string;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyMonthlyPrice: 0,
    cta: "Empezar gratis",
    features: [
      "10 generaciones / mes",
      "3 herramientas básicas",
      ...(MARKETPLACE_ENABLED ? ["Sin acceso al marketplace"] : []),
      "Soporte de la comunidad",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 29,
    yearlyMonthlyPrice: 23,
    popular: true,
    cta: "Comenzar Pro →",
    features: [
      "500 generaciones / mes",
      "8 herramientas premium",
      ...(MARKETPLACE_ENABLED ? ["Marketplace completo"] : []),
      "Export PDF / DOCX",
      "AI Consultor · 100 msgs/mes",
      "Comisión de afiliado 30% recurrente",
      "Soporte por email en 24h",
    ],
  },
  {
    key: "business",
    name: "Business",
    monthlyPrice: 99,
    yearlyMonthlyPrice: 79,
    cta: "Ir a Business →",
    features: [
      "Generaciones ilimitadas",
      "Todo lo de Pro",
      "AI Consultor ilimitado",
      "API personal",
      "Comisión de afiliado 40% recurrente",
      "Soporte prioritario + onboarding",
    ],
  },
];

export function getPlan(key: PlanKey): Plan {
  const plan = PLANS.find((p) => p.key === key);
  if (!plan) throw new Error(`Unknown plan key: ${key}`);
  return plan;
}

export const PAID_PLANS = PLANS.filter((p) => p.key !== "free");

// Billing dropdown options (settings.tsx) derived from the same numbers.
export const PLAN_BILLING_OPTIONS = PAID_PLANS.flatMap((p) => [
  {
    key: `${p.key}_monthly` as const,
    label: `${p.name.toUpperCase()} mensual`,
    price: `$${p.monthlyPrice}/mes`,
  },
  {
    key: `${p.key}_annual` as const,
    label: `${p.name.toUpperCase()} anual`,
    price: `$${p.yearlyMonthlyPrice * 12}/año`,
  },
]);

export function mrrFromPlanCounts(byPlan: Record<string, number>): number {
  return PAID_PLANS.reduce((sum, p) => sum + (byPlan[p.key] ?? 0) * p.monthlyPrice, 0);
}

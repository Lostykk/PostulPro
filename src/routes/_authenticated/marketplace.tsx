import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace — PostulPro" }] }),
  component: () => <ComingSoon title="Marketplace" emoji="🛒" description="Compra y vende templates, prompts y automatizaciones. Se activa en la Fase 4." />,
});

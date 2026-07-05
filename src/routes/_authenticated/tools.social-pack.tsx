import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/social-pack")({
  head: () => ({ meta: [{ title: "Social Pack — PostulPro" }] }),
  component: () => <ComingSoon title="Social Pack" emoji="📱" description="LinkedIn, X, Instagram, Facebook y YouTube en un solo brief. Salida en 5 tabs con calendario semanal." />,
});

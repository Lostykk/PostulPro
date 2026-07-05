import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/business-plan")({
  head: () => ({ meta: [{ title: "Business Plan — PostulPro" }] }),
  component: () => <ComingSoon title="Business Plan IA" emoji="📊" description="Wizard de 5 pasos que genera tu plan de negocios completo con Claude Sonnet 4.5, exportable a PDF y DOCX." />,
});

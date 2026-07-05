import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/sales-email")({
  head: () => ({ meta: [{ title: "Sales Email — PostulPro" }] }),
  component: () => <ComingSoon title="Sales Email" emoji="✉️" description="Secuencias de 5 emails outbound con asunto, preview, cuerpo y CTA. Variables {{nombre}} {{empresa}} y A/B del primero." />,
});

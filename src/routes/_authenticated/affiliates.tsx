import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/affiliates")({
  head: () => ({ meta: [{ title: "Afiliados — PostulPro" }] }),
  component: () => <ComingSoon title="Programa de Afiliados" emoji="🤝" description="30% de comisión recurrente. Dashboard de referidos, links personalizados y payouts." />,
});

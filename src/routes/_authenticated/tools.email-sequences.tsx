import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/email-sequences")({
  head: () => ({ meta: [{ title: "Email Sequences — PostulPro" }] }),
  component: () => <ComingSoon title="Email Sequences" emoji="📬" description="Bienvenida, nurture, carrito abandonado, re-engagement y lanzamiento. Cada email completo listo para importar." />,
});

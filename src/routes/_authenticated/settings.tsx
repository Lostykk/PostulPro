import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configuración — PostulPro" }] }),
  component: () => <ComingSoon title="Configuración" emoji="⚙️" description="Perfil, facturación, upgrade de plan, notificaciones, API keys y equipo." />,
});

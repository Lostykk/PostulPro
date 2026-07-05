import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Biblioteca — PostulPro" }] }),
  component: () => <ComingSoon title="Biblioteca" emoji="📚" description="Todas tus generaciones, organizadas por carpetas, tags y favoritos." />,
});

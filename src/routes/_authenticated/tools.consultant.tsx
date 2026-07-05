import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/consultant")({
  head: () => ({ meta: [{ title: "Consultor IA — PostulPro" }] }),
  component: () => <ComingSoon title="Consultor IA" emoji="🧠" description="Chat estilo Claude con un consultor de negocios élite. Conversaciones guardadas, streaming, markdown y export a PDF." />,
});

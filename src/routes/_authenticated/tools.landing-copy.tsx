import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/ComingSoon";
export const Route = createFileRoute("/_authenticated/tools/landing-copy")({
  head: () => ({ meta: [{ title: "Landing Copy — PostulPro" }] }),
  component: () => <ComingSoon title="Landing Copy" emoji="🎯" description="Headline (3 variantes), subheadline, features, social proof, FAQ y CTA final. Todo editable inline." />,
});

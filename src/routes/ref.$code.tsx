import { createFileRoute, redirect } from "@tanstack/react-router";

// Clean referral URL (postulpro.com/ref/CODE) that redirects to the landing
// page with ?ref=CODE, where captureReferral() picks it up and stores it.
export const Route = createFileRoute("/ref/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/", search: { ref: params.code } });
  },
});

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MARKETPLACE_ENABLED } from "@/lib/features";

// Layout route for /marketplace/* — must render <Outlet /> so child routes
// (marketplace.index.tsx for the listing, marketplace.$productId.tsx for
// product detail, marketplace.sell.tsx) actually mount. Without this, every
// child route silently falls back to rendering nothing of its own.
//
// Fase 2: this beforeLoad is the single gate for the whole /marketplace/*
// subtree — while MARKETPLACE_ENABLED is false, no child route (listing,
// product detail, sell/publish) is reachable even by direct URL.
export const Route = createFileRoute("/_authenticated/marketplace")({
  beforeLoad: () => {
    if (!MARKETPLACE_ENABLED) throw redirect({ to: "/dashboard" });
  },
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /marketplace/* — must render <Outlet /> so child routes
// (marketplace.index.tsx for the listing, marketplace.$productId.tsx for
// product detail, marketplace.sell.tsx) actually mount. Without this, every
// child route silently falls back to rendering nothing of its own.
export const Route = createFileRoute("/_authenticated/marketplace")({
  component: () => <Outlet />,
});

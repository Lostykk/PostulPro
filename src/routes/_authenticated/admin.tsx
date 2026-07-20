import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";

// Layout route for /admin/* — must render <Outlet /> so child routes
// (admin.index.tsx for the dashboard, admin.promotional-credits.tsx for
// the promo-credits panel) actually mount. Without this, every child
// route silently falls back to rendering nothing of its own and the
// parent's own content (if it had any) is all that ever shows — see
// src/routes/_authenticated/marketplace.tsx for the same pattern and its
// own comment about this exact failure mode.
//
// The admin-role gate lives here, once, for the whole /admin/* subtree —
// a child route is never reached by an unauthorized user, so it doesn't
// need to repeat this check itself. This is a UX gate (useProfile, a
// client hook), not the real security boundary — RLS + the has_role()
// check inside every admin-only RPC are what actually enforce this
// server-side; this only avoids flashing admin-only UI at a non-admin.
export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { profile, loading } = useProfile();

  if (!loading && profile && profile.role !== "admin") {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-red-500/10 to-red-500/5 p-10">
          <Lock className="w-10 h-10 mx-auto mb-4 text-red-300" />
          <h1 className="font-display text-2xl font-bold">Acceso restringido</h1>
          <p className="mt-3 text-sm text-muted-foreground">Esta sección es solo para administradores.</p>
          <Link to="/dashboard" className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-lg bg-white/10 font-semibold text-sm hover:bg-white/15 transition">
            Volver al dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (loading || !profile) return <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-muted-foreground">Cargando…</div>;

  return <Outlet />;
}

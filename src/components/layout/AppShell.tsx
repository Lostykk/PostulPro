import { type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Zap,
  ShoppingBag,
  Library,
  Handshake,
  Settings,
  Sparkles,
  LogOut,
  Bell,
  Search,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ProfileProvider, useProfile } from "@/hooks/use-profile";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type NavItem = { to: string; label: string; icon: typeof Home };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/tools", label: "Herramientas", icon: Zap },
  { to: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { to: "/library", label: "Biblioteca", icon: Library },
  { to: "/affiliates", label: "Afiliados", icon: Handshake },
  { to: "/settings", label: "Configuración", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      <ShellInner>{children}</ShellInner>
    </ProfileProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Full-screen routes bypass the shell (onboarding, etc.)
  if (pathname.startsWith("/onboarding")) {
    return <>{children}</>;
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="md:pl-[240px]">
        <TopBar />
        <main className="pb-24 md:pb-8">{children}</main>
      </div>
      <MobileTabs />
    </div>
  );
}

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, loading } = useProfile();
  const percent = profile
    ? Math.min(100, Math.round((profile.credits_used / Math.max(1, profile.credits_limit)) * 100))
    : 0;

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-[240px] flex-col border-r border-white/5 bg-[color:var(--surface-1)]/60 backdrop-blur">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="font-display font-bold">PostulPro</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-4 pt-3 border-t border-white/5 space-y-3">
        {loading || !profile ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Plan</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
                {profile.plan.toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>Créditos</span>
                <span>
                  {profile.credits_used}/{profile.credits_limit}
                </span>
              </div>
              <Progress value={percent} className="h-1.5" />
            </div>
            {profile.plan !== "business" && (
              <Link
                to="/settings"
                className="w-full inline-flex items-center justify-center gap-1 h-8 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition"
              >
                Upgrade <ArrowUpRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = pathname.split("/").filter(Boolean);

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth/login", replace: true });
  }

  const initials = (profile?.name ?? profile?.email ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 h-16 border-b border-white/5 bg-background/80 backdrop-blur">
      <div className="h-full px-4 md:px-6 flex items-center gap-3">
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 opacity-40">/</span>}
              <span className={i === crumbs.length - 1 ? "text-foreground" : ""}>{c}</span>
            </span>
          ))}
        </div>

        <div className="flex-1 max-w-md ml-auto md:ml-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar"
            placeholder="Buscar generaciones, herramientas…"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          />
        </div>

        <button
          type="button"
          aria-label="Notificaciones"
          className="hidden md:grid place-items-center w-9 h-9 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground"
        >
          <Bell className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center text-xs font-semibold text-white">
            {initials}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Cerrar sesión"
            className="hidden md:grid place-items-center w-9 h-9 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function MobileTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 h-16 border-t border-white/5 bg-background/95 backdrop-blur">
      <ul className="h-full grid grid-cols-5">
        {NAV.slice(0, 5).map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={`h-full flex flex-col items-center justify-center gap-1 text-[10px] ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

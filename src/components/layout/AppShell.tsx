import { type ReactNode, type FormEvent, useState } from "react";
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
  ShieldCheck,
  FolderKanban,
  Menu,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ProfileProvider, useProfile } from "@/hooks/use-profile";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

type NavItem = { to: string; label: string; shortLabel: string; icon: typeof Home };

// "Construir" is the flagship entry point for this phase — it leads, both
// in the desktop sidebar and as the 2nd mobile tab. The full list is too
// long for a 6-column bottom bar without shrinking text into
// unreadability, so mobile only shows the 5 most-used items directly and
// tucks the rest behind a "Más" sheet (see MobileTabs) instead of hiding
// them outright.
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", shortLabel: "Inicio", icon: Home },
  { to: "/build", label: "Construir con IA", shortLabel: "Construir", icon: Sparkles },
  { to: "/projects", label: "Mis proyectos", shortLabel: "Proyectos", icon: FolderKanban },
  { to: "/tools", label: "Herramientas", shortLabel: "Tools", icon: Zap },
  { to: "/marketplace", label: "Marketplace", shortLabel: "Market", icon: ShoppingBag },
  { to: "/library", label: "Biblioteca", shortLabel: "Biblio", icon: Library },
  { to: "/affiliates", label: "Afiliados", shortLabel: "Afiliados", icon: Handshake },
  { to: "/settings", label: "Configuración", shortLabel: "Config", icon: Settings },
];

const MOBILE_DIRECT = ["/dashboard", "/build", "/projects", "/marketplace", "/library"];

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
        {profile?.role === "admin" && (
          <Link
            to="/admin"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
              pathname.startsWith("/admin") ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Admin
          </Link>
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
  const [query, setQuery] = useState("");

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth/login", replace: true });
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    navigate({ to: "/library", search: q ? { q } : {} });
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

        <form onSubmit={handleSearch} className="flex-1 max-w-md ml-auto md:ml-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar en tu biblioteca"
            placeholder="Buscar en tu biblioteca…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          />
        </form>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Notificaciones"
              className="hidden md:grid place-items-center w-9 h-9 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground"
            >
              <Bell className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 text-sm">
            <p className="font-medium mb-1">Notificaciones</p>
            <p className="text-muted-foreground text-xs">No tenés notificaciones nuevas por ahora.</p>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menú de cuenta"
              className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center text-xs font-semibold text-white"
            >
              {initials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="truncate">
              {profile?.name ?? profile?.email ?? "Mi cuenta"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="flex items-center gap-2 cursor-pointer">
                <Settings className="w-4 h-4" /> Configuración
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="flex items-center gap-2 cursor-pointer">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function MobileTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const direct = NAV.filter((item) => MOBILE_DIRECT.includes(item.to));
  const overflow = NAV.filter((item) => !MOBILE_DIRECT.includes(item.to));
  const overflowActive = overflow.some((item) => pathname === item.to || pathname.startsWith(item.to + "/"));

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 h-16 border-t border-white/5 bg-background/95 backdrop-blur">
        <ul className="h-full grid grid-cols-6">
          {direct.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`h-full flex flex-col items-center justify-center gap-0.5 text-[9px] leading-tight ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="truncate max-w-full px-0.5">{item.shortLabel}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Más opciones"
              className={`h-full w-full flex flex-col items-center justify-center gap-0.5 text-[9px] leading-tight ${
                overflowActive ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Menu className="w-4 h-4" />
              <span>Más</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetTitle className="sr-only">Más opciones</SheetTitle>
          <div className="grid grid-cols-3 gap-3 pt-2 pb-4">
            {overflow.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border text-xs ${
                    active ? "border-violet-500/50 bg-violet-500/10 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

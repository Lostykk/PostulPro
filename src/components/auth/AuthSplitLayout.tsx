import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, Zap, Users } from "lucide-react";

export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background text-foreground">
      {/* Left panel */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 bg-gradient-to-br from-[#0B0B1A] via-[#1A0B2E] to-[#07070E]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(600px circle at 20% 20%, rgba(139,92,246,0.25), transparent 60%), radial-gradient(500px circle at 80% 70%, rgba(59,130,246,0.2), transparent 60%)",
          }}
        />
        <div className="relative">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">PostulPro</span>
          </Link>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-violet-500/15 border border-violet-500/25 text-violet-300 mb-6">
              <Zap className="w-3 h-3" /> Caso de uso destacado
            </div>
            <h2 className="font-display text-3xl font-bold leading-tight">
              De idea vaga a página de ventas lista en 12 minutos.
            </h2>
            <p className="mt-4 text-muted-foreground max-w-md">
              "Escribí mi primer copy con PostulPro un martes a la noche. Para el viernes ya tenía
              los primeros clientes." — <span className="text-foreground">Ejemplo ilustrativo</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard icon={<Users className="w-4 h-4" />} label="Usuarios registrados" value="—" />
            <StatCard icon={<Sparkles className="w-4 h-4" />} label="Generaciones IA" value="—" />
          </div>
          <p className="text-xs text-muted-foreground/70">
            Las métricas se completan automáticamente cuando la plataforma tenga datos reales.
          </p>
        </div>

        <div className="relative text-xs text-muted-foreground">
          © 2026 PostulPro — Hecho con IA en Argentina 🇦🇷
        </div>
      </aside>

      {/* Right panel */}
      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex justify-center">
            <Link to="/" className="flex items-center gap-2">
              <div className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-display text-xl font-bold">PostulPro</span>
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-2xl font-bold" aria-label={`${label}: ${value}`}>
        {value}
      </div>
    </div>
  );
}

export function GoogleButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full inline-flex items-center justify-center gap-3 h-11 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.7 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.6 5.1C9.5 39.7 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40.1 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z"/>
      </svg>
      {loading ? "Conectando..." : label}
    </button>
  );
}

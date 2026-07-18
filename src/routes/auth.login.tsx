import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { googleOAuthOptions } from "@/lib/auth/google-oauth";
import { friendlyAuthError } from "@/lib/auth/friendly-error";
import { AuthSplitLayout, GoogleButton } from "@/components/auth/AuthSplitLayout";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — PostulPro" },
      { name: "description", content: "Accedé a tu cuenta de PostulPro." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(friendlyAuthError(error.message));
      return;
    }
    toast.success("¡Bienvenido de vuelta!");
    navigate({ to: "/dashboard" });
  }

  async function handleGoogle() {
    if (gLoading) return;
    setGLoading(true);
    const { error } = await supabase.auth.signInWithOAuth(
      googleOAuthOptions(window.location.origin),
    );
    if (error) {
      setGLoading(false);
      toast.error("No pudimos iniciar sesión con Google.");
    }
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Bienvenido de vuelta</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ingresá para seguir generando ingresos con IA.
          </p>
        </div>

        <GoogleButton onClick={handleGoogle} loading={gLoading} label="Continuar con Google" />

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-white/10" />
          o con email
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              placeholder="vos@ejemplo.com"
            />
          </label>
          <label className="block text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Contraseña</span>
              <Link
                to="/auth/reset-password"
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              placeholder="••••••••"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-gradient-brand text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Ingresar
          </button>
        </form>

        <p className="text-sm text-center text-muted-foreground">
          ¿Todavía no tenés cuenta?{" "}
          <Link to="/auth/register" className="text-violet-400 hover:text-violet-300 font-medium">
            Registrate gratis
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}

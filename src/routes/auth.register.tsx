import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { googleOAuthOptions } from "@/lib/auth/google-oauth";
import { AuthSplitLayout, GoogleButton } from "@/components/auth/AuthSplitLayout";
import { getStoredReferral } from "@/lib/referral";

export const Route = createFileRoute("/auth/register")({
  head: () => ({
    meta: [
      { title: "Crear cuenta — PostulPro" },
      { name: "description", content: "Registrate gratis en PostulPro." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Las contraseñas no coinciden.");
    if (password.length < 8) return toast.error("Contraseña mínima de 8 caracteres.");
    if (!terms) return toast.error("Aceptá los términos para continuar.");
    setLoading(true);
    const ref = getStoredReferral();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: ref ? { name, ref } : { name },
        emailRedirectTo: window.location.origin + "/auth/callback",
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("¡Cuenta creada! Vamos a personalizarla.");
    navigate({ to: "/onboarding" });
  }

  async function handleGoogle() {
    if (gLoading) return;
    setGLoading(true);
    const { error } = await supabase.auth.signInWithOAuth(
      googleOAuthOptions(window.location.origin),
    );
    if (error) {
      setGLoading(false);
      toast.error("No pudimos registrarte con Google.");
    }
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Creá tu cuenta</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            10 créditos gratis para empezar hoy mismo.
          </p>
        </div>

        <GoogleButton onClick={handleGoogle} loading={gLoading} label="Registrarme con Google" />

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-white/10" />
          o con email
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Nombre completo"
            type="text"
            value={name}
            onChange={setName}
            placeholder="María Pérez"
            autoComplete="name"
            required
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="vos@ejemplo.com"
            autoComplete="email"
            required
          />
          <Field
            label="Contraseña"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
            required
          />
          <Field
            label="Confirmar contraseña"
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Repetí la contraseña"
            autoComplete="new-password"
            required
          />

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 accent-violet-500"
            />
            <span>
              Acepto los{" "}
              <a
                href="/legal#terminos"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300"
              >
                términos
              </a>{" "}
              y la{" "}
              <a
                href="/legal#privacidad"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300"
              >
                política de privacidad
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-gradient-brand text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Crear cuenta gratis
          </button>
        </form>

        <p className="text-sm text-center text-muted-foreground">
          ¿Ya tenés cuenta?{" "}
          <Link to="/auth/login" className="text-violet-400 hover:text-violet-300 font-medium">
            Iniciá sesión
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
      />
    </label>
  );
}

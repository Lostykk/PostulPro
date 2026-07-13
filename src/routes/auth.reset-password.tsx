import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({
    meta: [
      { title: "Recuperar contraseña — PostulPro" },
      { name: "description", content: "Restablecé tu contraseña de PostulPro." },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // The recovery link Supabase emails redirects back to this same route with
  // a recovery token in the URL. The SDK exchanges it automatically on load
  // and fires PASSWORD_RECOVERY — that's the only signal that this page
  // should show the "set a new password" form instead of the request form.
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/auth/reset-password",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Revisá tu email.");
  }

  async function handleNewPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("Las contraseñas no coinciden.");
    if (newPassword.length < 8) return toast.error("Contraseña mínima de 8 caracteres.");
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contraseña actualizada. ¡Ya podés seguir usando tu cuenta!");
    navigate({ to: "/dashboard" });
  }

  if (recoveryMode) {
    return (
      <AuthSplitLayout>
        <div className="space-y-8">
          <div>
            <h1 className="font-display text-3xl font-bold">Elegí una nueva contraseña</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Creá una contraseña nueva para tu cuenta.
            </p>
          </div>

          <form onSubmit={handleNewPasswordSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium">Nueva contraseña</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                placeholder="Mínimo 8 caracteres"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Confirmar contraseña</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                placeholder="Repetí la contraseña"
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword}
              className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
            >
              {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar contraseña
            </button>
          </form>
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <Link
          to="/auth/login"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a iniciar sesión
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold">Recuperar contraseña</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Te enviamos un link a tu email para crear una nueva contraseña.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4 text-sm">
            Si existe una cuenta con <strong>{email}</strong>, vas a recibir un link en breve.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                placeholder="vos@ejemplo.com"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar link
            </button>
          </form>
        )}
      </div>
    </AuthSplitLayout>
  );
}

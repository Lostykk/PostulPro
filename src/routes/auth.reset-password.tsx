import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
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
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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

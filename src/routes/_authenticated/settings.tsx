import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Copy, Trash2, KeyRound, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { isOwner } from "@/lib/auth/is-owner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configuración — PostulPro" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">⚙️ Configuración</h1>
      </header>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="profile">Mi perfil</TabsTrigger>
          <TabsTrigger value="billing">Plan y billing</TabsTrigger>
          <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
          <TabsTrigger value="api">API keys</TabsTrigger>
          <TabsTrigger value="privacy">Privacidad</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="api">
          <ApiKeysTab />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}

/* ---------- Mi perfil ---------- */

const UNSET_GOAL = "__unset__";

const SETTINGS_GOALS = [
  { id: "passive_income", label: "Ingresos pasivos" },
  { id: "grow_business", label: "Crecer mi negocio" },
  { id: "better_content", label: "Mejor contenido" },
  { id: "launch_startup", label: "Lanzar mi startup" },
  { id: "learn_ai", label: "Aprender IA" },
];

function ProfileTab() {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [revenueGoal, setRevenueGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setBio(profile.bio ?? "");
      setPrimaryGoal(profile.primary_goal ?? "");
      setCompanyName(profile.company_name ?? "");
      setRevenueGoal(profile.revenue_goal_6m ? String(profile.revenue_goal_6m) : "");
    }
  }, [profile]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("users")
      .update({
        name,
        bio,
        primary_goal: primaryGoal || null,
        company_name: companyName || null,
        revenue_goal_6m: revenueGoal ? Number(revenueGoal) : null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil actualizado");
    void refresh();
  }

  async function handleAvatarChange(file: File | null) {
    if (!file || !user) return;
    setAvatarUploading(true);
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) {
      setAvatarUploading(false);
      return toast.error(error.message);
    }
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const { error: updateErr } = await supabase.from("users").update({ avatar_url: url }).eq("id", user.id);
    setAvatarUploading(false);
    if (updateErr) return toast.error(updateErr.message);
    toast.success("Avatar actualizado");
    void refresh();
  }

  async function handlePasswordChange() {
    if (newPassword.length < 8) return toast.error("Mínimo 8 caracteres");
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) return toast.error(error.message);
    setNewPassword("");
    toast.success("Contraseña actualizada");
  }

  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-brand grid place-items-center text-white font-semibold overflow-hidden">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : (profile?.name?.[0] ?? "?")}
        </div>
        <label className="text-xs text-violet-300 hover:text-violet-200 cursor-pointer">
          {avatarUploading ? "Subiendo…" : "Cambiar avatar"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarChange(e.target.files?.[0] ?? null)} disabled={avatarUploading} />
        </label>
      </div>
      <Field label="Nombre">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Bio">
        <textarea className="input min-h-[80px] resize-y" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Email">
        <input className="input opacity-60" value={profile?.email ?? ""} disabled />
      </Field>

      <div className="pt-4 border-t border-white/5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contexto para Construir con IA
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Objetivo principal">
            <SimpleSelect
              value={primaryGoal || UNSET_GOAL}
              onValueChange={(v) => setPrimaryGoal(v === UNSET_GOAL ? "" : v)}
              options={[
                { value: UNSET_GOAL, label: "Sin definir" },
                ...SETTINGS_GOALS.map((g) => ({ value: g.id, label: g.label })),
              ]}
            />
          </Field>
          <Field label="Empresa o proyecto (opcional)">
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Mi Startup" />
          </Field>
          <Field label="Meta a 6 meses en USD (opcional)">
            <input className="input" type="number" min={0} value={revenueGoal} onChange={(e) => setRevenueGoal(e.target.value)} placeholder="Ej: 2000" />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Este contexto solo se usa para personalizar el tono de tus proyectos — nunca es una promesa de resultado.
        </p>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar cambios
      </button>

      <div className="pt-4 border-t border-white/5 space-y-3">
        <Field label="Nueva contraseña">
          <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
        </Field>
        <button
          type="button"
          onClick={handlePasswordChange}
          disabled={changingPassword || !newPassword}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-40"
        >
          {changingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Cambiar contraseña
        </button>
      </div>
    </Card>
  );
}

/* ---------- Plan y billing ---------- */

const PLAN_OPTIONS = [
  { key: "pro_monthly", label: "PRO mensual", price: "$29/mes" },
  { key: "pro_annual", label: "PRO anual", price: "$276/año" },
  { key: "business_monthly", label: "BUSINESS mensual", price: "$99/mes" },
  { key: "business_annual", label: "BUSINESS anual", price: "$948/año" },
] as const;

type SubscriptionRow = {
  status: string;
  cancelled: boolean;
  renews_at: string | null;
  ends_at: string | null;
  billing_interval: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  on_trial: "En prueba",
  paused: "Pausada",
  past_due: "Pago pendiente",
  unpaid: "Impaga",
  cancelled: "Cancelada",
  expired: "Vencida",
  refunded: "Reembolsada",
};

type BillingHistoryRow = { id: string; event_type: string; reason: string | null; created_at: string };

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" });
}

function BillingTab() {
  const { profile } = useProfile();
  const [loading, setLoading] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [history, setHistory] = useState<BillingHistoryRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from("subscriptions")
      .select("status,cancelled,renews_at,ends_at,billing_interval")
      .eq("user_id", profile.id)
      .not("status", "in", "(expired,refunded)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setSub((data as SubscriptionRow | null) ?? null);
        setSubLoading(false);
      });
    supabase
      .from("billing_history")
      .select("id,event_type,reason,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory((data as BillingHistoryRow[] | null) ?? []));
  }, [profile]);

  async function callCheckout(kind: "subscription" | "credits", priceKey: string) {
    setLoading(priceKey);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, priceKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo iniciar el checkout");
      window.location.href = body.url!;
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handleManageBilling() {
    setLoading("portal");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo abrir el portal de facturación");
      window.location.href = body.url!;
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const hasActiveSub = !subLoading && sub !== null;

  return (
    <Card>
      <div>
        <div className="text-xs text-muted-foreground">Plan actual</div>
        <div className="font-display text-2xl font-bold mt-1">{profile?.plan.toUpperCase() ?? "—"}</div>
      </div>
      <div className="text-sm text-muted-foreground">
        Créditos: {profile?.credits_used ?? 0} / {profile?.credits_limit ?? 0}
      </div>

      {sub && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Estado:</span>
            <span className="font-medium">{STATUS_LABEL[sub.status] ?? sub.status}</span>
          </div>
          {sub.cancelled && sub.ends_at ? (
            <p className="text-xs text-amber-300">Cancelada — tenés acceso hasta el {formatDate(sub.ends_at)}.</p>
          ) : sub.renews_at ? (
            <p className="text-xs text-muted-foreground">Próxima renovación: {formatDate(sub.renews_at)}</p>
          ) : null}
        </div>
      )}

      <div>
        <div className="text-xs text-muted-foreground mb-2">Cambiar de plan</div>
        {hasActiveSub && (
          <p className="text-xs text-muted-foreground mb-2">
            Ya tenés una suscripción activa — usá &quot;Gestionar suscripción&quot; para cambiar de plan.
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          {PLAN_OPTIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => callCheckout("subscription", p.key)}
              disabled={loading !== null || hasActiveSub}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 h-11 text-sm hover:border-violet-500/40 transition disabled:opacity-50"
            >
              <span>{p.label}</span>
              <span className="text-muted-foreground text-xs">{p.price}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={() => callCheckout("credits", "credits_100")}
          disabled={loading !== null}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {loading === "credits_100" && <Loader2 className="w-4 h-4 animate-spin" />} Comprar 100 créditos — $9
        </button>
        {hasActiveSub && (
          <button
            type="button"
            onClick={handleManageBilling}
            disabled={loading !== null}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-60"
          >
            {loading === "portal" && <Loader2 className="w-4 h-4 animate-spin" />} Gestionar suscripción
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-xs text-muted-foreground mb-2">Historial de billing</div>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="text-xs text-muted-foreground">
                <span className="text-foreground">{formatDate(h.created_at)}</span> — {h.reason ?? h.event_type}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ---------- Notificaciones ---------- */

function NotificationsTab() {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setEmailNotif(profile.notify_email);
      setPushNotif(profile.notify_push);
    }
  }, [profile]);

  async function togglePush(value: boolean) {
    if (value && typeof Notification !== "undefined") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Necesitás autorizar notificaciones en el navegador");
        return;
      }
    }
    setPushNotif(value);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("users").update({ notify_email: emailNotif, notify_push: pushNotif }).eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Preferencias guardadas");
    void refresh();
  }

  return (
    <Card>
      <ToggleRow label="Notificaciones por email" checked={emailNotif} onChange={setEmailNotif} />
      <ToggleRow label="Notificaciones push (navegador)" checked={pushNotif} onChange={togglePush} />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
      </button>
    </Card>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 accent-violet-500" />
    </label>
  );
}

/* ---------- API keys ---------- */

type ApiKey = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

function ApiKeysTab() {
  const { profile, loading } = useProfile();

  if (!loading && profile && profile.plan !== "business" && !isOwner(profile)) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Las API keys son exclusivas del plan BUSINESS.</p>
      </Card>
    );
  }
  return <ApiKeysManager />;
}

function ApiKeysManager() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  useEffect(() => {
    if (user) void load();
  }, [user]);

  async function load() {
    const { data } = await supabase
      .from("api_keys")
      .select("id,name,key_prefix,created_at,last_used_at,revoked_at")
      .order("created_at", { ascending: false });
    setKeys(data ?? []);
  }

  async function handleCreate() {
    if (!name.trim()) return toast.error("Ponele un nombre a la key");
    setCreating(true);
    const { data, error } = await supabase.rpc("generate_api_key", { p_name: name.trim() });
    setCreating(false);
    if (error) return toast.error(error.message);
    const row = data?.[0];
    if (row) {
      setJustCreated(row.plaintext_key);
      setName("");
      void load();
    }
  }

  async function revoke(id: string) {
    const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  return (
    <Card>
      {justCreated && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-2">
          <p className="text-emerald-300 font-semibold">Copiá tu key ahora — no se va a volver a mostrar.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-[11px] bg-black/30 px-2 py-1 rounded">{justCreated}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(justCreated);
                toast.success("Copiada");
              }}
              className="p-1.5 rounded-md hover:bg-white/10"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la key (ej: Producción)" />
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60 shrink-0"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Crear
        </button>
      </div>

      {keys === null ? (
        <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no creaste ninguna API key.</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded-lg border border-white/10 p-3 text-sm">
              <div>
                <div className="font-medium">{k.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</div>
                <div className="text-[11px] text-muted-foreground">
                  Creada {new Date(k.created_at).toLocaleDateString()} · {k.last_used_at ? `usada ${new Date(k.last_used_at).toLocaleDateString()}` : "nunca usada"}
                </div>
              </div>
              {k.revoked_at ? (
                <span className="text-xs text-muted-foreground">Revocada</span>
              ) : (
                <button type="button" onClick={() => revoke(k.id)} className="text-xs text-red-300 hover:text-red-200">
                  Revocar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Privacidad ---------- */

function PrivacyTab() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleExport() {
    if (!user) return;
    setExporting(true);
    try {
      const [{ data: profile }, { data: generations }, { data: purchases }, { data: referrals }] = await Promise.all([
        supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("generations").select("*").eq("user_id", user.id),
        supabase.from("purchases").select("*").eq("user_id", user.id),
        supabase.from("affiliate_referrals").select("*").eq("referrer_id", user.id),
      ]);
      const blob = new Blob([JSON.stringify({ profile, generations, purchases, referrals }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "postulpro-mis-datos.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/delete-account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "No se pudo eliminar la cuenta");
      await signOut();
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <div>
        <h3 className="font-semibold text-sm mb-1">Exportar mis datos</h3>
        <p className="text-xs text-muted-foreground mb-3">Descargá una copia de tu perfil, generaciones, compras y referidos en JSON.</p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 transition disabled:opacity-60"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exportar
        </button>
      </div>

      <div className="pt-4 border-t border-white/5">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-1.5 text-red-300">
          <AlertTriangle className="w-4 h-4" /> Eliminar cuenta
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Esto elimina tu cuenta y todos tus datos (generaciones, compras, referidos, archivos) de forma permanente.
        </p>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition"
        >
          <Trash2 className="w-4 h-4" /> Eliminar mi cuenta
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tu cuenta definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán tu perfil, generaciones, compras, productos publicados,
              referidos y archivos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAccount} disabled={deleting} className="bg-red-500 hover:bg-red-600">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sí, eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

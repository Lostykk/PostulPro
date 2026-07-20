import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Lock, ArrowLeft, Gift, Search, History, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
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

export const Route = createFileRoute("/_authenticated/admin/promotional-credits")({
  head: () => ({ meta: [{ title: "Créditos promocionales — Admin — PostulPro" }] }),
  component: PromotionalCreditsPage,
});

type Campaign = {
  id: string;
  internal_name: string;
  public_name: string;
  description: string | null;
  status: string;
  credits_per_user: number;
  maximum_recipients: number;
  grants_count: number;
  starts_at: string | null;
  ends_at: string | null;
  coupon_code: string | null;
};

type SearchUser = {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  credits_used: number;
  credits_limit: number;
  bonus_credits: number;
};

type GrantRow = {
  id: string;
  user_id: string;
  credits_granted: number;
  reason: string | null;
  status: string;
  granted_at: string;
  hotmart_reference: string | null;
  idempotency_key: string;
  credits_reverted: number | null;
  user: { name: string | null; email: string } | null;
  granted_by_user: { name: string | null; email: string } | null;
};

function PromotionalCreditsPage() {
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

  return <PromotionalCreditsDashboard />;
}

function PromotionalCreditsDashboard() {
  const [campaign, setCampaign] = useState<Campaign | null | undefined>(undefined);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [reason, setReason] = useState("");
  const [hotmartReference, setHotmartReference] = useState("");
  const [confirmGrantOpen, setConfirmGrantOpen] = useState(false);
  const [granting, setGranting] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [forcePartialRevoke, setForcePartialRevoke] = useState(false);

  useEffect(() => {
    void loadCampaign();
  }, []);

  async function loadCampaign() {
    const { data } = await supabase
      .from("promotional_credit_campaigns")
      .select("id,internal_name,public_name,description,status,credits_per_user,maximum_recipients,grants_count,starts_at,ends_at,coupon_code")
      .eq("internal_name", "postulpro_launch_2026")
      .maybeSingle();
    setCampaign(data ?? null);
    if (data) void loadGrants(data.id);
  }

  async function loadGrants(campaignId: string) {
    const { data } = await supabase
      .from("promotional_credit_grants")
      .select(
        "id,user_id,credits_granted,reason,status,granted_at,hotmart_reference,idempotency_key,credits_reverted,user:user_id(name,email),granted_by_user:granted_by(name,email)",
      )
      .eq("campaign_id", campaignId)
      .order("granted_at", { ascending: false });
    setGrants((data as unknown as GrantRow[] | null) ?? []);
  }

  async function runSearch(q: string) {
    setSearch(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    const { data } = await supabase
      .from("users")
      .select("id,name,email,plan,credits_used,credits_limit,bonus_credits")
      .or(`email.ilike.%${q}%,name.ilike.%${q}%,id.eq.${/^[0-9a-f-]{36}$/i.test(q) ? q : "00000000-0000-0000-0000-000000000000"}`)
      .limit(10);
    setSearchResults(data ?? []);
  }

  const existingGrantForSelected = useMemo(
    () => (selectedUser ? grants.find((g) => g.user_id === selectedUser.id) : undefined),
    [selectedUser, grants],
  );

  async function confirmGrant() {
    if (!campaign || !selectedUser) return;
    setGranting(true);
    const { data, error } = await supabase.rpc("admin_grant_promotional_credits", {
      p_campaign_id: campaign.id,
      p_target_user_id: selectedUser.id,
      p_reason: reason.trim() || undefined,
      p_hotmart_reference: hotmartReference.trim() || undefined,
    });
    setGranting(false);
    setConfirmGrantOpen(false);
    if (error) return toast.error(error.message);
    const result = data?.[0];
    if (!result?.ok) return toast.error(result?.message ?? "No se pudo otorgar el bono");
    if (result.message?.startsWith("already granted")) {
      toast.info("Este usuario ya había recibido el bono de esta campaña — no se otorgó de nuevo.");
    } else {
      toast.success(`${campaign.credits_per_user} créditos promocionales otorgados a ${selectedUser.email}`);
    }
    setSelectedUser(null);
    setReason("");
    setHotmartReference("");
    setSearch("");
    setSearchResults([]);
    await loadCampaign();
  }

  async function toggleStatus(newStatus: string) {
    if (!campaign) return;
    setTogglingStatus(true);
    const { error } = await supabase.rpc("admin_set_promotional_campaign_status", {
      p_campaign_id: campaign.id,
      p_new_status: newStatus,
    });
    setTogglingStatus(false);
    if (error) return toast.error(error.message);
    toast.success(`Campaña ${newStatus === "active" ? "activada" : newStatus === "paused" ? "pausada" : newStatus === "closed" ? "cerrada" : "actualizada"}`);
    await loadCampaign();
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    const { data, error } = await supabase.rpc("admin_revoke_promotional_credit_grant", {
      p_grant_id: revokeTarget.id,
      p_reason: revokeReason.trim(),
      p_confirm_partial_consumption: forcePartialRevoke,
    });
    setRevoking(false);
    if (error) return toast.error(error.message);
    const result = data?.[0];
    if (!result?.ok) {
      if (result?.was_partially_consumed && !forcePartialRevoke) {
        // Distinct guard: needs a second, explicit confirmation before
        // touching credits beyond what the bonus pool still covers.
        toast.warning(result.message ?? "Parte del bono ya fue consumido — confirmá para revertir solo lo recuperable.");
        setForcePartialRevoke(true);
        return;
      }
      return toast.error(result?.message ?? "No se pudo revertir el bono");
    }
    toast.success(
      result.was_partially_consumed
        ? `Se revirtieron ${result.credits_reverted} créditos (parte ya estaba consumida)`
        : `Se revirtieron ${result.credits_reverted} créditos`,
    );
    setRevokeTarget(null);
    setRevokeReason("");
    setForcePartialRevoke(false);
    if (campaign) await loadGrants(campaign.id);
  }

  if (campaign === undefined) {
    return <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-muted-foreground">Cargando…</div>;
  }
  if (campaign === null) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-muted-foreground">
        No se encontró la campaña <code>postulpro_launch_2026</code>. Verificá que la migración de semilla se haya aplicado.
      </div>
    );
  }

  const maxCommitted = campaign.credits_per_user * campaign.maximum_recipients;
  const delivered = campaign.grants_count * campaign.credits_per_user;
  const remainingSlots = campaign.maximum_recipients - campaign.grants_count;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <header className="flex items-center gap-3">
        <Link to="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Gift className="w-7 h-7" /> Créditos promocionales
        </h1>
      </header>

      {/* Resumen de campaña */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">{campaign.public_name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{campaign.internal_name}</p>
          </div>
          <StatusBadge status={campaign.status} />
        </div>
        {campaign.description && <p className="text-sm text-muted-foreground">{campaign.description}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Metric label="Cupón" value={campaign.coupon_code ?? "—"} />
          <Metric label="Créditos por usuario" value={String(campaign.credits_per_user)} />
          <Metric label="Usuarios beneficiados" value={`${campaign.grants_count} / ${campaign.maximum_recipients}`} />
          <Metric label="Cupos restantes" value={String(remainingSlots)} />
          <Metric label="Total entregado" value={`${delivered} créditos`} />
          <Metric label="Compromiso máximo" value={`${maxCommitted} créditos`} />
          <Metric label="Inicio" value={campaign.starts_at ? new Date(campaign.starts_at).toLocaleDateString() : "sin definir"} />
          <Metric label="Cierre" value={campaign.ends_at ? new Date(campaign.ends_at).toLocaleDateString() : "sin definir"} />
        </div>
        <div className="flex gap-2 pt-2">
          {campaign.status !== "active" && (
            <button
              type="button"
              disabled={togglingStatus}
              onClick={() => toggleStatus("active")}
              className="h-9 px-4 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 transition disabled:opacity-50"
            >
              Activar campaña
            </button>
          )}
          {campaign.status === "active" && (
            <button
              type="button"
              disabled={togglingStatus}
              onClick={() => toggleStatus("paused")}
              className="h-9 px-4 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition disabled:opacity-50"
            >
              Pausar campaña
            </button>
          )}
          {campaign.status !== "closed" && (
            <button
              type="button"
              disabled={togglingStatus}
              onClick={() => toggleStatus("closed")}
              className="h-9 px-4 rounded-lg bg-red-500/20 text-red-300 text-xs font-semibold hover:bg-red-500/30 transition disabled:opacity-50"
            >
              Cerrar campaña definitivamente
            </button>
          )}
        </div>
      </section>

      {/* Control de costos */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-2">
        <h2 className="font-display font-bold flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4" /> Control de costos
        </h2>
        <p className="text-sm text-muted-foreground">
          Exposición máxima de esta campaña: <strong className="text-foreground">{maxCommitted} créditos</strong> ({campaign.maximum_recipients} usuarios ×{" "}
          {campaign.credits_per_user} créditos). Entregado hasta ahora: <strong className="text-foreground">{delivered}</strong> créditos a{" "}
          <strong className="text-foreground">{campaign.grants_count}</strong> usuarios.
        </p>
        <p className="text-xs text-muted-foreground">
          El sistema de créditos actual usa un balance único por usuario (no rastrea por lote), así que no es posible medir cuánto de los créditos
          promocionales específicamente ya se consumió — solo cuánto se otorgó. No existe generador de video todavía, y su costo en créditos deberá
          definirse según su costo real cuando exista, para que 10 créditos promocionales no habiliten una cantidad ilimitada de generaciones costosas.
        </p>
      </section>

      {/* Buscador + formulario de asignación */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="font-display font-bold flex items-center gap-2">
          <Search className="w-4 h-4" /> Otorgar créditos promocionales
        </h2>
        <input
          className="input h-10 text-sm w-full"
          value={search}
          onChange={(e) => void runSearch(e.target.value)}
          placeholder="Buscar por email, nombre o UUID…"
        />
        {searchResults.length > 0 && (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10 overflow-hidden">
            {searchResults.map((u) => (
              <li
                key={u.id}
                className="p-3 text-sm hover:bg-white/5 cursor-pointer flex items-center justify-between"
                onClick={() => setSelectedUser(u)}
              >
                <div>
                  <div>{u.name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </div>
                <span className="text-xs uppercase text-muted-foreground">{u.plan}</span>
              </li>
            ))}
          </ul>
        )}

        {selectedUser && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{selectedUser.name || "—"}</div>
                <div className="text-xs text-muted-foreground">{selectedUser.email}</div>
              </div>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedUser(null)}>
                Cambiar usuario
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span>Plan: <span className="text-foreground uppercase">{selectedUser.plan}</span></span>
              <span>Balance: <span className="text-foreground">{selectedUser.credits_used}/{selectedUser.credits_limit}</span></span>
              <span>Bono actual: <span className="text-foreground">{selectedUser.bonus_credits}</span></span>
            </div>

            {existingGrantForSelected && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">
                Este usuario ya tiene un registro para esta campaña (estado: {existingGrantForSelected.status}). Otorgar de nuevo será rechazado
                automáticamente como duplicado — el sistema nunca entrega el bono dos veces.
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Motivo (opcional)</label>
              <input className="input h-9 text-sm w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: comprador cupón POSTULPRO30" />
              <label className="text-xs text-muted-foreground">Referencia Hotmart (opcional)</label>
              <input
                className="input h-9 text-sm w-full"
                value={hotmartReference}
                onChange={(e) => setHotmartReference(e.target.value)}
                placeholder="Ej: número de transacción o email de compra"
              />
            </div>

            <button
              type="button"
              disabled={campaign.status !== "active" || Boolean(existingGrantForSelected)}
              onClick={() => setConfirmGrantOpen(true)}
              className="w-full h-10 rounded-lg bg-gradient-brand text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Otorgar créditos promocionales
            </button>
            {campaign.status !== "active" && <p className="text-xs text-red-300">La campaña no está activa — activala arriba antes de otorgar créditos.</p>}
          </div>
        )}
      </section>

      {/* Historial */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
        <h2 className="font-display font-bold flex items-center gap-2">
          <History className="w-4 h-4" /> Historial
        </h2>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se otorgó ningún crédito promocional.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left border-b border-white/5">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Cantidad</th>
                  <th className="px-3 py-2">Admin</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Clave</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(g.granted_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div>{g.user?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{g.user?.email}</div>
                    </td>
                    <td className="px-3 py-2">{g.credits_granted}{g.credits_reverted != null ? ` (−${g.credits_reverted} revertido)` : ""}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.granted_by_user?.email ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.reason || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={g.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{g.idempotency_key.slice(0, 14)}…</td>
                    <td className="px-3 py-2">
                      {g.status === "active" && (
                        <button
                          type="button"
                          className="text-xs text-red-300 hover:text-red-200"
                          onClick={() => {
                            setRevokeTarget(g);
                            setRevokeReason("");
                            setForcePartialRevoke(false);
                          }}
                        >
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirmación de otorgamiento */}
      <AlertDialog open={confirmGrantOpen} onOpenChange={setConfirmGrantOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar entrega de créditos</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción agregará {campaign.credits_per_user} créditos promocionales una sola vez al usuario seleccionado
              {selectedUser ? ` (${selectedUser.email})` : ""}. No se puede deshacer automáticamente — solo revertirse manualmente después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={granting} onClick={() => void confirmGrant()}>
              {granting ? "Otorgando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación de reversión */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revertir créditos promocionales</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a revertir {revokeTarget?.credits_granted} créditos otorgados a {revokeTarget?.user?.email}. Esto crea un asiento compensatorio y
              nunca borra el registro original.
              {forcePartialRevoke && (
                <span className="block mt-2 text-amber-300">
                  Parte de este bono ya no está disponible en el pool (fue consumido o reducido de otra forma) — al confirmar, se revierte solo lo
                  recuperable.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <label className="text-xs text-muted-foreground">Motivo (obligatorio)</label>
            <input className="input h-9 text-sm w-full mt-1" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Ej: se otorgó al usuario equivocado" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setForcePartialRevoke(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={revoking || !revokeReason.trim()} onClick={() => void confirmRevoke()}>
              {revoking ? "Revirtiendo…" : forcePartialRevoke ? "Confirmar de todas formas" : "Revertir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-white/10 text-muted-foreground",
    active: "bg-emerald-500/20 text-emerald-300",
    paused: "bg-amber-500/20 text-amber-300",
    closed: "bg-white/10 text-muted-foreground",
    revoked: "bg-red-500/20 text-red-300",
    fully_consumed: "bg-white/10 text-muted-foreground",
    expired: "bg-white/10 text-muted-foreground",
    reversed: "bg-red-500/20 text-red-300",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase ${styles[status] ?? "bg-white/10 text-muted-foreground"}`}>{status}</span>;
}

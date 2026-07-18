import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Lock, DollarSign, Users, MousePointerClick, TrendingUp, Clock } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/affiliates")({
  head: () => ({ meta: [{ title: "Afiliados — PostulPro" }] }),
  component: AffiliatesPage,
});

type Referral = {
  id: string;
  status: string;
  commission_rate: number | null;
  commission_amount: number | null;
  created_at: string;
  referred: { name: string | null; email: string; plan: string } | null;
};

const MATERIALS = [
  { title: "Kit de marca", desc: "Logos, colores y banners listos para usar." },
  { title: "Emails de invitación", desc: "3 emails para invitar a tu audiencia." },
  { title: "Scripts para Reels/TikTok", desc: "Guiones cortos para video." },
  { title: "Templates para Stories", desc: "Diseños para Instagram/WhatsApp Status." },
];

function AffiliatesPage() {
  const { profile, loading } = useProfile();

  if (!loading && profile && profile.plan === "free") {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-10">
          <Lock className="w-10 h-10 mx-auto mb-4 text-violet-300" />
          <h1 className="font-display text-2xl font-bold">Afiliados es para planes PRO y BUSINESS</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Actualizá tu plan para empezar a ganar comisión recurrente compartiendo PostulPro.
          </p>
          <Link to="/settings" className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-lg bg-gradient-brand text-white font-semibold text-sm hover:opacity-95 transition">
            Ver planes
          </Link>
        </div>
      </div>
    );
  }

  return <AffiliatesDashboard />;
}

function AffiliatesDashboard() {
  const { profile } = useProfile();
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [clicks, setClicks] = useState<number>(0);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const link = profile ? `${typeof window !== "undefined" ? window.location.origin : "https://postulpro.com"}/ref/${profile.affiliate_code}` : "";

  useEffect(() => {
    if (!profile) return;
    void load();
    if (link) QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setQrUrl).catch(() => setQrUrl(null));
  }, [profile]);

  async function load() {
    if (!profile) return;
    const { data: refs } = await supabase
      .from("affiliate_referrals")
      .select("id,status,commission_rate,commission_amount,created_at,referred:referred_user_id(name,email,plan)")
      .eq("referrer_id", profile.id)
      .order("created_at", { ascending: false });
    setReferrals((refs as unknown as Referral[] | null) ?? []);

    if (profile.affiliate_code) {
      const { count } = await supabase
        .from("affiliate_clicks")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_code", profile.affiliate_code);
      setClicks(count ?? 0);
    }
  }

  const stats = useMemo(() => {
    if (!referrals) return null;
    const totalCommission = referrals.reduce((a, r) => a + (r.commission_amount ?? 0), 0);
    const activeReferrals = referrals.length;
    const conversionRate = clicks > 0 ? ((activeReferrals / clicks) * 100).toFixed(1) : "0.0";
    return { totalCommission, activeReferrals, conversionRate };
  }, [referrals, clicks]);

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }
  function handleDownloadQr() {
    if (!qrUrl) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = "postulpro-referral-qr.png";
    a.click();
  }

  const commissionRate = profile?.plan === "business" ? 40 : 30;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 p-8 text-center">
        <h1 className="font-display text-3xl font-bold">Gana mientras duermes. Comparte PostulPro.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ganás {commissionRate}% de comisión recurrente por cada persona que se suscriba con tu link.
        </p>
      </header>

      {stats === null ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard icon={<DollarSign className="w-4 h-4" />} label="Comisión acumulada" value={`$${stats.totalCommission.toFixed(2)}`} />
          <StatCard icon={<Users className="w-4 h-4" />} label="Referidos activos" value={String(stats.activeReferrals)} />
          <StatCard icon={<MousePointerClick className="w-4 h-4" />} label="Clics" value={String(clicks)} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Conversion rate" value={`${stats.conversionRate}%`} />
          <StatCard icon={<Clock className="w-4 h-4" />} label="Próximo pago" value="Sin pagos programados" small />
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_240px] gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-muted-foreground mb-2">Tu link de referido</div>
          <div className="flex items-center gap-2">
            <input readOnly value={link} className="input flex-1 text-xs" />
            <button
              type="button"
              onClick={handleCopy}
              className="h-9 px-3 rounded-lg text-xs font-semibold bg-gradient-brand text-white hover:opacity-90 transition inline-flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col items-center gap-2">
          {qrUrl ? <img src={qrUrl} alt="QR" className="w-32 h-32 rounded-lg" /> : <div className="w-32 h-32 rounded-lg bg-white/10 animate-pulse" />}
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!qrUrl}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Descargar QR
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-display font-bold text-xl mb-3">Historial de referidos</h2>
        {referrals === null ? (
          <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
        ) : referrals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">
            Todavía no tenés referidos. Compartí tu link para empezar.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left border-b border-white/5">
                  <th className="px-4 py-3">Referido</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Comisión</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">{r.referred?.name || r.referred?.email || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 uppercase text-xs">{r.referred?.plan ?? "—"}</td>
                    <td className="px-4 py-3">${(r.commission_amount ?? 0).toFixed(2)} ({r.commission_rate ?? 0}%)</td>
                    <td className="px-4 py-3">
                      <span className={r.status === "paid" ? "text-emerald-300" : "text-amber-300"}>
                        {r.status === "paid" ? "Pagado" : "Pendiente"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="font-display font-bold text-xl mb-3">Materiales para compartir</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MATERIALS.map((m) => (
            <div key={m.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="font-semibold text-sm">{m.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{m.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, small }: { icon: React.ReactNode; label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 font-display font-bold ${small ? "text-xs" : "text-xl"}`}>{value}</div>
    </div>
  );
}

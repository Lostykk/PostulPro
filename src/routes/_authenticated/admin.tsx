import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Lock, Users, DollarSign, TrendingUp, Zap, ShoppingBag, Search } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — PostulPro" }] }),
  component: AdminPage,
});

type AdminUser = { id: string; name: string | null; email: string; plan: string; role: string; created_at: string };
type AdminProduct = { id: string; title: string; seller_id: string; is_published: boolean; total_sales: number };
type AdminGeneration = { id: string; user_id: string; tool: string; title: string | null; created_at: string };
type AffiliateRank = { referrer_id: string; name: string | null; email: string; total: number; count: number };

function AdminPage() {
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

  return <AdminDashboard />;
}

function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [generations, setGenerations] = useState<AdminGeneration[] | null>(null);
  const [affiliateRanking, setAffiliateRanking] = useState<AffiliateRank[]>([]);
  const [search, setSearch] = useState("");
  const [marketplaceRevenue, setMarketplaceRevenue] = useState<number | null>(null);
  const [churn, setChurn] = useState<{ rate: number; hasData: boolean } | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const [{ data: u }, { data: p }, { data: g }, { data: refs }, { data: purchases }, { data: subs }] = await Promise.all([
      supabase.from("users").select("id,name,email,plan,role,created_at").order("created_at", { ascending: false }),
      supabase.from("products").select("id,title,seller_id,is_published,total_sales"),
      supabase.from("generations").select("id,user_id,tool,title,created_at").order("created_at", { ascending: false }).limit(50),
      supabase
        .from("affiliate_referrals")
        .select("referrer_id,commission_amount,referrer:referrer_id(name,email)"),
      supabase.from("purchases").select("amount"),
      supabase.from("subscriptions").select("status"),
    ]);
    setUsers(u ?? []);
    setProducts(p ?? []);
    setGenerations(g ?? []);
    setMarketplaceRevenue((purchases ?? []).reduce((a, p2) => a + (p2.amount ?? 0), 0));

    const subsList = subs ?? [];
    setChurn(
      subsList.length === 0
        ? { rate: 0, hasData: false }
        : { rate: (subsList.filter((s) => s.status === "canceled").length / subsList.length) * 100, hasData: true },
    );

    const byReferrer = new Map<string, AffiliateRank>();
    for (const r of (refs as unknown as { referrer_id: string; commission_amount: number | null; referrer: { name: string | null; email: string } | null }[] | null) ?? []) {
      const key = r.referrer_id;
      const cur = byReferrer.get(key) ?? { referrer_id: key, name: r.referrer?.name ?? null, email: r.referrer?.email ?? "—", total: 0, count: 0 };
      cur.total += r.commission_amount ?? 0;
      cur.count += 1;
      byReferrer.set(key, cur);
    }
    setAffiliateRanking(Array.from(byReferrer.values()).sort((a, b) => b.total - a.total).slice(0, 10));
  }

  const metrics = useMemo(() => {
    if (!users || !generations) return null;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekAgo = now.getTime() - 7 * 86400000;
    const monthAgo = now.getTime() - 30 * 86400000;

    const byPlan = { free: 0, pro: 0, business: 0 };
    let newToday = 0,
      newWeek = 0,
      newMonth = 0;
    for (const u of users) {
      byPlan[u.plan as keyof typeof byPlan] = (byPlan[u.plan as keyof typeof byPlan] ?? 0) + 1;
      const t = new Date(u.created_at).getTime();
      if (t >= startOfDay) newToday++;
      if (t >= weekAgo) newWeek++;
      if (t >= monthAgo) newMonth++;
    }

    const mrr = byPlan.pro * 29 + byPlan.business * 99;

    const toolCounts = new Map<string, number>();
    for (const g of generations) toolCounts.set(g.tool, (toolCounts.get(g.tool) ?? 0) + 1);
    const topTool = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    return { byPlan, newToday, newWeek, newMonth, mrr, arr: mrr * 12, topTool: topTool?.[0] ?? "—" };
  }, [users, generations]);

  async function changePlan(userId: string, plan: string) {
    const { error } = await supabase.from("users").update({ plan }).eq("id", userId);
    if (error) return toast.error(error.message);
    setUsers((prev) => (prev ?? []).map((u) => (u.id === userId ? { ...u, plan } : u)));
    toast.success("Plan actualizado");
  }

  async function toggleProduct(id: string, publish: boolean) {
    const { error } = await supabase.from("products").update({ is_published: publish }).eq("id", id);
    if (error) return toast.error(error.message);
    setProducts((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, is_published: publish } : p)));
  }
  async function deleteProduct(id: string) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setProducts((prev) => (prev ?? []).filter((p) => p.id !== id));
  }

  const filteredUsers = (users ?? []).filter(
    (u) => !search.trim() || u.email.toLowerCase().includes(search.toLowerCase()) || (u.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const planChartData = metrics ? [
    { plan: "Free", count: metrics.byPlan.free },
    { plan: "Pro", count: metrics.byPlan.pro },
    { plan: "Business", count: metrics.byPlan.business },
  ] : [];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">🛡️ Admin</h1>
      </header>

      {!metrics ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<DollarSign className="w-4 h-4" />} label="MRR" value={`$${metrics.mrr}`} hint={metrics.mrr === 0 ? "Sin suscripciones pagas aún" : undefined} />
            <StatCard icon={<TrendingUp className="w-4 h-4" />} label="ARR proyectado" value={`$${metrics.arr}`} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Usuarios totales" value={String(users?.length ?? 0)} />
            <StatCard icon={<Zap className="w-4 h-4" />} label="Tool más usada" value={metrics.topTool} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <StatCard icon={<Users className="w-4 h-4" />} label="Nuevos hoy" value={String(metrics.newToday)} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Nuevos 7 días" value={String(metrics.newWeek)} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Nuevos 30 días" value={String(metrics.newMonth)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Churn"
              value={churn?.hasData ? `${churn.rate.toFixed(1)}%` : "Sin datos"}
            />
            <StatCard
              icon={<ShoppingBag className="w-4 h-4" />}
              label="Marketplace revenue"
              value={marketplaceRevenue !== null ? `$${marketplaceRevenue.toFixed(2)}` : "—"}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="font-display font-bold mb-3">Usuarios por plan</h2>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={planChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="plan" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill="#a855f7" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="font-display font-bold mb-3">MRR — 12 meses</h2>
              <div className="h-48 grid place-items-center text-sm text-muted-foreground text-center">
                Sin datos históricos aún.
                <br />
                Vamos a empezar a registrar esto cuando Stripe esté conectado.
              </div>
            </div>
          </div>
        </>
      )}

      <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="font-display font-bold text-xl">Usuarios</h2>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input className="input pl-8 h-9 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o email…" />
          </div>
        </div>
        {users === null ? (
          <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[color:var(--surface-1)]">
                <tr className="text-xs text-muted-foreground text-left border-b border-white/5">
                  <th className="px-4 py-2">Usuario</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Rol</th>
                  <th className="px-4 py-2">Alta</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2">
                      <div>{u.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        className="input h-8 text-xs w-auto"
                        value={u.plan}
                        onChange={(e) => changePlan(u.id, e.target.value)}
                      >
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="business">Business</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs uppercase text-muted-foreground">{u.role}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-bold text-xl mb-3 flex items-center gap-2">
          <ShoppingBag className="w-4 h-4" /> Productos
        </h2>
        {products === null ? (
          <div className="h-24 rounded-xl bg-white/5 animate-pulse" />
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin productos.</p>
        ) : (
          <ul className="space-y-2">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                <span>{p.title} <span className="text-xs text-muted-foreground">({p.total_sales} ventas)</span></span>
                <div className="flex items-center gap-2">
                  {p.is_published ? (
                    <button type="button" onClick={() => toggleProduct(p.id, false)} className="text-xs text-amber-300 hover:text-amber-200">
                      Rechazar
                    </button>
                  ) : (
                    <button type="button" onClick={() => toggleProduct(p.id, true)} className="text-xs text-emerald-300 hover:text-emerald-200">
                      Aprobar
                    </button>
                  )}
                  <button type="button" onClick={() => deleteProduct(p.id)} className="text-xs text-red-300 hover:text-red-200">
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display font-bold text-xl mb-3">Ranking de afiliados</h2>
        {affiliateRanking.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin referidos todavía.</p>
        ) : (
          <ul className="space-y-2">
            {affiliateRanking.map((r, i) => (
              <li key={r.referrer_id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                <span>#{i + 1} {r.name || r.email}</span>
                <span className="text-xs text-muted-foreground">${r.total.toFixed(2)} · {r.count} referidos</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display font-bold text-xl mb-3">Logs de generaciones recientes</h2>
        {generations === null ? (
          <div className="h-24 rounded-xl bg-white/5 animate-pulse" />
        ) : (
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {generations.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-white/5">
                <span>{g.title || g.tool}</span>
                <span className="text-muted-foreground">{new Date(g.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

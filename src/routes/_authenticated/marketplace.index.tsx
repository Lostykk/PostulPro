import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Star, ShoppingBag, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/marketplace/")({
  head: () => ({ meta: [{ title: "Marketplace — PostulPro" }] }),
  component: MarketplacePage,
});

type Product = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  price: number | null;
  thumbnail_url: string | null;
  rating_avg: number | null;
  total_sales: number;
  seller_id: string;
};

const CATEGORIES = [
  { label: "Todos", value: "all" },
  { label: "Templates", value: "Template" },
  { label: "Prompt Packs", value: "Prompt Pack" },
  { label: "Guías", value: "Guía" },
  { label: "Cursos", value: "Curso" },
  { label: "Herramientas", value: "Herramienta" },
  { label: "Swipe Files", value: "Swipe File" },
];

const CATEGORY_ICON: Record<string, string> = {
  Template: "🧩",
  "Prompt Pack": "💬",
  Guía: "📘",
  Curso: "🎓",
  Herramienta: "🛠️",
  "Swipe File": "✂️",
};

const SORTS = [
  { label: "Más recientes", value: "recent" },
  { label: "Precio: menor a mayor", value: "price_asc" },
  { label: "Precio: mayor a menor", value: "price_desc" },
  { label: "Mejor valorados", value: "rating" },
] as const;

function MarketplacePage() {
  const { profile } = useProfile();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [maxPrice, setMaxPrice] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("recent");

  useEffect(() => {
    supabase
      .from("products")
      .select("id,title,description,category,price,thumbnail_url,rating_avg,total_sales,seller_id")
      .eq("is_published", true)
      .then(({ data }) => setProducts((data as Product[] | null) ?? []));
  }, []);

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (maxPrice && (p.price ?? 0) > Number(maxPrice)) return false;
      if (minRating > 0 && (p.rating_avg ?? 0) < minRating) return false;
      if (search.trim() && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "price_asc") return (a.price ?? 0) - (b.price ?? 0);
      if (sort === "price_desc") return (b.price ?? 0) - (a.price ?? 0);
      if (sort === "rating") return (b.rating_avg ?? 0) - (a.rating_avg ?? 0);
      return 0;
    });
    return list;
  }, [products, category, maxPrice, minRating, search, sort]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">🛒 Marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Templates, prompt packs, guías, cursos y más de la comunidad.</p>
        </div>
        {profile?.plan === "business" && (
          <Link
            to="/marketplace/sell"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> Vender un producto
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input className="input pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar productos…" />
        </div>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          className="input w-28"
          type="number"
          min={0}
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Precio máx."
        />
        <select className="input w-auto" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
          <option value={0}>Cualquier rating</option>
          <option value={4}>4+ estrellas</option>
          <option value={4.5}>4.5+ estrellas</option>
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {products === null ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-muted-foreground text-sm">
          {products.length === 0 ? "Todavía no hay productos publicados." : "Ningún producto coincide con estos filtros."}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to="/marketplace/$productId"
              params={{ productId: p.id }}
              className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col hover:border-violet-500/40 transition group"
            >
              <div className="aspect-video bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 grid place-items-center text-4xl">
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} alt={p.title} className="w-full h-full object-cover" />
                ) : (
                  CATEGORY_ICON[p.category ?? ""] ?? "🛍️"
                )}
              </div>
              <div className="p-4 flex flex-col flex-1 gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">{p.category ?? "Producto"}</span>
                <h3 className="font-display font-bold text-sm line-clamp-2 group-hover:text-violet-200 transition">{p.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{p.description}</p>
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {p.rating_avg ? (
                      <>
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {p.rating_avg.toFixed(1)}
                      </>
                    ) : (
                      "Sin ratings aún"
                    )}
                  </div>
                  <div className="font-display font-bold text-sm">
                    {p.price ? `$${p.price}` : "GRATIS"}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
        <ShoppingBag className="w-3.5 h-3.5" /> Comisión de plataforma: 20% sobre cada venta.
      </div>
    </div>
  );
}

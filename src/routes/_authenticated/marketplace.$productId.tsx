import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Star, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/marketplace/$productId")({
  head: () => ({ meta: [{ title: "Producto — PostulPro" }] }),
  component: ProductDetailPage,
});

type Product = {
  id: string;
  title: string;
  description: string | null;
  long_description: string | null;
  category: string | null;
  price: number | null;
  thumbnail_url: string | null;
  rating_avg: number | null;
  total_sales: number;
  seller_id: string;
};
type Review = { id: string; rating: number | null; body: string | null; created_at: string; user_id: string };

const PAGE_SIZE = 5;

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const { user } = useAuth();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewPage, setReviewPage] = useState(0);
  const [alreadyOwned, setAlreadyOwned] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    void load();
  }, [productId]);

  async function load() {
    const { data } = await supabase
      .from("products")
      .select("id,title,description,long_description,category,price,thumbnail_url,rating_avg,total_sales,seller_id")
      .eq("id", productId)
      .maybeSingle();
    setProduct((data as Product | null) ?? null);

    const { data: rev } = await supabase
      .from("reviews")
      .select("id,rating,body,created_at,user_id")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    setReviews(rev ?? []);

    if (user) {
      const { data: purchase } = await supabase
        .from("purchases")
        .select("id")
        .eq("product_id", productId)
        .eq("user_id", user.id)
        .maybeSingle();
      setAlreadyOwned(!!purchase);
    }
  }

  async function handleBuy() {
    setCheckingOut(true);
    // Checkout abstraction placeholder: marketplace one-time purchases aren't
    // wired to a payment provider yet (separate from the subscriptions/
    // credits billing flow, which does use Lemon Squeezy). We deliberately
    // do NOT create a purchase record or grant access here — only a real,
    // verified payment may do that.
    await new Promise((r) => setTimeout(r, 400));
    setCheckingOut(false);
    toast.info("¡Gracias por el interés! Los pagos del marketplace todavía no están habilitados — no se realizó ningún cargo.");
  }

  if (product === undefined) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <div className="h-96 rounded-2xl bg-white/5 animate-pulse" />
      </div>
    );
  }
  if (product === null) {
    throw notFound();
  }

  const pagedReviews = reviews.slice(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Volver al marketplace
      </Link>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div>
          <div className="aspect-video rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 grid place-items-center text-6xl mb-6 overflow-hidden">
            {product.thumbnail_url ? (
              <img src={product.thumbnail_url} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              "🛍️"
            )}
          </div>

          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">{product.category ?? "Producto"}</span>
          <h1 className="font-display text-2xl font-bold mt-1">{product.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{product.description}</p>

          {product.long_description && (
            <div className="mt-6">
              <h2 className="font-display font-bold mb-2">Qué incluye</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{product.long_description}</p>
            </div>
          )}

          <div className="mt-8">
            <h2 className="font-display font-bold mb-3">Reseñas ({reviews.length})</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin reseñas todavía.</p>
            ) : (
              <div className="space-y-3">
                {pagedReviews.map((r) => (
                  <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-1 mb-1">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < (r.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      ))}
                    </div>
                    <p className="text-sm">{r.body}</p>
                  </div>
                ))}
                {reviews.length > PAGE_SIZE && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      disabled={reviewPage === 0}
                      onClick={() => setReviewPage((p) => p - 1)}
                      className="px-3 h-8 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition disabled:opacity-30"
                    >
                      Anterior
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Página {reviewPage + 1} de {Math.ceil(reviews.length / PAGE_SIZE)}
                    </span>
                    <button
                      type="button"
                      disabled={(reviewPage + 1) * PAGE_SIZE >= reviews.length}
                      onClick={() => setReviewPage((p) => p + 1)}
                      className="px-3 h-8 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition disabled:opacity-30"
                    >
                      Siguiente
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 h-fit space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Beta · pagos próximamente
          </span>
          <div className="font-display text-3xl font-bold">{product.price ? `$${product.price}` : "GRATIS"}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {product.rating_avg ? (
              <>
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {product.rating_avg.toFixed(1)} · {product.total_sales} ventas
              </>
            ) : (
              "Sin ratings aún"
            )}
          </div>
          {alreadyOwned ? (
            <div className="text-center text-sm text-emerald-300 py-2">Ya tenés este producto ✓</div>
          ) : (
            <button
              type="button"
              onClick={handleBuy}
              disabled={checkingOut}
              className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {checkingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              Avisarme cuando esté disponible
            </button>
          )}
          <p className="text-[11px] text-muted-foreground text-center">
            Todavía no procesamos pagos de marketplace — este producto no tendrá cargo alguno hasta el lanzamiento.
          </p>
        </aside>
      </div>
    </div>
  );
}

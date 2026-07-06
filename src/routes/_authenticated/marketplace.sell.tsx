import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Upload, Loader2, Lock, DollarSign, Download, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/marketplace/sell")({
  head: () => ({ meta: [{ title: "Vender — PostulPro" }] }),
  component: SellPage,
});

const CATEGORIES = ["Template", "Prompt Pack", "Guía", "Curso", "Herramienta", "Swipe File"];

type OwnProduct = { id: string; title: string; price: number | null; total_sales: number; is_published: boolean };

function SellPage() {
  const { profile, loading } = useProfile();

  if (!loading && profile && profile.plan !== "business") {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-10">
          <Lock className="w-10 h-10 mx-auto mb-4 text-violet-300" />
          <h1 className="font-display text-2xl font-bold">Vender es exclusivo de plan BUSINESS</h1>
          <p className="mt-3 text-sm text-muted-foreground">Actualizá tu plan para publicar productos en el marketplace.</p>
          <Link to="/settings" className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition">
            Ver planes
          </Link>
        </div>
      </div>
    );
  }

  return <SellForm />;
}

function SellForm() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [products, setProducts] = useState<OwnProduct[] | null>(null);
  const [stats, setStats] = useState<{ revenue: number; downloads: number; reviews: number } | null>(null);

  useEffect(() => {
    if (user) void loadOwn();
  }, [user]);

  async function loadOwn() {
    if (!user) return;
    const { data: own } = await supabase
      .from("products")
      .select("id,title,price,total_sales,is_published")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false });
    setProducts(own ?? []);

    const ids = (own ?? []).map((p) => p.id);
    if (ids.length === 0) {
      setStats({ revenue: 0, downloads: 0, reviews: 0 });
      return;
    }
    const [{ data: purchases }, { data: reviews }] = await Promise.all([
      supabase.from("purchases").select("amount").in("product_id", ids),
      supabase.from("reviews").select("id").in("product_id", ids),
    ]);
    setStats({
      revenue: (purchases ?? []).reduce((a, p) => a + (p.amount ?? 0), 0),
      downloads: (purchases ?? []).length,
      reviews: (reviews ?? []).length,
    });
  }

  function handleImageChange(f: File | null) {
    setImage(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  }

  async function handlePublish() {
    if (!user) return;
    if (!title.trim() || !description.trim() || !price.trim() || !file) {
      toast.error("Completa título, descripción, precio y archivo");
      return;
    }
    setPublishing(true);
    try {
      const { data: product, error: insertErr } = await supabase
        .from("products")
        .insert({
          seller_id: user.id,
          title: title.trim(),
          description: description.trim(),
          long_description: longDescription.trim() || null,
          category,
          price: Number(price),
          is_published: false,
        })
        .select("id")
        .single();
      if (insertErr || !product) throw new Error(insertErr?.message ?? "No se pudo crear el producto");

      const filePath = `${product.id}/${file.name}`;
      const { error: fileErr } = await supabase.storage.from("product-files").upload(filePath, file, { upsert: true });
      if (fileErr) throw new Error(`Error subiendo archivo: ${fileErr.message}`);

      let thumbnailUrl: string | null = null;
      if (image) {
        const imgPath = `${product.id}/${image.name}`;
        const { error: imgErr } = await supabase.storage.from("product-thumbnails").upload(imgPath, image, { upsert: true });
        if (imgErr) throw new Error(`Error subiendo imagen: ${imgErr.message}`);
        thumbnailUrl = supabase.storage.from("product-thumbnails").getPublicUrl(imgPath).data.publicUrl;
      }

      const { error: updateErr } = await supabase
        .from("products")
        .update({ file_url: filePath, thumbnail_url: thumbnailUrl, is_published: true })
        .eq("id", product.id);
      if (updateErr) throw new Error(updateErr.message);

      toast.success("Producto publicado");
      setTitle("");
      setDescription("");
      setLongDescription("");
      setPrice("");
      setFile(null);
      handleImageChange(null);
      void loadOwn();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Volver al marketplace
      </Link>
      <h1 className="font-display text-3xl font-bold mb-6">Vender un producto</h1>

      <div className="grid lg:grid-cols-[1fr_280px] gap-6 mb-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
          <Field label="Título">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Pack de 50 prompts" />
          </Field>
          <Field label="Descripción corta">
            <textarea className="input min-h-[70px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Qué incluye (descripción larga)">
            <textarea className="input min-h-[90px] resize-y" value={longDescription} onChange={(e) => setLongDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Precio (USD)">
              <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="19" />
            </Field>
          </div>
          <Field label="Archivo del producto">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-muted-foreground" />
          </Field>
          <Field label="Imagen / thumbnail">
            <input type="file" accept="image/*" onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)} className="text-xs text-muted-foreground" />
          </Field>

          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition disabled:opacity-60"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Publicar producto
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 h-fit">
          <div className="text-xs text-muted-foreground mb-2">Preview</div>
          <div className="aspect-video rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 grid place-items-center text-3xl overflow-hidden mb-3">
            {imagePreview ? <img src={imagePreview} alt="preview" className="w-full h-full object-cover" /> : "🛍️"}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">{category}</div>
          <div className="font-display font-bold text-sm mt-1">{title || "Título del producto"}</div>
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{description || "Descripción corta…"}</div>
          <div className="font-display font-bold mt-2">{price ? `$${price}` : "$0"}</div>
        </div>
      </div>

      <h2 className="font-display font-bold text-xl mb-3">Tu dashboard de ventas</h2>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard icon={<DollarSign className="w-4 h-4" />} label="Ingresos" value={`$${(stats?.revenue ?? 0).toFixed(2)}`} />
        <StatCard icon={<Download className="w-4 h-4" />} label="Descargas" value={String(stats?.downloads ?? 0)} />
        <StatCard icon={<Star className="w-4 h-4" />} label="Reviews" value={String(stats?.reviews ?? 0)} />
      </div>

      {products === null ? (
        <div className="h-24 rounded-xl bg-white/5 animate-pulse" />
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no publicaste ningún producto.</p>
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-sm font-medium">{p.title}</span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>${p.price}</span>
                <span>{p.total_sales} ventas</span>
                <span className={p.is_published ? "text-emerald-300" : "text-amber-300"}>{p.is_published ? "Publicado" : "Borrador"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-xl font-bold">{value}</div>
    </div>
  );
}

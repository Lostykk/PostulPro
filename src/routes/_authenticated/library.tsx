import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Star, Trash2, Copy, Download, Eye, FolderPlus, Folder as FolderIcon, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadTxt } from "@/hooks/use-ai-stream";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Biblioteca — PostulPro" }] }),
  component: LibraryPage,
});

type Generation = {
  id: string;
  tool: string;
  title: string | null;
  output: string | null;
  is_favorite: boolean;
  folder_id: string | null;
  created_at: string;
};
type FolderRow = { id: string; name: string | null; parent_id: string | null };

const TOOL_META: Record<string, { label: string; icon: string }> = {
  copywriter: { label: "Copywriter", icon: "✍️" },
  "social-pack": { label: "Social Pack", icon: "📱" },
  "business-plan": { label: "Business Plan", icon: "📊" },
  consultant: { label: "Consultor", icon: "🧠" },
  "sales-email": { label: "Sales Email", icon: "✉️" },
  "landing-copy": { label: "Landing", icon: "🎯" },
  "email-sequences": { label: "Secuencias", icon: "📬" },
};

const DATE_FILTERS = ["Todo", "Hoy", "7 días", "30 días"] as const;

function LibraryPage() {
  const { profile } = useProfile();
  const [gens, setGens] = useState<Generation[] | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [search, setSearch] = useState("");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<(typeof DATE_FILTERS)[number]>("Todo");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null | "all">("all");
  const [viewing, setViewing] = useState<Generation | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    void loadAll();
  }, [profile]);

  async function loadAll() {
    if (!profile) return;
    const [{ data: g }, { data: f }] = await Promise.all([
      supabase
        .from("generations")
        .select("id,tool,title,output,is_favorite,folder_id,created_at")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false }),
      supabase.from("folders").select("id,name,parent_id").eq("user_id", profile.id).order("created_at", { ascending: true }),
    ]);
    setGens((g as Generation[] | null) ?? []);
    setFolders(f ?? []);
  }

  const filtered = useMemo(() => {
    if (!gens) return [];
    const now = Date.now();
    return gens.filter((g) => {
      if (activeFolder !== "all" && g.folder_id !== activeFolder) return false;
      if (onlyFavorites && !g.is_favorite) return false;
      if (toolFilter !== "all" && g.tool !== toolFilter) return false;
      if (dateFilter !== "Todo") {
        const days = dateFilter === "Hoy" ? 1 : dateFilter === "7 días" ? 7 : 30;
        if (now - new Date(g.created_at).getTime() > days * 86400000) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${g.title ?? ""} ${g.output ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [gens, activeFolder, onlyFavorites, toolFilter, dateFilter, search]);

  async function toggleFavorite(g: Generation) {
    const { error } = await supabase.from("generations").update({ is_favorite: !g.is_favorite }).eq("id", g.id);
    if (error) return toast.error(error.message);
    setGens((prev) => (prev ?? []).map((x) => (x.id === g.id ? { ...x, is_favorite: !x.is_favorite } : x)));
  }
  async function deleteGen(id: string) {
    const { error } = await supabase.from("generations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setGens((prev) => (prev ?? []).filter((x) => x.id !== id));
    toast.success("Eliminado");
  }
  async function copyGen(g: Generation) {
    if (!g.output) return;
    await navigator.clipboard.writeText(g.output);
    toast.success("Copiado");
  }
  function downloadGen(g: Generation) {
    if (!g.output) return;
    downloadTxt(g.output, `${(g.title ?? "postulpro").slice(0, 40).replace(/\s+/g, "-")}.txt`);
  }

  function openView(g: Generation) {
    setViewing(g);
    setEditValue(g.output ?? "");
  }
  async function saveEdit() {
    if (!viewing) return;
    const { error } = await supabase.from("generations").update({ output: editValue }).eq("id", viewing.id);
    if (error) return toast.error(error.message);
    setGens((prev) => (prev ?? []).map((x) => (x.id === viewing.id ? { ...x, output: editValue } : x)));
    setViewing({ ...viewing, output: editValue });
    toast.success("Guardado");
  }

  async function createFolder() {
    if (!newFolderName.trim() || !profile) return;
    const { data, error } = await supabase
      .from("folders")
      .insert({ user_id: profile.id, name: newFolderName.trim() })
      .select("id,name,parent_id")
      .single();
    if (error || !data) return toast.error(error?.message ?? "Error");
    setFolders((prev) => [...prev, data]);
    setNewFolderName("");
  }
  async function renameFolder(id: string) {
    if (!renameValue.trim()) return setRenamingFolder(null);
    const { error } = await supabase.from("folders").update({ name: renameValue.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: renameValue.trim() } : f)));
    setRenamingFolder(null);
  }
  async function deleteFolder(id: string) {
    const { error } = await supabase.from("folders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setGens((prev) => (prev ?? []).map((g) => (g.folder_id === id ? { ...g, folder_id: null } : g)));
    if (activeFolder === id) setActiveFolder("all");
  }
  async function moveToFolder(genId: string, folderId: string | null) {
    const { error } = await supabase.from("generations").update({ folder_id: folderId }).eq("id", genId);
    if (error) return toast.error(error.message);
    setGens((prev) => (prev ?? []).map((g) => (g.id === genId ? { ...g, folder_id: folderId } : g)));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">📚 Biblioteca</h1>
        <p className="mt-1 text-sm text-muted-foreground">Todas tus generaciones y compras en un solo lugar.</p>
      </header>

      <div className="grid lg:grid-cols-[220px_1fr] gap-6">
        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-1">
            <button
              type="button"
              onClick={() => setActiveFolder("all")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/plain");
                if (id) void moveToFolder(id, null);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                activeFolder === "all" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                onlyFavorites ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              <Star className="w-3.5 h-3.5" /> Favoritos
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-1">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Carpetas</span>
            </div>
            {folders.map((f) => (
              <div
                key={f.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverFolder(f.id);
                }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) void moveToFolder(id, f.id);
                  setDragOverFolder(null);
                }}
                className={`group flex items-center gap-1 px-1 rounded-lg transition ${
                  dragOverFolder === f.id ? "ring-1 ring-violet-500/60 bg-violet-500/10" : ""
                }`}
              >
                {renamingFolder === f.id ? (
                  <div className="flex items-center gap-1 flex-1 py-1">
                    <input
                      className="input h-7 text-xs flex-1"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button type="button" onClick={() => renameFolder(f.id)} className="p-1 text-muted-foreground hover:text-foreground">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setRenamingFolder(null)} className="p-1 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveFolder(f.id)}
                      className={`flex-1 text-left px-2 py-2 rounded-lg text-sm truncate flex items-center gap-2 transition ${
                        activeFolder === f.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      <FolderIcon className="w-3.5 h-3.5 shrink-0" /> {f.name || "Sin nombre"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFolder(f.id);
                        setRenameValue(f.name ?? "");
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFolder(f.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="flex items-center gap-1 pt-1">
              <input
                className="input h-8 text-xs flex-1"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createFolder()}
                placeholder="Nueva carpeta…"
              />
              <button type="button" onClick={createFolder} className="p-1.5 text-muted-foreground hover:text-foreground">
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input className="input pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" />
            </div>
            <select className="input w-auto" value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}>
              <option value="all">Todas las herramientas</option>
              {Object.entries(TOOL_META).map(([id, m]) => (
                <option key={id} value={id}>
                  {m.icon} {m.label}
                </option>
              ))}
            </select>
            <select className="input w-auto" value={dateFilter} onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}>
              {DATE_FILTERS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {gens === null ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-muted-foreground text-sm">
              No hay generaciones que coincidan con estos filtros.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((g) => {
                const meta = TOOL_META[g.tool] ?? { label: g.tool, icon: "⚡" };
                return (
                  <div
                    key={g.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", g.id)}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2 cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-lg">{meta.icon}</span>
                      <button type="button" onClick={() => toggleFavorite(g)} aria-label="Favorito">
                        <Star className={`w-4 h-4 ${g.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      </button>
                    </div>
                    <div className="text-sm font-medium line-clamp-1">{g.title || meta.label}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2 flex-1">{g.output?.slice(0, 120)}</div>
                    <div className="flex items-center gap-1 pt-1 border-t border-white/5 mt-1">
                      <IconBtn label="Ver" onClick={() => openView(g)}>
                        <Eye className="w-3.5 h-3.5" />
                      </IconBtn>
                      <IconBtn label="Copiar" onClick={() => copyGen(g)}>
                        <Copy className="w-3.5 h-3.5" />
                      </IconBtn>
                      <IconBtn label="Descargar" onClick={() => downloadGen(g)}>
                        <Download className="w-3.5 h-3.5" />
                      </IconBtn>
                      <IconBtn label="Eliminar" onClick={() => deleteGen(g.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{viewing ? TOOL_META[viewing.tool]?.icon ?? "⚡" : ""} {viewing?.title || "Generación"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              className="input min-h-[300px] resize-y font-sans text-sm"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={!viewing || editValue === viewing.output}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-40 transition"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex-1 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
    >
      {children}
    </button>
  );
}

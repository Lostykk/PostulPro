import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Star,
  Trash2,
  Copy,
  Download,
  Eye,
  FolderPlus,
  Folder as FolderIcon,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/ui/simple-select";
import { downloadTxt } from "@/hooks/use-ai-stream";
import { TOOL_META } from "@/lib/tool-meta";
import { DeliverableRenderer } from "@/components/deliverables/DeliverableRenderer";
import {
  saveEditedOutput,
  restoreGeneratedOutput,
  toggleApproval,
} from "@/lib/deliverables/generation-actions";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Biblioteca — PostulPro" }] }),
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: LibraryPage,
});

type Generation = {
  id: string;
  tool: string;
  title: string | null;
  output: string | null;
  edited_output: string | null;
  approvals_json: Record<string, boolean> | null;
  is_favorite: boolean;
  folder_id: string | null;
  project_id: string | null;
  created_at: string;
};
type FolderRow = { id: string; name: string | null; parent_id: string | null };
type ProjectRef = { id: string; title: string | null };

const DATE_FILTERS = ["Todo", "Hoy", "7 días", "30 días"] as const;

function LibraryPage() {
  const { q } = Route.useSearch();
  const { profile } = useProfile();
  const [gens, setGens] = useState<Generation[] | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [search, setSearch] = useState(q ?? "");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<(typeof DATE_FILTERS)[number]>("Todo");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null | "all">("all");
  const [viewing, setViewing] = useState<Generation | null>(null);
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
    const [{ data: g }, { data: f }, { data: p }] = await Promise.all([
      supabase
        .from("generations")
        .select(
          "id,tool,title,output,edited_output,approvals_json,is_favorite,folder_id,project_id,created_at",
        )
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("folders")
        .select("id,name,parent_id")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: true }),
      supabase.from("ai_projects").select("id,title").eq("user_id", profile.id),
    ]);
    setGens((g as Generation[] | null) ?? []);
    setFolders(f ?? []);
    setProjects(p ?? []);
  }

  const filtered = useMemo(() => {
    if (!gens) return [];
    const now = Date.now();
    return gens.filter((g) => {
      if (activeFolder !== "all" && g.folder_id !== activeFolder) return false;
      if (onlyFavorites && !g.is_favorite) return false;
      if (toolFilter !== "all" && g.tool !== toolFilter) return false;
      if (projectFilter !== "all" && g.project_id !== projectFilter) return false;
      if (dateFilter !== "Todo") {
        const days = dateFilter === "Hoy" ? 1 : dateFilter === "7 días" ? 7 : 30;
        if (now - new Date(g.created_at).getTime() > days * 86400000) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${g.title ?? ""} ${g.edited_output ?? g.output ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [gens, activeFolder, onlyFavorites, toolFilter, projectFilter, dateFilter, search]);

  const projectsWithGenerations = useMemo(() => {
    if (!gens) return [];
    const ids = new Set(gens.map((g) => g.project_id).filter((id): id is string => !!id));
    return projects.filter((p) => ids.has(p.id));
  }, [gens, projects]);

  async function toggleFavorite(g: Generation) {
    const { error } = await supabase
      .from("generations")
      .update({ is_favorite: !g.is_favorite })
      .eq("id", g.id);
    if (error) return toast.error(error.message);
    setGens((prev) =>
      (prev ?? []).map((x) => (x.id === g.id ? { ...x, is_favorite: !x.is_favorite } : x)),
    );
  }
  async function deleteGen(id: string) {
    const { error } = await supabase.from("generations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setGens((prev) => (prev ?? []).filter((x) => x.id !== id));
    toast.success("Eliminado");
  }
  async function copyGen(g: Generation) {
    const text = g.edited_output ?? g.output;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success("Copiado");
  }
  function downloadGen(g: Generation) {
    const text = g.edited_output ?? g.output;
    if (!text) return;
    downloadTxt(text, `${(g.title ?? "postulpro").slice(0, 40).replace(/\s+/g, "-")}.txt`);
  }

  function openView(g: Generation) {
    setViewing(g);
  }
  async function saveEdit(newText: string) {
    if (!viewing) return;
    await saveEditedOutput(viewing.id, newText);
    setGens((prev) =>
      (prev ?? []).map((x) => (x.id === viewing.id ? { ...x, edited_output: newText } : x)),
    );
    setViewing({ ...viewing, edited_output: newText });
  }
  async function restoreGen() {
    if (!viewing) return;
    await restoreGeneratedOutput(viewing.id);
    setGens((prev) =>
      (prev ?? []).map((x) => (x.id === viewing.id ? { ...x, edited_output: null } : x)),
    );
    setViewing({ ...viewing, edited_output: null });
  }
  async function toggleGenApproval(blockTitle: string, approved: boolean) {
    if (!viewing) return;
    const next = await toggleApproval(
      viewing.id,
      viewing.approvals_json ?? {},
      blockTitle,
      approved,
    );
    setGens((prev) =>
      (prev ?? []).map((x) => (x.id === viewing.id ? { ...x, approvals_json: next } : x)),
    );
    setViewing({ ...viewing, approvals_json: next });
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
    const { error } = await supabase
      .from("folders")
      .update({ name: renameValue.trim() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: renameValue.trim() } : f)));
    setRenamingFolder(null);
  }
  async function deleteFolder(id: string) {
    const { error } = await supabase.from("folders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setGens((prev) =>
      (prev ?? []).map((g) => (g.folder_id === id ? { ...g, folder_id: null } : g)),
    );
    if (activeFolder === id) setActiveFolder("all");
  }
  async function moveToFolder(genId: string, folderId: string | null) {
    const { error } = await supabase
      .from("generations")
      .update({ folder_id: folderId })
      .eq("id", genId);
    if (error) return toast.error(error.message);
    setGens((prev) =>
      (prev ?? []).map((g) => (g.id === genId ? { ...g, folder_id: folderId } : g)),
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold">📚 Biblioteca</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todas tus generaciones y compras en un solo lugar.
        </p>
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
                activeFolder === "all"
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                onlyFavorites
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              <Star className="w-3.5 h-3.5" /> Favoritos
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-1">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Carpetas
              </span>
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
                    <button
                      type="button"
                      onClick={() => renameFolder(f.id)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingFolder(null)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveFolder(f.id)}
                      className={`flex-1 text-left px-2 py-2 rounded-lg text-sm truncate flex items-center gap-2 transition ${
                        activeFolder === f.id
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:bg-white/5"
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
              <button
                type="button"
                onClick={createFolder}
                className="p-1.5 text-muted-foreground hover:text-foreground"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                className="input pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar…"
              />
            </div>
            <SimpleSelect
              className="w-auto"
              value={toolFilter}
              onValueChange={setToolFilter}
              options={[
                { value: "all", label: "Todas las herramientas" },
                ...Object.entries(TOOL_META).map(([id, m]) => ({
                  value: id,
                  label: `${m.icon} ${m.label}`,
                })),
              ]}
            />
            <SimpleSelect
              className="w-auto"
              value={dateFilter}
              onValueChange={(v) => setDateFilter(v as typeof dateFilter)}
              options={DATE_FILTERS.map((d) => ({ value: d, label: d }))}
            />
            {projectsWithGenerations.length > 0 && (
              <SimpleSelect
                className="w-auto"
                value={projectFilter}
                onValueChange={setProjectFilter}
                options={[
                  { value: "all", label: "Todos los proyectos" },
                  ...projectsWithGenerations.map((p) => ({
                    value: p.id,
                    label: p.title || "Proyecto sin título",
                  })),
                ]}
              />
            )}
          </div>

          {gens === null ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm">
              {gens.length === 0 ? (
                <div className="flex flex-col items-center gap-3">
                  <span className="text-muted-foreground">Todavía no generaste nada.</span>
                  <Link
                    to="/tools"
                    className="inline-flex items-center gap-1 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-brand text-white hover:opacity-90 transition"
                  >
                    Crear la primera
                  </Link>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  Ningún resultado coincide con estos filtros.
                </span>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((g) => {
                const meta = TOOL_META[g.tool] ?? { label: g.tool, icon: "⚡" };
                const originProject = g.project_id
                  ? projects.find((p) => p.id === g.project_id)
                  : null;
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
                        <Star
                          className={`w-4 h-4 ${g.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                        />
                      </button>
                    </div>
                    <div className="text-sm font-medium line-clamp-1">{g.title || meta.label}</div>
                    {originProject && (
                      <Link
                        to="/projects/$id"
                        params={{ id: originProject.id }}
                        className="inline-flex w-fit items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 hover:bg-violet-500/15 transition"
                      >
                        🧭 {originProject.title || "Proyecto"}
                      </Link>
                    )}
                    <div className="text-xs text-muted-foreground line-clamp-2 flex-1">
                      {(g.edited_output ?? g.output)?.slice(0, 120)}
                    </div>
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
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {viewing ? (TOOL_META[viewing.tool]?.icon ?? "⚡") : ""}{" "}
              {viewing?.title || "Generación"}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <DeliverableRenderer
              toolKey={viewing.tool}
              output={viewing.output ?? ""}
              editedOutput={viewing.edited_output}
              approvals={viewing.approvals_json ?? {}}
              title={viewing.title ?? "Generación"}
              generationId={viewing.id}
              onSave={saveEdit}
              onRestore={restoreGen}
              onToggleApproval={toggleGenApproval}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ArrowRight, Archive, Clock } from "lucide-react";
import { projectsApiFetch, ApiError } from "@/lib/projects/api-client";
import { StatusBadge } from "@/components/ui/status-badge";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Mis proyectos — PostulPro" }] }),
  component: ProjectsPage,
});

type ProjectSummary = {
  id: string;
  title: string | null;
  original_idea: string;
  status: string;
  execution_mode: string;
  estimated_credits: number;
  spent_credits: number;
  progress_percent: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
};

const FILTERS = [
  { key: "active", label: "Activos" },
  { key: "completed", label: "Completados" },
  { key: "draft", label: "Borradores" },
  { key: "archived", label: "Archivados" },
] as const;

function ProjectsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("active");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    setProjects(null);
    projectsApiFetch<{ projects: ProjectSummary[] }>(`/api/projects?status=${filter}`)
      .then((res) => setProjects(res.projects))
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "No se pudieron cargar los proyectos.");
        setProjects([]);
      });
  }, [filter]);

  async function archive(id: string) {
    try {
      await projectsApiFetch(`/api/projects/${id}/archive`, { method: "POST" });
      setProjects((prev) => (prev ?? []).filter((p) => p.id !== id));
      toast.success("Proyecto archivado");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo archivar.");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Mis proyectos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ideas convertidas en planes y activos, en un solo lugar.</p>
        </div>
        <Link
          to="/build"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition"
        >
          <Sparkles className="w-4 h-4" /> Construir una idea
        </Link>
      </header>

      <div className="flex gap-1 p-1 rounded-lg bg-white/5 w-fit text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md transition ${
              filter === f.key ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {projects === null ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl bg-white/5 animate-pulse" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
          <div className="text-3xl mb-2">🧭</div>
          <p className="text-sm text-muted-foreground mb-4">
            {filter === "active" ? "Todavía no tenés proyectos activos." : "No hay proyectos en esta categoría."}
          </p>
          <Link
            to="/build"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold bg-gradient-brand text-white"
          >
            Construir mi primera idea <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {projects.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{p.title || p.original_idea.slice(0, 60)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.original_idea}</p>
                </div>
                <StatusBadge status={p.status} className="shrink-0" />
              </div>

              <div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-gradient-brand" style={{ width: `${p.progress_percent}%` }} />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
                  <span>{p.progress_percent}% completo</span>
                  <span>{p.spent_credits}/{p.estimated_credits} créditos</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {relTime(p.updated_at)}
                </span>
                <div className="flex items-center gap-2">
                  {p.status !== "archived" && (
                    <button
                      type="button"
                      onClick={() => archive(p.id)}
                      aria-label="Archivar"
                      className="w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/15 transition"
                  >
                    Continuar
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hace instantes";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

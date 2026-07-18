import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function ProjectContextBanner({ projectId }: { projectId: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5">
      <span className="text-xs text-violet-200">
        Editando el entregable existente de tu proyecto — abrir esta herramienta no consume
        créditos.
      </span>
      <Link
        to="/projects/$id"
        params={{ id: projectId }}
        className="inline-flex items-center gap-1 text-xs font-medium text-violet-200 hover:text-white whitespace-nowrap"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Volver al proyecto
      </Link>
    </div>
  );
}

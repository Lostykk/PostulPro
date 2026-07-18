import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  SkipForward,
  Clock,
  Pause,
  Archive,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusKey =
  | "draft"
  | "planning"
  | "awaiting_confirmation"
  | "pending"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "archived"
  | "cancelled"
  | "insufficient_credits";

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  spin?: boolean;
  text: string;
  bg: string;
};

// Single source of truth for how every project/step status looks across
// cards, sidebar, workspace, dashboard, library and admin — text + icon +
// color together, never color alone (see §18 of the redesign brief).
export const STATUS_META: Record<StatusKey, StatusMeta> = {
  draft: { label: "Borrador", icon: Circle, text: "text-status-pending", bg: "bg-status-pending/10" },
  planning: { label: "Planificando", icon: Loader2, spin: true, text: "text-status-planning", bg: "bg-status-planning/10" },
  awaiting_confirmation: { label: "Por confirmar", icon: Clock, text: "text-status-awaiting-confirmation", bg: "bg-status-awaiting-confirmation/10" },
  pending: { label: "Pendiente", icon: Circle, text: "text-status-pending", bg: "bg-status-pending/10" },
  ready: { label: "Listo para empezar", icon: Circle, text: "text-status-ready", bg: "bg-status-ready/10" },
  running: { label: "En progreso", icon: Loader2, spin: true, text: "text-status-in-progress", bg: "bg-status-in-progress/10" },
  paused: { label: "Pausado", icon: Pause, text: "text-status-pending", bg: "bg-status-pending/10" },
  completed: { label: "Completado", icon: CheckCircle2, text: "text-status-completed", bg: "bg-status-completed/10" },
  failed: { label: "Con error", icon: XCircle, text: "text-status-failed", bg: "bg-status-failed/10" },
  skipped: { label: "Omitido", icon: SkipForward, text: "text-status-skipped", bg: "bg-status-skipped/10" },
  archived: { label: "Archivado", icon: Archive, text: "text-status-skipped", bg: "bg-status-skipped/10" },
  cancelled: { label: "Cancelado", icon: XCircle, text: "text-status-cancelled", bg: "bg-status-cancelled/10" },
  insufficient_credits: { label: "Sin créditos suficientes", icon: AlertTriangle, text: "text-status-insufficient-credits", bg: "bg-status-insufficient-credits/10" },
};

function resolveStatus(status: string): StatusMeta {
  return STATUS_META[status as StatusKey] ?? { label: status, icon: Circle, text: "text-muted-foreground", bg: "bg-white/10" };
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = resolveStatus(status);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap",
        meta.bg,
        meta.text,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.spin && "animate-spin")} />
      {meta.label}
    </span>
  );
}

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const meta = resolveStatus(status);
  const Icon = meta.icon;
  return <Icon className={cn("h-4 w-4 shrink-0", meta.text, meta.spin && "animate-spin", className)} />;
}

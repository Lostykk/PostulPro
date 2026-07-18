import { useState } from "react";
import { Code2, PencilLine, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { BusinessPlanView } from "@/components/deliverables/BusinessPlanView";
import { LandingBuilder } from "@/components/landing/LandingBuilder";
import { EmailSequenceView } from "@/components/deliverables/EmailSequenceView";
import { SocialContentView } from "@/components/deliverables/SocialContentView";
import { GenericMarkdownView } from "@/components/deliverables/GenericMarkdownView";

export type DeliverableRendererProps = {
  toolKey: string;
  output: string;
  editedOutput: string | null;
  approvals?: Record<string, boolean>;
  title?: string;
  generationId?: string;
  onSave: (newOutput: string) => Promise<void> | void;
  onRestore: () => Promise<void> | void;
  onToggleApproval?: (blockTitle: string, approved: boolean) => Promise<void> | void;
};

// Central dispatch: every place that shows a finished deliverable (the
// project workspace's step detail, and a standalone /tools/* page opened
// with ?projectId&stepId) renders through this same component, so the
// "raw JSON/markdown dump" experience never reappears in one place while
// being fixed in another.
export function DeliverableRenderer({
  toolKey,
  output,
  editedOutput,
  approvals = {},
  title = "Entregable",
  generationId,
  onSave,
  onRestore,
  onToggleApproval,
}: DeliverableRendererProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const text = editedOutput ?? output;
  const hasEdits = editedOutput !== null && editedOutput !== output;

  async function handleRestore() {
    setRestoring(true);
    try {
      await onRestore();
      toast.success("Restaurada la versión generada originalmente");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
        >
          <Code2 className="w-3 h-3" /> {showRaw ? "Ver vista normal" : "Ver contenido técnico"}
        </button>
        <div className="flex items-center gap-2">
          {hasEdits && (
            <>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <PencilLine className="w-3 h-3" /> Editado
              </span>
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" /> Restaurar versión generada
              </button>
            </>
          )}
        </div>
      </div>

      {showRaw ? (
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80 rounded-xl border border-white/10 bg-black/30 p-4 overflow-auto max-h-[500px]">
          {text}
        </pre>
      ) : (
        <DeliverableBody
          toolKey={toolKey}
          text={text}
          title={title}
          approvals={approvals}
          generationId={generationId}
          onSave={onSave}
          onToggleApproval={onToggleApproval}
        />
      )}
    </div>
  );
}

function DeliverableBody({
  toolKey,
  text,
  title,
  approvals,
  generationId,
  onSave,
  onToggleApproval,
}: {
  toolKey: string;
  text: string;
  title: string;
  approvals: Record<string, boolean>;
  generationId?: string;
  onSave: (newOutput: string) => Promise<void> | void;
  onToggleApproval?: (blockTitle: string, approved: boolean) => Promise<void> | void;
}) {
  switch (toolKey) {
    case "business-plan":
      return <BusinessPlanView text={text} title={title} onSave={onSave} />;
    case "landing-copy":
      return <LandingBuilder text={text} title={title} generationId={generationId} onSave={onSave} />;
    case "sales-email":
    case "email-sequences":
      return (
        <EmailSequenceView
          text={text}
          approvals={approvals}
          onSave={onSave}
          onToggleApproval={onToggleApproval}
        />
      );
    case "social-pack":
      return (
        <SocialContentView
          text={text}
          approvals={approvals}
          onSave={onSave}
          onToggleApproval={onToggleApproval}
        />
      );
    default:
      return (
        <GenericMarkdownView
          text={text}
          filename={`${title.slice(0, 40).replace(/\s+/g, "-")}.txt`}
          onSave={onSave}
        />
      );
  }
}

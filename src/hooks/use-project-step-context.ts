import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectBrief } from "@/lib/projects/schema";

// Backs the "Abrir herramienta" deep link (?projectId=&stepId=): hydrates a
// standalone /tools/* page with the project's brief and, if the step has
// already produced a deliverable, that generation's content — so opening
// the tool continues editing the existing asset instead of starting from a
// blank wizard. Every query here is a plain client-side SELECT, scoped by
// RLS to the authenticated owner (see "Own projects read" / "Own steps
// read" / "Own generations" policies) — no server route, no credit charge,
// ever, just for opening or reading.
export type StepGeneration = {
  id: string;
  output: string;
  editedOutput: string | null;
  approvals: Record<string, boolean>;
};

export type ProjectStepContext = {
  loading: boolean;
  brief: ProjectBrief | null;
  stepInput: Record<string, unknown> | null;
  toolKey: string | null;
  generation: StepGeneration | null;
};

const EMPTY: ProjectStepContext = {
  loading: false,
  brief: null,
  stepInput: null,
  toolKey: null,
  generation: null,
};

export function useProjectStepContext(projectId?: string, stepId?: string): ProjectStepContext {
  const [ctx, setCtx] = useState<ProjectStepContext>(
    projectId && stepId ? { ...EMPTY, loading: true } : EMPTY,
  );

  useEffect(() => {
    if (!projectId || !stepId) {
      setCtx(EMPTY);
      return;
    }
    let cancelled = false;
    setCtx({ ...EMPTY, loading: true });

    (async () => {
      const [{ data: project }, { data: step }] = await Promise.all([
        supabase.from("ai_projects").select("brief_json").eq("id", projectId).maybeSingle(),
        supabase
          .from("ai_project_steps")
          .select("tool_key,input_json,output_generation_id")
          .eq("id", stepId)
          .eq("project_id", projectId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (!step) {
        setCtx(EMPTY);
        return;
      }

      let generation: StepGeneration | null = null;
      if (step.output_generation_id) {
        const { data: gen } = await supabase
          .from("generations")
          .select("id,output,edited_output,approvals_json")
          .eq("id", step.output_generation_id)
          .maybeSingle();
        if (gen?.output) {
          generation = {
            id: gen.id as string,
            output: gen.output as string,
            editedOutput: (gen.edited_output as string | null) ?? null,
            approvals: (gen.approvals_json as Record<string, boolean> | null) ?? {},
          };
        }
      }
      if (cancelled) return;
      setCtx({
        loading: false,
        brief: (project?.brief_json as ProjectBrief | null) ?? null,
        stepInput: (step.input_json as Record<string, unknown> | null) ?? {},
        toolKey: step.tool_key as string,
        generation,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, stepId]);

  return ctx;
}

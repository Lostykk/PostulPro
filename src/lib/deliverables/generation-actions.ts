import { supabase } from "@/integrations/supabase/client";

// Thin wrappers around the three writes a DeliverableRenderer can trigger
// on a `generations` row (edit, restore, approve-block) — shared by every
// standalone /tools/* page opened via a project deep link. RLS ("Own
// generations" FOR ALL) already scopes these to the authenticated owner;
// there is no server route because none of these three actions charge
// credits or change step/project state.
export async function saveEditedOutput(generationId: string, newText: string) {
  const { error } = await supabase
    .from("generations")
    .update({ edited_output: newText })
    .eq("id", generationId);
  if (error) throw error;
}

export async function restoreGeneratedOutput(generationId: string) {
  const { error } = await supabase
    .from("generations")
    .update({ edited_output: null })
    .eq("id", generationId);
  if (error) throw error;
}

export async function toggleApproval(
  generationId: string,
  current: Record<string, boolean>,
  blockTitle: string,
  approved: boolean,
) {
  const next = { ...current, [blockTitle]: approved };
  const { error } = await supabase
    .from("generations")
    .update({ approvals_json: next })
    .eq("id", generationId);
  if (error) throw error;
  return next;
}

-- Root cause of a project stuck forever in 'planning' with 0/0 deliverables:
-- when the planner (Anthropic call, parsing, schema validation, or the
-- final save_ai_project_plan write) failed, the route returned an error
-- response to the client but never persisted that failure anywhere — the
-- ai_projects row stayed exactly as create_ai_project left it (status
-- 'planning', no brief/plan, created_at == updated_at), indistinguishable
-- from "still running" with no way to retry other than a fresh page load
-- silently re-attempting forever.
--
-- This RPC gives the planning route a real terminal failure state to write
-- to, mirroring the existing fail_ai_project_step (20260712010000) but for
-- the project-level planning phase itself, which has no step row yet to
-- attach an error to.
CREATE OR REPLACE FUNCTION public.fail_ai_project_planning(p_project_id UUID, p_error_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id, status INTO v_owner, v_status FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_status NOT IN ('planning', 'awaiting_confirmation') THEN
    RAISE EXCEPTION 'Project is not in a plannable state (%)', v_status;
  END IF;

  UPDATE public.ai_projects SET
    status = 'failed',
    last_error_code = p_error_code,
    updated_at = NOW()
  WHERE id = p_project_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_ai_project_planning(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_ai_project_planning(UUID, TEXT) TO authenticated;

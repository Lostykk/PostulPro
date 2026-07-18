-- Root cause of "persistence_failed" on a retry that had already produced a
-- valid plan: save_ai_project_plan's OWN internal status guard only ever
-- accepted ('planning','awaiting_confirmation') — but a project retried
-- from a 'failed' planning state (see fail_ai_project_planning,
-- 20260719000000) is still 'failed' in the DB the whole time the retry
-- runs (nothing transitions it back to 'planning' first). The route-level
-- gate (canRetryPlanning) correctly allowed the retry to reach the
-- planner, generate a valid plan, and then this RPC rejected the write
-- with "Project is not in a plannable state (failed)".
--
-- The exact same bug silently no-op'd fail_ai_project_planning itself when
-- called a second time on an already-'failed' project (e.g. this retry
-- failing again for a different reason) — its own guard rejected the
-- update too, which is why last_error_code/updated_at never changed on a
-- second failed attempt.
--
-- Fix: both RPCs now also accept 'failed' as a valid starting status, but
-- ONLY when no plan_json was ever saved (failed during planning itself,
-- never during step execution) — mirroring canRetryPlanning() exactly, so
-- a project that failed later with real progress (steps, spent credits)
-- still can't have its plan silently regenerated out from under it.

CREATE OR REPLACE FUNCTION public.save_ai_project_plan(
  p_project_id UUID,
  p_title TEXT,
  p_project_type TEXT,
  p_brief_json JSONB,
  p_plan_json JSONB,
  p_assumptions_json JSONB,
  p_total_credits INT,
  p_steps JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
  v_plan_json JSONB;
  v_step JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id, status, plan_json INTO v_owner, v_status, v_plan_json
  FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_status NOT IN ('planning', 'awaiting_confirmation')
     AND NOT (v_status = 'failed' AND v_plan_json IS NULL) THEN
    RAISE EXCEPTION 'Project is not in a plannable state (%)', v_status;
  END IF;

  DELETE FROM public.ai_project_steps WHERE project_id = p_project_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
    INSERT INTO public.ai_project_steps (
      project_id, user_id, position, tool_key, title, description, input_json, credits_cost, idempotency_key
    ) VALUES (
      p_project_id,
      v_uid,
      (v_step->>'position')::INT,
      v_step->>'tool_key',
      v_step->>'title',
      v_step->>'description',
      COALESCE(v_step->'input', '{}'::jsonb),
      (v_step->>'credits_cost')::INT,
      p_project_id::TEXT || '::' || (v_step->>'position') || '::' || (v_step->>'tool_key')
    );
  END LOOP;

  UPDATE public.ai_projects SET
    title = COALESCE(NULLIF(p_title, ''), title),
    project_type = p_project_type,
    brief_json = p_brief_json,
    plan_json = p_plan_json,
    assumptions_json = p_assumptions_json,
    estimated_credits = GREATEST(0, p_total_credits),
    plan_stale = FALSE,
    status = 'awaiting_confirmation',
    last_error_code = NULL,
    progress_percent = 0,
    updated_at = NOW()
  WHERE id = p_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_ai_project_plan(UUID,TEXT,TEXT,JSONB,JSONB,JSONB,INT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ai_project_plan(UUID,TEXT,TEXT,JSONB,JSONB,JSONB,INT,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.fail_ai_project_planning(p_project_id UUID, p_error_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
  v_plan_json JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id, status, plan_json INTO v_owner, v_status, v_plan_json
  FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_status NOT IN ('planning', 'awaiting_confirmation')
     AND NOT (v_status = 'failed' AND v_plan_json IS NULL) THEN
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

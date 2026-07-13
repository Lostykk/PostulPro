-- Same ambiguous-column-vs-OUT-parameter bug as the previous migration,
-- one line further down: the final RETURN QUERY's subquery
-- `(SELECT brief_json FROM public.ai_projects ...)` collides with the
-- function's own `brief_json` OUT parameter from RETURNS TABLE. Found on
-- the very next real invocation after the `attempts` fix — same root
-- cause, different column. Qualifying with a table alias this time so
-- there's no way for any bare column name in this function to ever
-- shadow an OUT parameter again.

CREATE OR REPLACE FUNCTION public.claim_ai_project_step(p_project_id UUID, p_step_id UUID)
RETURNS TABLE(claimed BOOLEAN, reason TEXT, tool_key TEXT, input_json JSONB, credits_cost INT, brief_json JSONB, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_proj_status TEXT;
  v_step RECORD;
  v_brief JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id, status INTO v_owner, v_proj_status FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RETURN QUERY SELECT FALSE, 'project_not_found', NULL::TEXT, NULL::JSONB, NULL::INT, NULL::JSONB, NULL::INT; RETURN;
  END IF;
  IF v_owner <> v_uid THEN
    RETURN QUERY SELECT FALSE, 'forbidden', NULL::TEXT, NULL::JSONB, NULL::INT, NULL::JSONB, NULL::INT; RETURN;
  END IF;
  IF v_proj_status IN ('archived','completed') THEN
    RETURN QUERY SELECT FALSE, 'project_' || v_proj_status, NULL::TEXT, NULL::JSONB, NULL::INT, NULL::JSONB, NULL::INT; RETURN;
  END IF;

  UPDATE public.ai_project_steps
  SET status = 'running', started_at = NOW(), attempts = public.ai_project_steps.attempts + 1, updated_at = NOW(),
      error_code = NULL, error_message_safe = NULL
  WHERE id = p_step_id AND project_id = p_project_id AND user_id = v_uid
    AND status IN ('pending','ready','failed')
  RETURNING * INTO v_step;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'not_claimable', NULL::TEXT, NULL::JSONB, NULL::INT, NULL::JSONB, NULL::INT; RETURN;
  END IF;

  UPDATE public.ai_projects SET status = 'running', current_step_id = p_step_id, updated_at = NOW()
  WHERE id = p_project_id;

  SELECT ap.brief_json INTO v_brief FROM public.ai_projects ap WHERE ap.id = p_project_id;

  RETURN QUERY SELECT TRUE, 'ok', v_step.tool_key, v_step.input_json, v_step.credits_cost,
    v_brief, v_step.attempts;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_ai_project_step(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_project_step(UUID,UUID) TO authenticated;

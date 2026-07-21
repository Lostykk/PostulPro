-- Fixes a bug in 20260802030000's reconcile_stuck_ai_project_steps: the
-- RETURNS TABLE column `project_id` collided with the
-- ai_project_steps.project_id column reference inside the loop body,
-- raising "column reference project_id is ambiguous" (42702) on every
-- call — caught immediately on first real invocation, never actually ran
-- against production data. Same fix pattern as
-- 20260714030000_fix_claim_step_ambiguous_brief_json.sql /
-- 20260714020000_fix_claim_step_ambiguous_attempts.sql for the identical
-- class of bug in claim_ai_project_step.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_ai_project_steps(p_batch_limit INT DEFAULT 200)
RETURNS TABLE(step_id UUID, project_id UUID, outcome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_threshold INTERVAL;
  v_total INT;
  v_done INT;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 OR p_batch_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid batch limit';
  END IF;

  FOR v_row IN
    SELECT s.id, s.project_id, s.tool_key, s.started_at
    FROM public.ai_project_steps s
    WHERE s.status = 'running'
    ORDER BY s.started_at ASC NULLS FIRST
    LIMIT p_batch_limit
  LOOP
    v_threshold := CASE v_row.tool_key
      WHEN 'copywriter'  THEN INTERVAL '10 minutes'
      WHEN 'landing-copy' THEN INTERVAL '10 minutes'
      WHEN 'sales-email' THEN INTERVAL '15 minutes'
      WHEN 'consultant'  THEN INTERVAL '15 minutes'
      WHEN 'social-pack' THEN INTERVAL '20 minutes'
      WHEN 'email-sequences' THEN INTERVAL '20 minutes'
      WHEN 'business-plan' THEN INTERVAL '30 minutes'
      ELSE INTERVAL '30 minutes'
    END;

    CONTINUE WHEN v_row.started_at IS NULL OR v_row.started_at > NOW() - v_threshold;

    UPDATE public.ai_project_steps
    SET status = 'failed',
        credits_reserved = FALSE,
        error_code = 'timeout',
        error_message_safe = 'Este paso tardó demasiado y fue cancelado. Podés reintentarlo.',
        updated_at = NOW()
    WHERE public.ai_project_steps.id = v_row.id AND public.ai_project_steps.status = 'running';

    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT COUNT(*) FILTER (WHERE public.ai_project_steps.status IN ('completed','skipped')), COUNT(*)
    INTO v_done, v_total
    FROM public.ai_project_steps WHERE public.ai_project_steps.project_id = v_row.project_id;

    UPDATE public.ai_projects SET
      progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
      last_error_code = 'timeout',
      updated_at = NOW()
    WHERE public.ai_projects.id = v_row.project_id AND public.ai_projects.status <> 'completed';

    RETURN QUERY SELECT v_row.id, v_row.project_id, 'failed_timeout'::TEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_steps(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_steps(INT) TO service_role;

-- Defense-in-depth for "Construir con IA" projects stuck forever in
-- 'planning' — see docs/build-with-ai-stuck-project-incident.md.
--
-- The route-level fix (POST /api/projects/:id/plan now calls
-- fail_ai_project_planning from every early-return path, not just the
-- try/catch around the planner call) covers every KNOWN cause. This RPC is
-- the safety net for any cause that isn't a clean early return at all — a
-- Worker killed mid-request, a dropped connection, an unhandled exception
-- thrown before any catch block runs, etc. Any of those still leave a
-- project row exactly as create_ai_project left it: status='planning', no
-- brief/plan, indistinguishable from "still running".
--
-- Mirrors reconcile_stale_reservations_v2 exactly (batched, idempotent,
-- service_role only, no client-supplied filters) — see
-- supabase/migrations/20260728000000_reservation_job_evidence.sql for the
-- precedent this follows.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_ai_project_planning(
  p_timeout_minutes INT DEFAULT 15,
  p_batch_limit INT DEFAULT 200
)
RETURNS TABLE(project_id UUID, outcome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_timeout_minutes IS NULL OR p_timeout_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid timeout';
  END IF;
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 OR p_batch_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid batch limit';
  END IF;

  FOR v_row IN
    SELECT public.ai_projects.id
    FROM public.ai_projects
    WHERE public.ai_projects.status = 'planning'
      AND public.ai_projects.updated_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL
    ORDER BY public.ai_projects.updated_at ASC
    LIMIT p_batch_limit
  LOOP
    UPDATE public.ai_projects
    SET status = 'failed',
        last_error_code = 'timeout',
        updated_at = NOW()
    WHERE public.ai_projects.id = v_row.id
      AND public.ai_projects.status = 'planning';
    IF FOUND THEN
      RETURN QUERY SELECT v_row.id, 'failed_timeout'::TEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_planning(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_planning(INT, INT) TO service_role;

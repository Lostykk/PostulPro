-- Real incident: project 4d71dfd5-ca53-495b-ada6-5eccaed90884 got marked
-- ai_projects.status='completed' at 75% progress (3/4 steps done) while its
-- business-plan step was permanently stuck in 'running' — confirmed live:
-- the step's started_at/updated_at never moved past the initial claim, no
-- generation was ever persisted, and its credit_reservations row is still
-- 'reserved'. See docs/build-with-ai-stuck-project-incident.md.
--
-- Root cause #1 (this migration, part A): complete_ai_project_step and
-- skip_ai_project_step both decided "is the project done?" by checking
-- for a next 'pending' step — but a step stuck in 'running' (or 'failed'
-- awaiting manual retry) is invisible to that check. Once every OTHER
-- step reached a terminal status, the RPC found no 'pending' step left
-- and incorrectly flipped the whole project to 'completed', even though
-- one deliverable never actually finished. Fixed to check for zero
-- remaining non-terminal steps instead of zero 'pending' ones — v_next
-- (which step to auto-advance current_step_id into) is unchanged, since
-- it must keep meaning "the next step to run", not "is everything done".
--
-- Root cause #2 (part B): nothing ever reconciled a step stuck in
-- 'running' back to a real status. The credit side already self-heals
-- via reconcile_stale_reservations_v2's per-tool age threshold (already
-- deployed, already scheduled) — this migration does NOT duplicate or
-- touch that; it only fixes what that reconciler doesn't touch:
-- ai_project_steps.status and ai_projects.progress_percent/status. Same
-- per-tool thresholds as reconcile_stale_reservations_v2, for consistency
-- with the reasoning already established there.

CREATE OR REPLACE FUNCTION public.complete_ai_project_step(p_step_id UUID, p_generation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_project_id UUID;
  v_cost INT;
  v_total INT;
  v_done INT;
  v_next UUID;
  v_remaining INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  UPDATE public.ai_project_steps
  SET status = 'completed', output_generation_id = p_generation_id, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_step_id AND user_id = v_uid
  RETURNING project_id, credits_cost INTO v_project_id, v_cost;

  IF v_project_id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;

  SELECT COUNT(*) FILTER (WHERE status IN ('completed','skipped')), COUNT(*)
  INTO v_done, v_total
  FROM public.ai_project_steps WHERE project_id = v_project_id;

  SELECT id INTO v_next FROM public.ai_project_steps
  WHERE project_id = v_project_id AND status = 'pending' ORDER BY position ASC LIMIT 1;

  SELECT COUNT(*) INTO v_remaining FROM public.ai_project_steps
  WHERE project_id = v_project_id AND status NOT IN ('completed', 'skipped', 'cancelled');

  IF v_next IS NOT NULL THEN
    UPDATE public.ai_project_steps SET status = 'ready', updated_at = NOW() WHERE id = v_next;
  END IF;

  UPDATE public.ai_projects SET
    spent_credits = spent_credits + v_cost,
    progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
    current_step_id = v_next,
    status = CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'running' END,
    completed_at = CASE WHEN v_remaining = 0 THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = v_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_ai_project_step(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_ai_project_step(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.skip_ai_project_step(p_step_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_project_id UUID;
  v_total INT;
  v_done INT;
  v_next UUID;
  v_remaining INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  UPDATE public.ai_project_steps
  SET status = 'skipped', updated_at = NOW()
  WHERE id = p_step_id AND user_id = v_uid AND status IN ('pending','ready','failed')
  RETURNING project_id INTO v_project_id;

  IF v_project_id IS NULL THEN RAISE EXCEPTION 'Step not found or not skippable'; END IF;

  SELECT COUNT(*) FILTER (WHERE status IN ('completed','skipped')), COUNT(*)
  INTO v_done, v_total
  FROM public.ai_project_steps WHERE project_id = v_project_id;

  SELECT id INTO v_next FROM public.ai_project_steps
  WHERE project_id = v_project_id AND status = 'pending' ORDER BY position ASC LIMIT 1;

  SELECT COUNT(*) INTO v_remaining FROM public.ai_project_steps
  WHERE project_id = v_project_id AND status NOT IN ('completed', 'skipped', 'cancelled');

  IF v_next IS NOT NULL THEN
    UPDATE public.ai_project_steps SET status = 'ready', updated_at = NOW() WHERE id = v_next;
  END IF;

  UPDATE public.ai_projects SET
    progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
    current_step_id = v_next,
    status = CASE WHEN v_remaining = 0 THEN 'completed' ELSE status END,
    completed_at = CASE WHEN v_remaining = 0 THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = v_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.skip_ai_project_step(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_ai_project_step(UUID) TO authenticated;

-- Part B: reconciler for steps genuinely stuck in 'running' past a safe
-- per-tool age (a Worker killed mid-generation before either the success
-- or settleFailure path in executor.server.ts could run — that gap is
-- already documented in that file's own comments). Deliberately does NOT
-- touch credit_reservations/users — reconcile_stale_reservations_v2
-- already owns that side via the same thresholds; this only fixes the
-- step/project rows so the UI stops showing a stuck-forever or falsely
-- "completed" state.
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
    WHERE id = v_row.id AND status = 'running';

    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT COUNT(*) FILTER (WHERE status IN ('completed','skipped')), COUNT(*)
    INTO v_done, v_total
    FROM public.ai_project_steps WHERE project_id = v_row.project_id;

    -- Never touch a project that's already genuinely completed through
    -- the normal path — provably inert there regardless.
    UPDATE public.ai_projects SET
      progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
      last_error_code = 'timeout',
      updated_at = NOW()
    WHERE id = v_row.project_id AND status <> 'completed';

    RETURN QUERY SELECT v_row.id, v_row.project_id, 'failed_timeout'::TEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_steps(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_ai_project_steps(INT) TO service_role;

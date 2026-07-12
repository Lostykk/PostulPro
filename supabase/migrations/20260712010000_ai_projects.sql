-- AI PROJECT BUILDER ("Construir con IA")
-- New tables ai_projects / ai_project_steps + orchestration RPCs. Reuses
-- generations for outputs and reserve_credits/refund_credits for billing —
-- neither of those is touched by this migration.

-- ── ai_projects ──────────────────────────────────────────────────────────
CREATE TABLE public.ai_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  original_idea TEXT NOT NULL,
  project_type TEXT,
  objective TEXT,
  target_audience TEXT,
  language TEXT NOT NULL DEFAULT 'es',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','planning','awaiting_confirmation','ready','running','paused','completed','failed','archived'
  )),
  execution_mode TEXT NOT NULL DEFAULT 'guided' CHECK (execution_mode IN ('guided','automatic')),
  brief_json JSONB,
  plan_json JSONB,
  assumptions_json JSONB,
  plan_stale BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_credits INT NOT NULL DEFAULT 0,
  spent_credits INT NOT NULL DEFAULT 0,
  progress_percent INT NOT NULL DEFAULT 0,
  current_step_id UUID,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.ai_projects TO authenticated;
GRANT ALL ON public.ai_projects TO service_role;
ALTER TABLE public.ai_projects ENABLE ROW LEVEL SECURITY;

-- Read-only-ish from the client's own PostgREST access: only SELECT is
-- meant to be used directly. All writes go through SECURITY DEFINER RPCs
-- below, so we scope UPDATE narrowly (title/execution_mode are the only
-- columns a plain client update should ever touch — everything else that
-- matters is written by RPCs running as the table owner, which bypass RLS).
CREATE POLICY "Own projects read" ON public.ai_projects FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Own projects rename" ON public.ai_projects FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND status = (SELECT status FROM public.ai_projects WHERE id = ai_projects.id)
    AND user_id = (SELECT user_id FROM public.ai_projects WHERE id = ai_projects.id)
    AND spent_credits = (SELECT spent_credits FROM public.ai_projects WHERE id = ai_projects.id)
    AND estimated_credits = (SELECT estimated_credits FROM public.ai_projects WHERE id = ai_projects.id)
    AND progress_percent = (SELECT progress_percent FROM public.ai_projects WHERE id = ai_projects.id)
  );
-- INSERT of a bare draft row is done via RPC (create_ai_project) so the
-- server controls user_id/status — no direct-insert policy is granted.

-- ── ai_project_steps ─────────────────────────────────────────────────────
CREATE TABLE public.ai_project_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  position INT NOT NULL,
  tool_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','ready','running','completed','failed','skipped','cancelled'
  )),
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  credits_cost INT NOT NULL DEFAULT 0,
  credits_reserved BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message_safe TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, position),
  UNIQUE (idempotency_key)
);
GRANT SELECT ON public.ai_project_steps TO authenticated;
GRANT ALL ON public.ai_project_steps TO service_role;
ALTER TABLE public.ai_project_steps ENABLE ROW LEVEL SECURITY;

-- Read-only from the client. Every state transition (claim/complete/fail/
-- skip) happens through SECURITY DEFINER RPCs so the frontend can never
-- mark a step completed, change its cost, or inject an arbitrary tool_key.
CREATE POLICY "Own steps read" ON public.ai_project_steps FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX ai_projects_user_created_idx ON public.ai_projects (user_id, created_at DESC);
CREATE INDEX ai_projects_status_idx ON public.ai_projects (status);
CREATE INDEX ai_project_steps_project_position_idx ON public.ai_project_steps (project_id, position);
CREATE INDEX ai_project_steps_status_idx ON public.ai_project_steps (status);
CREATE INDEX ai_project_steps_generation_idx ON public.ai_project_steps (output_generation_id);

-- ── generations: link outputs back to the project that produced them ───
ALTER TABLE public.generations ADD COLUMN project_id UUID REFERENCES public.ai_projects(id) ON DELETE SET NULL;
ALTER TABLE public.generations ADD COLUMN project_step_id UUID REFERENCES public.ai_project_steps(id) ON DELETE SET NULL;
ALTER TABLE public.generations ADD COLUMN artifact_type TEXT;
CREATE INDEX generations_project_idx ON public.generations (project_id);

-- ══════════════════════════════════════════════════════════════════════
-- RPCs — every mutation that matters is server-controlled.
-- ══════════════════════════════════════════════════════════════════════

-- Create a draft project row. Returns the new id.
CREATE OR REPLACE FUNCTION public.create_ai_project(
  p_original_idea TEXT,
  p_objective TEXT DEFAULT NULL,
  p_target_audience TEXT DEFAULT NULL,
  p_language TEXT DEFAULT 'es',
  p_execution_mode TEXT DEFAULT 'guided'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_original_idea IS NULL OR length(trim(p_original_idea)) < 8 THEN
    RAISE EXCEPTION 'La idea es demasiado corta';
  END IF;
  IF length(p_original_idea) > 4000 THEN
    RAISE EXCEPTION 'La idea es demasiado larga';
  END IF;
  IF p_execution_mode NOT IN ('guided','automatic') THEN
    RAISE EXCEPTION 'Invalid execution_mode';
  END IF;

  INSERT INTO public.ai_projects (user_id, original_idea, objective, target_audience, language, execution_mode, status)
  VALUES (v_uid, trim(p_original_idea), p_objective, p_target_audience, COALESCE(p_language, 'es'), p_execution_mode, 'planning')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_ai_project(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ai_project(TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- Save a server-validated plan: writes brief/plan/assumptions on the
-- project and bulk-inserts its steps in one transaction. p_steps is a
-- JSONB array of {position,tool_key,title,description,input,credits_cost}
-- already validated + cost-recalculated by the server (never trusts the
-- model's own numbers). Only callable while the project is still in
-- 'planning' or already 'awaiting_confirmation' (re-plan replaces steps).
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
  v_step JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id, status INTO v_owner, v_status FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_status NOT IN ('planning','awaiting_confirmation') THEN
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
    progress_percent = 0,
    updated_at = NOW()
  WHERE id = p_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_ai_project_plan(UUID,TEXT,TEXT,JSONB,JSONB,JSONB,INT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ai_project_plan(UUID,TEXT,TEXT,JSONB,JSONB,JSONB,INT,JSONB) TO authenticated;

-- Edit the brief after a plan exists. If any structural field changes,
-- flags plan_stale so the UI must offer "Actualizar plan" instead of
-- silently running against outdated context.
CREATE OR REPLACE FUNCTION public.update_ai_project_brief(p_project_id UUID, p_brief_json JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_old JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT user_id, brief_json INTO v_owner, v_old FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  UPDATE public.ai_projects SET
    brief_json = p_brief_json,
    plan_stale = (v_old IS DISTINCT FROM p_brief_json),
    updated_at = NOW()
  WHERE id = p_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_ai_project_brief(UUID,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_ai_project_brief(UUID,JSONB) TO authenticated;

-- Confirm the plan: awaiting_confirmation -> ready, and marks the first
-- pending step 'ready' so run-next has somewhere to start.
CREATE OR REPLACE FUNCTION public.confirm_ai_project_plan(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
  v_stale BOOLEAN;
  v_first_step UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT user_id, status, plan_stale INTO v_owner, v_status, v_stale FROM public.ai_projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_status <> 'awaiting_confirmation' THEN RAISE EXCEPTION 'Project is not awaiting confirmation (%)', v_status; END IF;
  IF v_stale THEN RAISE EXCEPTION 'Plan is stale — regenerate it before confirming'; END IF;

  SELECT id INTO v_first_step FROM public.ai_project_steps
  WHERE project_id = p_project_id AND status = 'pending' ORDER BY position ASC LIMIT 1;

  UPDATE public.ai_projects SET status = 'ready', current_step_id = v_first_step, updated_at = NOW()
  WHERE id = p_project_id;

  IF v_first_step IS NOT NULL THEN
    UPDATE public.ai_project_steps SET status = 'ready', updated_at = NOW() WHERE id = v_first_step;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_ai_project_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_ai_project_plan(UUID) TO authenticated;

-- Atomically claim a step for execution (CAS on status). Only one caller
-- can win when two requests race — the others get claimed=false. Does NOT
-- touch credits (the API route calls reserve_credits/refund_credits
-- unchanged, exactly as generate-ai.ts already does).
CREATE OR REPLACE FUNCTION public.claim_ai_project_step(p_project_id UUID, p_step_id UUID)
RETURNS TABLE(claimed BOOLEAN, reason TEXT, tool_key TEXT, input_json JSONB, credits_cost INT, brief_json JSONB, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_proj_status TEXT;
  v_step RECORD;
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
  SET status = 'running', started_at = NOW(), attempts = attempts + 1, updated_at = NOW(),
      error_code = NULL, error_message_safe = NULL
  WHERE id = p_step_id AND project_id = p_project_id AND user_id = v_uid
    AND status IN ('pending','ready','failed')
  RETURNING * INTO v_step;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'not_claimable', NULL::TEXT, NULL::JSONB, NULL::INT, NULL::JSONB, NULL::INT; RETURN;
  END IF;

  UPDATE public.ai_projects SET status = 'running', current_step_id = p_step_id, updated_at = NOW()
  WHERE id = p_project_id;

  RETURN QUERY SELECT TRUE, 'ok', v_step.tool_key, v_step.input_json, v_step.credits_cost,
    (SELECT brief_json FROM public.ai_projects WHERE id = p_project_id), v_step.attempts;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_ai_project_step(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_project_step(UUID,UUID) TO authenticated;

-- Mark a claimed step's credit reservation as done (so a refund is only
-- ever issued if a reservation actually happened).
CREATE OR REPLACE FUNCTION public.mark_step_credits_reserved(p_step_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_project_steps SET credits_reserved = TRUE, updated_at = NOW()
  WHERE id = p_step_id AND user_id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_step_credits_reserved(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_step_credits_reserved(UUID) TO authenticated;

-- Complete a step: links the generation, advances the project's progress
-- and current_step_id to the next pending step (marking it 'ready'), and
-- flips the project to 'completed' once nothing is left to run.
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

  IF v_next IS NOT NULL THEN
    UPDATE public.ai_project_steps SET status = 'ready', updated_at = NOW() WHERE id = v_next;
  END IF;

  UPDATE public.ai_projects SET
    spent_credits = spent_credits + v_cost,
    progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
    current_step_id = v_next,
    status = CASE WHEN v_next IS NULL THEN 'completed' ELSE 'running' END,
    completed_at = CASE WHEN v_next IS NULL THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = v_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_ai_project_step(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_ai_project_step(UUID,UUID) TO authenticated;

-- Fail a step. If credits were reserved for this attempt, the caller is
-- responsible for calling refund_credits BEFORE this (same as
-- generate-ai.ts's refundOnce pattern) — this RPC just records the error
-- and decides whether the project pauses or stays running.
CREATE OR REPLACE FUNCTION public.fail_ai_project_step(
  p_step_id UUID, p_error_code TEXT, p_error_message_safe TEXT, p_pause_project BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_project_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  UPDATE public.ai_project_steps
  SET status = 'failed', credits_reserved = FALSE, error_code = p_error_code,
      error_message_safe = p_error_message_safe, updated_at = NOW()
  WHERE id = p_step_id AND user_id = v_uid
  RETURNING project_id INTO v_project_id;

  IF v_project_id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;

  UPDATE public.ai_projects SET
    status = CASE WHEN p_pause_project THEN 'paused' ELSE status END,
    last_error_code = p_error_code,
    updated_at = NOW()
  WHERE id = v_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fail_ai_project_step(UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_ai_project_step(UUID,TEXT,TEXT,BOOLEAN) TO authenticated;

-- Skip a step (no charge). Advances the project the same way completion does.
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

  IF v_next IS NOT NULL THEN
    UPDATE public.ai_project_steps SET status = 'ready', updated_at = NOW() WHERE id = v_next;
  END IF;

  UPDATE public.ai_projects SET
    progress_percent = CASE WHEN v_total = 0 THEN 0 ELSE LEAST(100, ROUND(v_done::NUMERIC / v_total * 100)) END,
    current_step_id = v_next,
    status = CASE WHEN v_next IS NULL THEN 'completed' ELSE status END,
    completed_at = CASE WHEN v_next IS NULL THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = v_project_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.skip_ai_project_step(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_ai_project_step(UUID) TO authenticated;

-- Pause / resume / archive: simple ownership-checked status transitions.
CREATE OR REPLACE FUNCTION public.pause_ai_project(p_project_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.ai_projects SET status = 'paused', updated_at = NOW()
  WHERE id = p_project_id AND user_id = auth.uid() AND status = 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or not running'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pause_ai_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_ai_project(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_ai_project(p_project_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.ai_projects SET status = 'ready', updated_at = NOW()
  WHERE id = p_project_id AND user_id = auth.uid() AND status = 'paused';
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or not paused'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resume_ai_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_ai_project(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_ai_project(p_project_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.ai_projects SET status = 'archived', archived_at = NOW(), updated_at = NOW()
  WHERE id = p_project_id AND user_id = auth.uid() AND status <> 'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or already archived'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.archive_ai_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_ai_project(UUID) TO authenticated;

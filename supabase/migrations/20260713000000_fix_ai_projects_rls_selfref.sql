-- Bug found during post-deploy verification of the new PostulPro Supabase
-- project: the "Own projects rename" UPDATE policy's WITH CHECK correlated
-- every immutable-column subquery as `ai_projects_1.id = ai_projects_1.id`
-- (comparing the aliased copy to itself) instead of correlating it to the
-- row actually being checked. With 0-1 rows in the table this silently
-- "worked" by accident; with 2+ rows each subquery matches every row and
-- Postgres raises "more than one row returned by a subquery used as an
-- expression", breaking the policy entirely. Correct pattern: give the
-- subquery its own alias and correlate it to the bare (unaliased) table
-- name, which Postgres RLS resolves to the row under evaluation.

DROP POLICY IF EXISTS "Own projects rename" ON public.ai_projects;
CREATE POLICY "Own projects rename" ON public.ai_projects FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND status = (SELECT o.status FROM public.ai_projects o WHERE o.id = ai_projects.id)
    AND user_id = (SELECT o.user_id FROM public.ai_projects o WHERE o.id = ai_projects.id)
    AND spent_credits = (SELECT o.spent_credits FROM public.ai_projects o WHERE o.id = ai_projects.id)
    AND estimated_credits = (SELECT o.estimated_credits FROM public.ai_projects o WHERE o.id = ai_projects.id)
    AND progress_percent = (SELECT o.progress_percent FROM public.ai_projects o WHERE o.id = ai_projects.id)
  );

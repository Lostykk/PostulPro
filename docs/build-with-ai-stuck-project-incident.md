# Incident: "Construir con IA" project stuck forever in "Planificando"

**Reported:** 2026-07-20, Preview environment
**Affected project:** `4d71dfd5-ca53-495b-ada6-5eccaed90884`
**Status:** CLOSED — 2026-07-21. Fixed in production (`main` @ `57ec453`, Worker
`lostykk-postulpro` version `ab8acec9-1406-422a-b8fb-38761a499aef`), manually verified in
production by the owner: login, plan/credits, Founder/Admin, Dashboard, Mis proyectos, Biblioteca
all correct; the recovered project shows 4/4 deliverables, all open correctly, no new credit
consumption from opening them, no infinite spinner, no errors. Rollback tag
`rollback-before-construir-ia-cutover-20260721` → `8e01a3b` (pre-cutover production Worker version
`ffe6625e-7bfd-4d26-9403-3c46f9b2bfb4`) stays in place.

**Update 2026-07-21:** Supabase Management API access was granted mid-incident, closing that
gap — the pending migration was applied, and a second, related incident on this same project
(a step falsely marked the whole project "completed" at 75%) was diagnosed and fully reconciled
with direct DB verification. See "Second incident: false 'completed' state" below.

## Symptom

User submitted an idea via "Construir con IA" in Preview. The created project stayed in
"Creando la estructura de tu proyecto…" / status `planning` indefinitely: 0% progress, no
plan, no error, `0/0 créditos`. Reloading the page did not resolve it.

## Prior, related (already-fixed) incident

On 2026-07-15 (commits `7e48133`, `b291fac`, migrations `20260719000000_fail_ai_project_planning.sql`
and `20260720000000_allow_retry_from_failed_planning.sql`), the exact same class of symptom was
fixed for a different project (`8cec067e-864f-42d6-b28a-4478692c07f9`): the planner route
(`POST /api/projects/:id/plan`) caught planner/persistence failures and returned an error to the
client, but never wrote that failure to the `ai_projects` row. The row stayed exactly as
`create_ai_project` left it (`status='planning'`, no `brief_json`/`plan_json`,
`updated_at == created_at`) — indistinguishable from "still running", with no way to retry other
than hoping a reload helped. The fix added `fail_ai_project_planning` (a `SECURITY DEFINER` RPC)
and had the route's `catch` block around `generateProjectPlan()`/`save_ai_project_plan` call it,
plus a frontend auto-retry-once-per-load + "Reintentar" UI for the resulting `failed` state.

## Root cause of THIS incident

That July 15 fix only wrapped the `try { generateProjectPlan(...) } catch { fail_ai_project_planning }`
block. It did **not** cover two earlier `return` statements in the same handler
(`src/routes/api/projects/$id.plan.ts`, `POST`) that also leave the project stuck:

1. **Preview AI guard rejection** (`checkAiExecutionAllowed`, `src/lib/ai/preview-guard.server.ts`).
   In Preview, AI execution requires `AI_GENERATION_ENABLED === "true"` and either an admin/owner
   caller or a match against `PREVIEW_AI_ALLOWED_USER_ID`. When this guard rejects, the handler
   returns `403`/`503` **before ever calling `fail_ai_project_planning`**.
2. **Plan rate-limit rejection** (`claimPlanRateLimit`, `src/lib/rate-limit.server.ts` /
   `claim_plan_rate_limit` RPC). This applies in both Preview and production. When the limit is
   exceeded, the handler returns `429` **before ever calling `fail_ai_project_planning`**.

In both cases the client (`src/routes/_authenticated/projects.$id.tsx`, `triggerPlanning()`)
receives an error from `fetch`, but its `catch` block is a deliberate no-op — it assumes (per the
July 15 fix's own comment) that "the server already persisted a real failed state". That
assumption is false for these two paths. The `ai_projects` row is never updated, so:

- `status` stays `"planning"` forever.
- `brief_json`/`plan_json` stay `NULL` → `estimated_credits` stays `0` → any "X/Y créditos" display
  reads `0/0`.
- `updated_at == created_at`, indistinguishable from "just started".
- On page reload, `planAutoTriggeredRef` resets (new component mount) and the effect re-fires
  `triggerPlanning()` — which hits the exact same guard/rate-limit rejection again, silently, with
  no error ever surfacing. This exactly matches "reloading the page does not resolve it" and "no
  error visible".

No job queue, cron, or worker exists in this codebase for "Construir con IA" — planning and step
execution are both driven synchronously by the authenticated user's own HTTP requests
(`POST /api/projects/:id/plan`, `POST /api/projects/:id/steps/:stepId/run`,
`POST /api/projects/:id/run-next`). There is no separate `jobs` table; `ai_projects` +
`ai_project_steps` together are the closest equivalent. Because of this architecture, the only
existing periodic reconciliation is for **credit reservations**
(`reconcile_stale_reservations_v2`, `src/lib/ai/reconcile-credits.server.ts`) — there was no
reconciler at all for a project stuck in `planning`, which is the gap being closed here too as
defense-in-depth (see fix section).

## Why credits show 0/0 (not a credits bug)

Credits are never touched during planning in this codebase — `estimated_credits`/`spent_credits`
are only set by `save_ai_project_plan` (on a successful plan) and by step execution
(`claim_ai_project_step` / `complete_ai_project_step`). A project stuck in `planning` never
reserved or spent anything. `0/0` is the accurate (if confusing) reflection of "no plan was ever
saved" — not a leaked reservation or double charge. No credit-side correction is needed for this
incident.

## Scope: Preview only, or also production?

The rate-limit-rejection path applies in **both** environments — a user who exhausts
`PLAN_RATE_LIMIT_MAX_REQUESTS` (default 5 per 10 min) or `PLAN_RATE_LIMIT_DAILY_MAX` (default 20/day)
in production would hit the identical stuck-`planning` bug there too. The Preview-guard path is,
by construction, Preview-only (`isPreviewEnvironment()` short-circuits to `allowed: true` whenever
`APP_ENV !== "preview"`, which production never sets). The fix (below) covers both paths, so both
environments are protected going forward.

## Audit limitations (what could not be directly confirmed)

Per this task's security rules, no environment variable **values** were read or printed — only
names/existence were checked (`wrangler secret list --name lostykk-postulpro-preview`, name-only
output). This confirmed `AI_GENERATION_ENABLED` and `PREVIEW_AI_ALLOWED_USER_ID` (among all other
required secrets) **are configured** on the preview Worker, but not their actual values — so it
was not possible to determine from this session which of the two guard branches (kill-switch off,
vs. caller not the allowlisted QA user) actually fired for this specific request, nor to
distinguish that from the rate-limit path, without either:

- direct SQL read access to `ai_projects`/`ai_project_steps` for this project id — attempted via
  `supabase db query --linked` (Management API, no DB password needed), which failed with
  `403: Your account does not have the necessary privileges to access this endpoint`; or
- the `SUPABASE_SERVICE_ROLE_KEY` (deliberately not read/used outside its normal server-side
  runtime context), or the project owner's own authenticated session.

This does not weaken the fix: **every** early-return path between `create_ai_project` (which sets
`status='planning'`) and the try/catch around `generateProjectPlan`/`save_ai_project_plan` is
fixed to persist a real `failed` state, regardless of which one caused this particular project's
symptom. Recovering `4d71dfd5-ca53-495b-ada6-5eccaed90884` itself (Section 12 of the task) happens
automatically, on the same project id, the next time its owner opens `/projects/4d71dfd5-...`
under the fixed code — no DB write from this session is required or was made.

## Preview deployment

Deployed to `lostykk-postulpro-preview` (Worker Version ID `050777dc-05f2-4f3a-acf0-1fd2f1ba3b5f`,
`https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev`). Verified post-deploy, unauthenticated:
landing page `200`; `POST /api/internal/reconcile-stuck-projects` and the existing
`reconcile-credits` sibling both correctly `401` without the shared secret; `GET` on the new
endpoint correctly `405` (briefly `404` immediately after deploy — edge propagation lag, gone on
retry). Production Worker (`lostykk-postulpro`) was not touched by this deploy.

**Deploy workaround note**: `wrangler deploy --env preview` fails on wrangler 4.108 with
`Redirected configurations cannot include environments` — a known, previously-documented
incompatibility between this wrangler version and Nitro's generated `.output/server/wrangler.json`
(unrelated to this fix; see `docs/premium-redesign-report.md` §8 and §16.8 for the same issue hit
and resolved the same way in an earlier session). Worked around identically: edited the
generated, gitignored `.output/server/wrangler.json` (never the tracked `wrangler.jsonc` source)
to set `name: "lostykk-postulpro-preview"` / `workers_dev: true` at the root and dropped the `env`
block, then deployed without `--env`. The deployed target is unambiguous either way (the Worker
name in the config, confirmed again in the deploy command's own output).

**Not yet done, and why**: a full authenticated click-through (real login → real plan generation →
real persisted deliverable) was not performed from this session — no QA account credentials are
available here, and entering/using a password is outside this session's authority regardless. The
route-level and unit tests above prove the fix mechanically (the guard/rate-limit paths now call
`fail_ai_project_planning`), and the code is live on preview, but the task's own bar for
"GENERACIÓN REAL OPERATIVA" (a real persisted result, not just "the spinner disappeared") requires
a real logged-in session this session doesn't have. Whoever has QA access should open
`/projects/4d71dfd5-ca53-495b-ada6-5eccaed90884` on preview once — that alone completes the
recovery attempt for this specific project (same id, same idempotency key, no new project/credit
spend), and confirms end-to-end.

Separately, the new `reconcile_stuck_ai_project_planning` migration had **not been applied** to the
shared database at the time this was originally written — see "Audit limitations" above; the
Supabase CLI account authenticated in this session returned `403` on both `db query --linked` and
`migration list --linked` (an org-permission limit). **Resolved 2026-07-21**: the account's org role
was upgraded, and the migration (plus the ones from the second incident below) was applied via
`supabase db push --linked`, confirmed with `supabase migration list --linked` showing all 51
migrations in sync (`local == remote`, zero drift).

## Fix (see code changes on this branch)

1. `src/routes/api/projects/$id.plan.ts` — both the preview-guard rejection and the rate-limit
   rejection now call `fail_ai_project_planning` (best-effort, same pattern as the existing
   provider-error catch) before returning their error response, with `error_code` set to the
   guard's own code (`ai_disabled_in_preview` / `ai_restricted_in_preview`) or `"rate_limited"`.
2. `src/routes/_authenticated/projects.$id.tsx` — `PlanningFailed` now shows a message specific to
   `last_error_code` (including the two new codes and the existing planner codes) instead of one
   generic sentence, so "restricted in preview" / "rate limited" / "timed out" read as distinct,
   honest, non-billing-blaming states.
3. New migration `20260720010000_reconcile_stuck_ai_project_planning.sql` — a bounded,
   `service_role`-only `reconcile_stuck_ai_project_planning()` RPC that marks any project stuck in
   `planning` past a timeout (default 15 minutes) as `failed` with `last_error_code='timeout'`.
   This is defense-in-depth for any *future*, still-unknown cause of the same symptom (e.g. a
   Worker killed mid-request before any catch block runs) — mirroring the existing
   `reconcile_stale_reservations_v2` pattern exactly (batched, idempotent, service-role only, no
   client-supplied filters). Wired through the same secret-gated internal-HTTP + Nitro Task
   pattern as the existing credit reconciler (`RECONCILE_SECRET`, already configured on preview).
4. `checkAiExecutionAllowed` gained a third, optional `email` argument — a
   `PREVIEW_AI_ALLOWED_EMAILS` (comma-separated, case-insensitive) allowlist alongside the original
   single-user-id one, additive, neither replacing the other. `api-auth.server.ts`'s
   `resolveAuthEmail()` sources it from the verified Auth session (falling through
   `user.email` → `user.user_metadata.email` → `user.identities[0].identity_data.email`, since
   Google OAuth was observed leaving the top-level field empty for a fully signed-in account) —
   never from a client-supplied value or the `public.users` profile column (found unreliable for
   this exact purpose). Threaded through **every** call site sharing this guard
   (`$id.plan.ts`, `executor.server.ts` — used by `run.ts`/`retry.ts`/`run-next.ts` — and
   `generate-ai.ts`), after an initial pass only covered planning and a QA account could plan a
   project but not execute any of its steps.

## Second incident: step stuck in 'running' falsely marked the whole project "completed"

**Reported:** 2026-07-21, same project (`4d71dfd5-ca53-495b-ada6-5eccaed90884`), after planning was
recovered and 3 of 4 steps completed for real. The 4th step ("Plan de Negocio y Estrategia de
Lanzamiento", `business-plan`, 5 credits) stayed "En progreso" forever, while the UI simultaneously
showed 3/4 (75%) *and* a "your 4 deliverables are ready" banner — a real contradiction, not a
display glitch.

**Root cause #1** (why the step got stuck): `executor.server.ts` streams model output via
`waitUntil`, and its own comment already documented the gap — *"Bounded by a platform-enforced
ceiling, not a guarantee for slow steps — the evidence-based reconciler is the actual safety net for
those."* `business-plan` is the longest/highest-token deliverable of the four; the Worker was
almost certainly killed by Cloudflare's platform ceiling before either the success path or the
`settleFailure` catch block could run, leaving `ai_project_steps.status='running'` forever with an
unresolved `credit_reservations` row.

**Root cause #2** (why the project falsely showed "completed"): `complete_ai_project_step` decided
"is the project done?" by checking for a next **`pending`** step — but a step stuck in `'running'`
is invisible to that check. Once the other 3 steps finished, the RPC found no `pending` step left
and incorrectly flipped `ai_projects.status` to `'completed'`, even though the 4th deliverable never
actually finished. `skip_ai_project_step` had the identical bug.

**Verified live** (Supabase access granted mid-incident — see above): `ai_projects` row showed
`status: "completed"`, `progress_percent: 75`, `spent_credits: 8` (2+3+3, the three real
completions) at the same time. The account showed `credits_used: 13` — matching 8 consumed + 5
still-reserved for the stuck step, **not** a double charge. The `credit_reservations` row for that
step was `status: "reserved"`, `job_outcome: null` — genuinely still outstanding, not lost.

**Fix** (migrations `20260802030000` + `20260802040000`, the latter fixing a real bug in the
former — a `RETURNS TABLE` column named `project_id` collided with the `ai_project_steps.project_id`
column reference inside the function body, "ambiguous column" on every call, same class of bug as
`20260714020000`/`20260714030000` for `claim_ai_project_step`):

1. `complete_ai_project_step` / `skip_ai_project_step` now check for **zero remaining steps not in
   `('completed','skipped','cancelled')`** instead of "zero next `pending` step" — a stuck `running`
   or unretried `failed` step now correctly keeps the project from being marked done.
2. New `reconcile_stuck_ai_project_steps()` RPC (service_role only, same per-tool age thresholds as
   `reconcile_stale_reservations_v2`) — marks a step stuck in `'running'` past its threshold as
   `'failed'`/`'timeout'`, `credits_reserved=false`, and recomputes the project's
   `progress_percent` (never touching an already-`'completed'` project). Deliberately does **not**
   touch `credit_reservations`/`users` — the existing credit reconciler already owns that side on
   the same thresholds, proven live in this same session (see below). Wired into the same 5-minute
   Cron Trigger as the other three reconcilers.

**This specific project, fully reconciled and verified live in this session**:
- Ran `reconcile_stuck_ai_project_steps` manually once the migration was live — it correctly found
  and failed the stuck step (`outcome: "failed_timeout"`).
- The step's credit reservation had *already* been auto-refunded by the pre-existing
  `reconcile_stale_reservations_v2` cron (`refund_reason: "no_evidence_after_threshold"`,
  `refunded_at` recorded) — no manual credit action was needed or taken; `users.credits_used` is
  back to `8` (correct).
- The project's `status` column still read the bug's stale `'completed'` (the reconciler correctly
  refuses to touch an already-`'completed'` project, by design) — corrected with a single,
  explicitly user-confirmed `UPDATE` to `'running'` (`completed_at` cleared), the exact state the
  now-fixed RPC would have produced naturally. This was a one-time repair of already-corrupted data
  from the bug, not a new standing mechanism.
- The actual Business Plan **document was never generated** — the original attempt was killed
  mid-stream with nothing persisted, so there is no content to recover. The step is now `'failed'`
  with a real "Reintentar" button, same idempotency key
  (`4d71dfd5-ca53-495b-ada6-5eccaed90884::1::business-plan`), ready for exactly one real retry
  attempt.

**Closed 2026-07-21**: the owner retried once. Verified live: the step is `completed`
(`attempts: 2`), a real 22,543-character generation is persisted and linked to its credit
reservation, the project is genuinely `completed` at 100%, `spent_credits: 13` matches
`estimated_credits: 13` exactly, and `users.credits_used: 13` — no double charge across the whole
incident (the first attempt's 5 credits were refunded before the retry charged 5 once). Both
incidents on this project are fully resolved and verified with real data, not inference.

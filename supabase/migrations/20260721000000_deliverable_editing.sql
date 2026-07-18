-- Deliverables produced by AI Project Builder steps (and standalone /tools/*
-- generations) are stored verbatim in generations.output and never touched
-- again — editing today means overwriting that column directly (see
-- library.tsx saveEdit), destroying the model's original output with no way
-- back. This adds a separate edited_output column so the generated version
-- always survives and "restaurar version generada" is just clearing it.
--
-- approvals_json holds lightweight per-block review state (e.g. which email
-- or social post in a multi_block deliverable has been marked "aprobado"),
-- keyed by the block's section title from parse-sections.ts. Never read by
-- billing or step-completion logic — purely a UI review aid.

ALTER TABLE public.generations ADD COLUMN edited_output TEXT;
ALTER TABLE public.generations ADD COLUMN approvals_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- #147: org → project scoping columns on the sessions + agents projections
-- (parity with events). Additive; isolation still enforced by tenant_id.

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL DEFAULT 'default';
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "project_id" text;
UPDATE "sessions" SET "project_id" = "tenant_id" WHERE "project_id" IS NULL;

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL DEFAULT 'default';
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "project_id" text;
UPDATE "agents" SET "project_id" = "tenant_id" WHERE "project_id" IS NULL;

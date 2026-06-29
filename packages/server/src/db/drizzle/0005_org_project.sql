-- #147: org → project scoping columns on events.
--
-- Additive: isolation is still enforced by tenant_id (project_id == tenant_id
-- today), so reads are unchanged. org_id groups projects under the default org;
-- the backfill maps the legacy tenant_id onto a project.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL DEFAULT 'default';
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "project_id" text;
UPDATE "events" SET "project_id" = "tenant_id" WHERE "project_id" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_events_org_project_ts" ON "events" ("org_id", "project_id", "timestamp");

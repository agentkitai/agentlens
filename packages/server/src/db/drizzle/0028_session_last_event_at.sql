-- #281: last activity timestamp for idle-session derivation. Sessions with no
-- event for AGENTLENS_SESSION_IDLE_MINUTES report as 'idle' (derived at read, so a
-- later event bumps this and flips them back to 'active'). Seed existing rows from
-- started_at so pre-existing sessions have a baseline.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_event_at" text;
UPDATE "sessions" SET "last_event_at" = "started_at" WHERE "last_event_at" IS NULL;

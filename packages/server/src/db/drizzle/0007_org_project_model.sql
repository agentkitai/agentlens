-- #172 feature 1: org → project → member model on the Postgres path.
-- Parity with the SQLite hierarchy in migrate.sqlite.ts (orgs/projects/
-- org_members/project_members + the default org+project backfill). These tables
-- are raw-SQL-only (not in the drizzle schema modules), so no schema-drift impact.

CREATE TABLE IF NOT EXISTS "orgs" (
  "id"         text PRIMARY KEY,
  "name"       text NOT NULL,
  "slug"       text NOT NULL,
  "plan"       text NOT NULL DEFAULT 'free',
  "settings"   text NOT NULL DEFAULT '{}',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orgs_slug" ON "orgs" ("slug");

CREATE TABLE IF NOT EXISTS "projects" (
  "id"         text PRIMARY KEY,
  "org_id"     text NOT NULL,
  "name"       text NOT NULL,
  "slug"       text NOT NULL,
  "settings"   text NOT NULL DEFAULT '{}',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_projects_org" ON "projects" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_org_slug" ON "projects" ("org_id", "slug");

CREATE TABLE IF NOT EXISTS "org_members" (
  "org_id"     text NOT NULL,
  "user_id"    text NOT NULL,
  "role"       text NOT NULL DEFAULT 'member',
  "invited_by" text,
  "joined_at"  text NOT NULL,
  PRIMARY KEY ("org_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_org_members_user" ON "org_members" ("user_id");

CREATE TABLE IF NOT EXISTS "project_members" (
  "project_id" text NOT NULL,
  "user_id"    text NOT NULL,
  "role"       text NOT NULL,
  "joined_at"  text NOT NULL,
  PRIMARY KEY ("project_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_project_members_user" ON "project_members" ("user_id");

-- default org + project so existing 'default'-tenant data has a home (parity
-- with the SQLite backfill).
INSERT INTO "orgs" (id, name, slug, plan, settings, created_at, updated_at)
  VALUES ('default', 'Default', 'default', 'free', '{}', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO "projects" (id, org_id, name, slug, settings, created_at, updated_at)
  VALUES ('default', 'default', 'Default', 'default', '{}', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z')
  ON CONFLICT (id) DO NOTHING;

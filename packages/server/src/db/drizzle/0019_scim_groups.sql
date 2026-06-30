-- #148 (Enterprise SSO): SCIM 2.0 groups on the Postgres path.
-- Mirrors the sqlite tables from migrate.sqlite.ts. Raw-SQL-only tables (not in
-- the drizzle schema modules) → no schema-drift impact.

CREATE TABLE IF NOT EXISTS "scim_groups" (
  "id"           text PRIMARY KEY,
  "tenant_id"    text NOT NULL DEFAULT 'default',
  "display_name" text NOT NULL,
  "external_id"  text,
  "created_at"   text NOT NULL,
  "updated_at"   text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_scim_groups_tenant" ON "scim_groups" ("tenant_id");

CREATE TABLE IF NOT EXISTS "scim_group_members" (
  "group_id" text NOT NULL,
  "user_id"  text NOT NULL,
  PRIMARY KEY ("group_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_scim_group_members_user" ON "scim_group_members" ("user_id");

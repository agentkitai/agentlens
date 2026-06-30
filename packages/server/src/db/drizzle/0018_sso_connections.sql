-- #148 (Enterprise SSO): per-org SSO connection config on the Postgres path.
-- Mirrors the sqlite table from migrate.sqlite.ts. Raw-SQL-only table (not in the
-- drizzle schema modules) → no schema-drift impact. INTEGER booleans (0/1) so the
-- SsoConnectionStore binds the same SQL on both dialects.

CREATE TABLE IF NOT EXISTS "sso_connections" (
  "id"                  text PRIMARY KEY,
  "org_id"              text NOT NULL DEFAULT 'default',
  "type"                text NOT NULL,
  "name"                text NOT NULL,
  "enabled"             integer NOT NULL DEFAULT 0,
  "domain"              text,
  "domain_verified"     integer NOT NULL DEFAULT 0,
  "enforced"            integer NOT NULL DEFAULT 0,
  "config"              text NOT NULL DEFAULT '{}',
  "group_role_mappings" text NOT NULL DEFAULT '{}',
  "created_at"          text NOT NULL,
  "updated_at"          text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sso_connections_org" ON "sso_connections" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_sso_connections_domain" ON "sso_connections" ("domain");

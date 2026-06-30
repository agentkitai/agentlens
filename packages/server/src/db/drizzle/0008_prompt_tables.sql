-- #172 feature 2 (schema step): prompt-management tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (incl. the config/
-- prompt_type columns added to prompt_versions by #145). Raw-SQL-only tables
-- (the drizzle schema modules define them for parity but never migrated them),
-- so creating them here closes the runtime gap. The dialect-agnostic PromptStore
-- conversion that reads/writes these lands in the next PR.

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id"                 text PRIMARY KEY,
  "tenant_id"          text NOT NULL,
  "name"               text NOT NULL,
  "description"        text,
  "category"           text NOT NULL DEFAULT 'general',
  "current_version_id" text,
  "created_at"         text NOT NULL,
  "updated_at"         text NOT NULL,
  "deleted_at"         text
);
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_tenant" ON "prompt_templates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_tenant_cat" ON "prompt_templates" ("tenant_id", "category");
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_tenant_name" ON "prompt_templates" ("tenant_id", "name");

CREATE TABLE IF NOT EXISTS "prompt_versions" (
  "id"             text PRIMARY KEY,
  "template_id"    text NOT NULL,
  "tenant_id"      text NOT NULL,
  "version_number" integer NOT NULL,
  "content"        text NOT NULL,
  "variables"      text,
  "config"         text,
  "prompt_type"    text NOT NULL DEFAULT 'text',
  "content_hash"   text NOT NULL,
  "changelog"      text,
  "created_by"     text,
  "created_at"     text NOT NULL,
  UNIQUE ("template_id", "version_number")
);
CREATE INDEX IF NOT EXISTS "idx_prompt_versions_tenant" ON "prompt_versions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_versions_hash" ON "prompt_versions" ("content_hash");

CREATE TABLE IF NOT EXISTS "prompt_fingerprints" (
  "content_hash"   text NOT NULL,
  "tenant_id"      text NOT NULL,
  "agent_id"       text NOT NULL,
  "first_seen_at"  text NOT NULL,
  "last_seen_at"   text NOT NULL,
  "call_count"     integer NOT NULL DEFAULT 0,
  "template_id"    text,
  "sample_content" text,
  PRIMARY KEY ("content_hash", "tenant_id", "agent_id")
);
CREATE INDEX IF NOT EXISTS "idx_prompt_fp_tenant" ON "prompt_fingerprints" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_fp_agent" ON "prompt_fingerprints" ("tenant_id", "agent_id");
CREATE INDEX IF NOT EXISTS "idx_prompt_fp_template" ON "prompt_fingerprints" ("template_id");

CREATE TABLE IF NOT EXISTS "prompt_deployments" (
  "id"            text PRIMARY KEY,
  "tenant_id"     text NOT NULL,
  "template_id"   text NOT NULL,
  "environment"   text NOT NULL,
  "version_id"    text NOT NULL,
  "action"        text NOT NULL,
  "status"        text NOT NULL DEFAULT 'committed',
  "actor_id"      text,
  "actor_method"  text,
  "approver_id"   text,
  "approval_ref"  text,
  "note"          text,
  "seq"           integer NOT NULL,
  "prev_hash"     text,
  "hash"          text NOT NULL,
  "created_at"    text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_deploy_chain_seq" ON "prompt_deployments" ("tenant_id", "environment", "seq");
CREATE INDEX IF NOT EXISTS "idx_prompt_deploy_tenant_env" ON "prompt_deployments" ("tenant_id", "environment");
CREATE INDEX IF NOT EXISTS "idx_prompt_deploy_template" ON "prompt_deployments" ("tenant_id", "template_id", "environment");

CREATE TABLE IF NOT EXISTS "prompt_ab_tests" (
  "id"          text PRIMARY KEY,
  "tenant_id"   text NOT NULL,
  "template_id" text NOT NULL,
  "environment" text NOT NULL,
  "variants"    text NOT NULL,
  "status"      text NOT NULL DEFAULT 'active',
  "created_by"  text,
  "created_at"  text NOT NULL,
  "updated_at"  text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_prompt_ab_tests_lookup" ON "prompt_ab_tests" ("tenant_id", "template_id", "environment", "status");

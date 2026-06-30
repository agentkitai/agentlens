-- #172 feature 5 (schema step): guardrail tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (guardrail_rules,
-- guardrail_state, guardrail_trigger_history). Raw-SQL-only tables (not in the
-- drizzle schema modules) → no schema-drift impact. The dialect-agnostic
-- GuardrailStore conversion lands in the next PR.

CREATE TABLE IF NOT EXISTS "guardrail_rules" (
  "id"               text PRIMARY KEY,
  "tenant_id"        text NOT NULL,
  "name"             text NOT NULL,
  "description"      text,
  "enabled"          integer NOT NULL DEFAULT 1,
  "condition_type"   text NOT NULL,
  "condition_config" text NOT NULL DEFAULT '{}',
  "action_type"      text NOT NULL,
  "action_config"    text NOT NULL DEFAULT '{}',
  "agent_id"         text,
  "cooldown_minutes" integer NOT NULL DEFAULT 15,
  "dry_run"          integer NOT NULL DEFAULT 0,
  "created_at"       text NOT NULL,
  "updated_at"       text NOT NULL,
  "direction"        text DEFAULT 'both',
  "tool_names"       text,
  "priority"         integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_guardrail_rules_tenant" ON "guardrail_rules" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_guardrail_rules_tenant_enabled" ON "guardrail_rules" ("tenant_id", "enabled");

CREATE TABLE IF NOT EXISTS "guardrail_state" (
  "rule_id"           text NOT NULL,
  "tenant_id"         text NOT NULL,
  "last_triggered_at" text,
  "trigger_count"     integer NOT NULL DEFAULT 0,
  "last_evaluated_at" text,
  "current_value"     double precision,
  PRIMARY KEY ("rule_id", "tenant_id")
);
CREATE INDEX IF NOT EXISTS "idx_guardrail_state_tenant" ON "guardrail_state" ("tenant_id");

CREATE TABLE IF NOT EXISTS "guardrail_trigger_history" (
  "id"                  text PRIMARY KEY,
  "rule_id"             text NOT NULL,
  "tenant_id"           text NOT NULL,
  "triggered_at"        text NOT NULL,
  "condition_value"     double precision NOT NULL,
  "condition_threshold" double precision NOT NULL,
  "action_executed"     integer NOT NULL DEFAULT 0,
  "action_result"       text,
  "metadata"            text NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "idx_guardrail_trigger_history_tenant" ON "guardrail_trigger_history" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_guardrail_trigger_history_rule" ON "guardrail_trigger_history" ("rule_id", "triggered_at");

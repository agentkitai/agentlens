-- #172 feature 4 (schema step): cost-management tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (cost_budgets,
-- cost_budget_state, cost_anomaly_config, cost_rollups). Raw-SQL-only tables
-- (not in the drizzle schema modules) → no schema-drift impact. The
-- dialect-agnostic CostBudgetStore + rollup conversion lands in the next PR.

CREATE TABLE IF NOT EXISTS "cost_budgets" (
  "id"                     text PRIMARY KEY,
  "tenant_id"              text NOT NULL,
  "scope"                  text NOT NULL,
  "agent_id"               text,
  "period"                 text NOT NULL,
  "limit_usd"              double precision NOT NULL,
  "on_breach"              text NOT NULL DEFAULT 'alert',
  "downgrade_target_model" text,
  "enabled"                integer NOT NULL DEFAULT 1,
  "created_at"             text NOT NULL,
  "updated_at"             text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_cost_budgets_tenant" ON "cost_budgets" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_cost_budgets_tenant_enabled" ON "cost_budgets" ("tenant_id", "enabled");
CREATE INDEX IF NOT EXISTS "idx_cost_budgets_tenant_agent" ON "cost_budgets" ("tenant_id", "agent_id");

CREATE TABLE IF NOT EXISTS "cost_budget_state" (
  "budget_id"      text NOT NULL,
  "tenant_id"      text NOT NULL,
  "last_breach_at" text,
  "breach_count"   integer NOT NULL DEFAULT 0,
  "current_spend"  double precision,
  "period_start"   text,
  PRIMARY KEY ("budget_id", "tenant_id")
);

CREATE TABLE IF NOT EXISTS "cost_anomaly_config" (
  "tenant_id"    text PRIMARY KEY,
  "multiplier"   double precision NOT NULL DEFAULT 3.0,
  "min_sessions" integer NOT NULL DEFAULT 5,
  "enabled"      integer NOT NULL DEFAULT 1,
  "updated_at"   text NOT NULL
);

CREATE TABLE IF NOT EXISTS "cost_rollups" (
  "tenant_id"          text NOT NULL,
  "verified_agent_id"  text NOT NULL DEFAULT '',
  "model"              text NOT NULL DEFAULT '',
  "bucket_start"       text NOT NULL,
  "granularity"        text NOT NULL DEFAULT 'hour',
  "event_count"        integer NOT NULL DEFAULT 0,
  "tool_call_count"    integer NOT NULL DEFAULT 0,
  "error_count"        integer NOT NULL DEFAULT 0,
  "llm_call_count"     integer NOT NULL DEFAULT 0,
  "input_tokens"       integer NOT NULL DEFAULT 0,
  "output_tokens"      integer NOT NULL DEFAULT 0,
  "cache_read_tokens"  integer NOT NULL DEFAULT 0,
  "cache_write_tokens" integer NOT NULL DEFAULT 0,
  "cost_usd"           double precision NOT NULL DEFAULT 0,
  "latency_sum_ms"     double precision NOT NULL DEFAULT 0,
  "latency_count"      integer NOT NULL DEFAULT 0,
  "pricing_versions"   text NOT NULL DEFAULT '[]',
  "updated_at"         text NOT NULL,
  PRIMARY KEY ("tenant_id", "verified_agent_id", "model", "bucket_start", "granularity")
);
CREATE INDEX IF NOT EXISTS "idx_cost_rollups_tenant_bucket" ON "cost_rollups" ("tenant_id", "bucket_start");
CREATE INDEX IF NOT EXISTS "idx_cost_rollups_tenant_agent_bucket" ON "cost_rollups" ("tenant_id", "verified_agent_id", "bucket_start");

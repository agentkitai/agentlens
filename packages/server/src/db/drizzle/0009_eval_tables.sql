-- #172 feature 3 (schema step): evaluation tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (eval_datasets,
-- eval_test_cases, eval_runs, eval_results, evaluator_definitions). Raw-SQL-only
-- tables (not in the drizzle schema modules) → no schema-drift impact. The
-- dialect-agnostic EvalStore/EvaluatorStore conversion lands in the next PR.

CREATE TABLE IF NOT EXISTS "eval_datasets" (
  "id"          text PRIMARY KEY,
  "tenant_id"   text NOT NULL,
  "agent_id"    text,
  "name"        text NOT NULL,
  "description" text,
  "version"     integer NOT NULL DEFAULT 1,
  "parent_id"   text,
  "immutable"   integer NOT NULL DEFAULT 0,
  "created_at"  text NOT NULL,
  "updated_at"  text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_eval_datasets_tenant" ON "eval_datasets" ("tenant_id");

CREATE TABLE IF NOT EXISTS "eval_test_cases" (
  "id"               text PRIMARY KEY,
  "dataset_id"       text NOT NULL,
  "tenant_id"        text NOT NULL,
  "input"            text NOT NULL,
  "expected_output"  text,
  "tags"             text NOT NULL DEFAULT '[]',
  "metadata"         text NOT NULL DEFAULT '{}',
  "scoring_criteria" text,
  "sort_order"       integer NOT NULL DEFAULT 0,
  "created_at"       text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_eval_test_cases_dataset" ON "eval_test_cases" ("dataset_id");

CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id"                  text PRIMARY KEY,
  "tenant_id"           text NOT NULL,
  "dataset_id"          text NOT NULL,
  "dataset_version"     integer NOT NULL,
  "agent_id"            text NOT NULL,
  "webhook_url"         text NOT NULL,
  "status"              text NOT NULL DEFAULT 'pending',
  "config"              text NOT NULL DEFAULT '{}',
  "baseline_run_id"     text,
  "prompt_version_id"   text,
  "model_id"            text,
  "triggered_by"        text,
  "triggered_by_method" text,
  "total_cases"         integer NOT NULL DEFAULT 0,
  "passed_cases"        integer NOT NULL DEFAULT 0,
  "failed_cases"        integer NOT NULL DEFAULT 0,
  "avg_score"           double precision,
  "total_cost_usd"      double precision,
  "total_duration_ms"   integer,
  "started_at"          text,
  "completed_at"        text,
  "created_at"          text NOT NULL,
  "error"               text
);
CREATE INDEX IF NOT EXISTS "idx_eval_runs_tenant" ON "eval_runs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_eval_runs_dataset" ON "eval_runs" ("dataset_id");
CREATE INDEX IF NOT EXISTS "idx_eval_runs_agent" ON "eval_runs" ("tenant_id", "agent_id");

CREATE TABLE IF NOT EXISTS "eval_results" (
  "id"             text PRIMARY KEY,
  "run_id"         text NOT NULL,
  "test_case_id"   text NOT NULL,
  "tenant_id"      text NOT NULL,
  "session_id"     text,
  "actual_output"  text,
  "score"          double precision NOT NULL,
  "passed"         integer NOT NULL,
  "scorer_type"    text NOT NULL,
  "scorer_details" text NOT NULL DEFAULT '{}',
  "latency_ms"     integer,
  "cost_usd"       double precision,
  "token_count"    integer,
  "error"          text,
  "created_at"     text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_eval_results_run" ON "eval_results" ("run_id");

CREATE TABLE IF NOT EXISTS "evaluator_definitions" (
  "id"              text PRIMARY KEY,
  "tenant_id"       text NOT NULL,
  "name"            text NOT NULL,
  "description"     text,
  "scorer_type"     text NOT NULL,
  "config_template" text NOT NULL DEFAULT '{}',
  "tags"            text NOT NULL DEFAULT '[]',
  "builtin"         integer NOT NULL DEFAULT 0,
  "status"          text NOT NULL DEFAULT 'draft',
  "published_by"    text,
  "published_at"    text,
  "verified_at"     text,
  "created_at"      text NOT NULL,
  "updated_at"      text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_evaluator_defs_tenant" ON "evaluator_definitions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_evaluator_defs_tenant_type" ON "evaluator_definitions" ("tenant_id", "scorer_type");

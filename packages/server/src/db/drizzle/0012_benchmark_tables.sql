-- #172 feature 6 (schema step): benchmark tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (benchmarks,
-- benchmark_variants, benchmark_results). Raw-SQL-only tables (not in the
-- drizzle schema modules) → no schema-drift impact. The dialect-agnostic
-- BenchmarkStore conversion lands in the next PR.

CREATE TABLE IF NOT EXISTS "benchmarks" (
  "id"                       text PRIMARY KEY,
  "tenant_id"                text NOT NULL,
  "name"                     text NOT NULL,
  "description"              text,
  "status"                   text NOT NULL DEFAULT 'draft',
  "agent_id"                 text,
  "metrics"                  text NOT NULL DEFAULT '[]',
  "min_sessions_per_variant" integer NOT NULL DEFAULT 10,
  "time_range_from"          text,
  "time_range_to"            text,
  "created_at"               text NOT NULL,
  "updated_at"               text NOT NULL,
  "completed_at"             text
);
CREATE INDEX IF NOT EXISTS "idx_benchmarks_tenant_id" ON "benchmarks" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_benchmarks_tenant_status" ON "benchmarks" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "benchmark_variants" (
  "id"            text PRIMARY KEY,
  "benchmark_id"  text NOT NULL,
  "tenant_id"     text NOT NULL,
  "name"          text NOT NULL,
  "description"   text,
  "tag"           text NOT NULL,
  "agent_id"      text,
  "sort_order"    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_benchmark_variants_benchmark_id" ON "benchmark_variants" ("benchmark_id");
CREATE INDEX IF NOT EXISTS "idx_benchmark_variants_tenant_tag" ON "benchmark_variants" ("tenant_id", "tag");

CREATE TABLE IF NOT EXISTS "benchmark_results" (
  "id"              text PRIMARY KEY,
  "benchmark_id"    text NOT NULL,
  "tenant_id"       text NOT NULL,
  "variant_metrics" text NOT NULL DEFAULT '[]',
  "comparisons"     text NOT NULL DEFAULT '[]',
  "summary"         text,
  "computed_at"     text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_benchmark_results_benchmark_id" ON "benchmark_results" ("benchmark_id");
CREATE INDEX IF NOT EXISTS "idx_benchmark_results_tenant_id" ON "benchmark_results" ("tenant_id");

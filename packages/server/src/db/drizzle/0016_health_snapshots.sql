-- #172 feature 10: health_snapshots (daily per-agent health scores) on Postgres.
-- Mirrors the live SQLite columns from migrate.sqlite.ts. Raw-SQL-only table
-- (not in the drizzle schema modules) → no schema-drift impact. REAL→double
-- precision. Composite PK (tenant_id, agent_id, date) — the upsert key.

CREATE TABLE IF NOT EXISTS "health_snapshots" (
  "id"                     text NOT NULL,
  "tenant_id"              text NOT NULL,
  "agent_id"               text NOT NULL,
  "date"                   text NOT NULL,
  "overall_score"          double precision NOT NULL,
  "error_rate_score"       double precision NOT NULL,
  "cost_efficiency_score"  double precision NOT NULL,
  "tool_success_score"     double precision NOT NULL,
  "latency_score"          double precision NOT NULL,
  "completion_rate_score"  double precision NOT NULL,
  "session_count"          integer NOT NULL,
  "created_at"             text NOT NULL,
  PRIMARY KEY ("tenant_id", "agent_id", "date")
);
CREATE INDEX IF NOT EXISTS "idx_health_snapshots_agent" ON "health_snapshots" ("tenant_id", "agent_id", "date" DESC);

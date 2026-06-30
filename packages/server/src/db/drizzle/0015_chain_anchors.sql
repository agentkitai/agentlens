-- #172 feature 9: chain_anchors (signed retention checkpoints) on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts. Raw-SQL-only table
-- (not in the drizzle schema modules) → no schema-drift impact. Created here so
-- the dialect-agnostic RetentionService writes tamper-evident anchors on Postgres
-- too (before purging a cold event segment).

CREATE TABLE IF NOT EXISTS "chain_anchors" (
  "id"                 text PRIMARY KEY,
  "tenant_id"          text NOT NULL,
  "scope"              text NOT NULL DEFAULT 'session',
  "session_id"         text NOT NULL,
  "first_prev_hash"    text,
  "last_hash"          text NOT NULL,
  "event_count"        integer NOT NULL,
  "segment_digest"     text NOT NULL,
  "chained"            integer NOT NULL DEFAULT 1,
  "ts_min"             text,
  "ts_max"             text,
  "pricing_versions"   text NOT NULL DEFAULT '[]',
  "verified_agent_ids" text NOT NULL DEFAULT '[]',
  "signature"          text,
  "created_at"         text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_chain_anchors_tenant_session" ON "chain_anchors" ("tenant_id", "session_id");
CREATE INDEX IF NOT EXISTS "idx_chain_anchors_tenant_tsmax" ON "chain_anchors" ("tenant_id", "ts_max");

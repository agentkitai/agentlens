-- S6: Indexing & Query Performance Optimization
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- When applying this migration in production, run each statement individually
-- outside of a transaction block (e.g., use `psql` with no explicit BEGIN/COMMIT,
-- or set the migration runner to non-transactional mode).
--
-- Drizzle Kit runs migrations in a transaction by default. For production,
-- consider applying this file manually or via a non-transactional runner.

-- BRIN index on events.timestamp for efficient time-range scans on append-mostly data
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_events_timestamp_brin" ON "events" USING brin ("timestamp");

-- Covering index for events queries filtered by tenant + session, ordered by time
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_events_tenant_session_ts_desc" ON "events" ("tenant_id", "session_id", "timestamp" DESC);

-- Partial index on sessions for fast active-session lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sessions_active" ON "sessions" ("id", "tenant_id") WHERE status = 'active';

-- Covering index for tenant dashboard: filter by tenant+status, sort by started_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sessions_tenant_status_started_desc" ON "sessions" ("tenant_id", "status", "started_at" DESC);

-- Index for alert history queries by tenant ordered by trigger time
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_history_tenant_triggered_desc" ON "alert_history" ("tenant_id", "triggered_at" DESC);

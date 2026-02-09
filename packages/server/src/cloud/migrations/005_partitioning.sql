-- Migration 004: Table Partitioning (S-1.4)
-- Converts events, llm_calls (events table), audit_log, and usage_records to partitioned tables.
-- Creates initial partitions for current month ±3 months.
-- Idempotent: checks if table is already partitioned before converting.

-- ═══════════════════════════════════════════
-- Helper function to create monthly partitions
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_monthly_partition(
  parent_table TEXT,
  partition_col TEXT,
  target_date DATE
) RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  start_date := date_trunc('month', target_date)::DATE;
  end_date := (start_date + INTERVAL '1 month')::DATE;
  partition_name := parent_table || '_' || to_char(start_date, 'YYYY_MM');

  -- Skip if partition already exists
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = partition_name
  ) THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    partition_name, parent_table, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════
-- Convert events to partitioned table
-- ═══════════════════════════════════════════

-- We need to recreate the table as partitioned. Since this is a fresh cloud setup
-- (no data yet in Batch 2), we drop and recreate.
-- The IF NOT EXISTS on the original ensures idempotency with migration 002.

DO $$
BEGIN
  -- Only convert if not already partitioned
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'events'
  ) THEN
    -- Save any RLS policies (will re-apply via migration 003 re-run or they persist)
    DROP TABLE IF EXISTS events CASCADE;

    CREATE TABLE events (
      id UUID DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      payload JSONB NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      prev_hash TEXT,
      hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, timestamp)
    ) PARTITION BY RANGE (timestamp);

    -- Re-create indexes (on the parent; Postgres propagates to partitions)
    CREATE INDEX IF NOT EXISTS idx_events_org_session ON events(org_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_events_org_type_ts ON events(org_id, event_type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_org_ts ON events(org_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_org_agent_ts ON events(org_id, agent_id, timestamp);

    -- Re-enable RLS
    ALTER TABLE events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE events FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS events_tenant_isolation ON events;
    CREATE POLICY events_tenant_isolation ON events
      USING (org_id = current_setting('app.current_org')::uuid)
      WITH CHECK (org_id = current_setting('app.current_org')::uuid);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- Convert audit_log to partitioned table
-- ═══════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'audit_log'
  ) THEN
    DROP TABLE IF EXISTS audit_log CASCADE;

    CREATE TABLE audit_log (
      id UUID DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details JSONB,
      ip_address INET,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);

    CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(org_id, action);

    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
    CREATE POLICY audit_log_tenant_isolation ON audit_log
      USING (org_id = current_setting('app.current_org')::uuid)
      WITH CHECK (org_id = current_setting('app.current_org')::uuid);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- Convert usage_records to partitioned table
-- ═══════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'usage_records'
  ) THEN
    DROP TABLE IF EXISTS usage_records CASCADE;

    CREATE TABLE usage_records (
      org_id UUID NOT NULL,
      hour TIMESTAMPTZ NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      api_key_id UUID,
      PRIMARY KEY (org_id, hour, api_key_id)
    ) PARTITION BY RANGE (hour);

    CREATE INDEX IF NOT EXISTS idx_usage_org_hour ON usage_records(org_id, hour);

    ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS usage_records_tenant_isolation ON usage_records;
    CREATE POLICY usage_records_tenant_isolation ON usage_records
      USING (org_id = current_setting('app.current_org')::uuid)
      WITH CHECK (org_id = current_setting('app.current_org')::uuid);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- Create initial partitions: current month ±3 months
-- ═══════════════════════════════════════════

DO $$
DECLARE
  m INTEGER;
  target DATE;
  tables TEXT[] := ARRAY['events', 'audit_log', 'usage_records'];
  partition_cols TEXT[] := ARRAY['timestamp', 'created_at', 'hour'];
  tbl TEXT;
  col TEXT;
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(tables, 1) LOOP
    tbl := tables[i];
    col := partition_cols[i];
    FOR m IN -3..3 LOOP
      target := (date_trunc('month', now()) + (m || ' months')::INTERVAL)::DATE;
      PERFORM create_monthly_partition(tbl, col, target);
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════
-- Partition maintenance function
-- Called by a cron/scheduler to create future partitions and drop old ones.
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION maintain_partitions(
  max_retention_months INTEGER DEFAULT 12
) RETURNS TABLE(action TEXT, partition_name TEXT) AS $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY['events', 'audit_log', 'usage_records'];
  m INTEGER;
  target DATE;
  part_name TEXT;
  cutoff DATE;
  r RECORD;
BEGIN
  -- Create partitions 3 months ahead
  FOREACH tbl IN ARRAY tables LOOP
    FOR m IN 0..3 LOOP
      target := (date_trunc('month', now()) + (m || ' months')::INTERVAL)::DATE;
      part_name := tbl || '_' || to_char(target, 'YYYY_MM');
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
        PERFORM create_monthly_partition(tbl, '', target);
        action := 'created';
        partition_name := part_name;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  -- Drop partitions older than max_retention_months
  cutoff := (date_trunc('month', now()) - (max_retention_months || ' months')::INTERVAL)::DATE;

  FOR r IN
    SELECT inhrelid::regclass::text AS child_name,
           pg_get_expr(c.relpartbound, c.oid) AS bound_expr,
           parent.relname AS parent_name
    FROM pg_inherits
    JOIN pg_class c ON c.oid = inhrelid
    JOIN pg_class parent ON parent.oid = inhparent
    WHERE parent.relname = ANY(tables)
  LOOP
    -- Extract the start date from the partition bound
    -- Bound format: "FOR VALUES FROM ('2025-01-01') TO ('2025-02-01')"
    DECLARE
      start_str TEXT;
      start_date DATE;
    BEGIN
      start_str := substring(r.bound_expr FROM '''(\d{4}-\d{2}-\d{2})''');
      IF start_str IS NOT NULL THEN
        start_date := start_str::DATE;
        IF start_date < cutoff THEN
          EXECUTE format('DROP TABLE IF EXISTS %s', r.child_name);
          action := 'dropped';
          partition_name := r.child_name;
          RETURN NEXT;
        END IF;
      END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant execute on maintenance function
-- GRANT EXECUTE ON FUNCTION maintain_partitions TO agentlens_app;
-- GRANT EXECUTE ON FUNCTION create_monthly_partition TO agentlens_app;

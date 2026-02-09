-- Migration 003: Row-Level Security Policies (S-1.3)
-- Enables RLS on every tenant-scoped table.
-- Policies keyed on current_setting('app.current_org')::uuid.
-- Forces RLS even for table owners (defense in depth).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE.

-- Helper: list of all tenant-scoped tables
-- Cloud tables with org_id: api_keys, usage_records, invoices, audit_log, org_members, org_invitations
-- Existing tables with org_id: events, sessions, agents, alert_rules, alert_history,
--   lessons, embeddings, session_summaries, sharing_config, agent_sharing_config,
--   deny_list_rules, sharing_audit_log, sharing_review_queue, anonymous_id_map,
--   capability_registry, discovery_config, delegation_log

-- ═══════════════════════════════════════════
-- Macro: For each table, enable RLS + force + create isolation policy
-- ═══════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'events', 'sessions', 'agents', 'alert_rules', 'alert_history',
    'lessons', 'embeddings', 'session_summaries',
    'sharing_config', 'agent_sharing_config', 'deny_list_rules',
    'sharing_audit_log', 'sharing_review_queue', 'anonymous_id_map',
    'capability_registry', 'discovery_config', 'delegation_log',
    'api_keys', 'usage_records', 'invoices', 'audit_log',
    'org_members', 'org_invitations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Force RLS even for table owners
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    -- Drop existing policy if any (idempotent)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    -- Create isolation policy
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'')::uuid) WITH CHECK (org_id = current_setting(''app.current_org'')::uuid)',
      tbl || '_tenant_isolation',
      tbl
    );
  END LOOP;
END
$$;

-- ═══════════════════════════════════════════
-- Special: orgs and users tables
-- orgs: only accessible if id matches current_org (for org settings queries)
-- users: not org-scoped, no RLS (users span orgs)
-- ═══════════════════════════════════════════

-- orgs: users can only see their own org via the org_members join,
-- but we add RLS for direct queries
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orgs_tenant_isolation ON orgs;
CREATE POLICY orgs_tenant_isolation ON orgs
  USING (id = current_setting('app.current_org')::uuid)
  WITH CHECK (id = current_setting('app.current_org')::uuid);

-- users: no RLS (cross-org resource, accessed via org_members join)
-- Access control is at the application layer for users table.

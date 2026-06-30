-- #256: project_id sub-dimension on the cloud data tables (events/sessions/agents).
--
-- project_id defaults to org_id (project == org until cloud API keys carry a project
-- binding). RLS gains a TOLERANT project predicate: the project filter applies only
-- when app.current_project is set, so existing org-only paths keep working unchanged.
-- The org predicate is unchanged, so this can never widen cross-org visibility.
-- Idempotent.

ALTER TABLE events   ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE agents   ADD COLUMN IF NOT EXISTS project_id UUID;

UPDATE events   SET project_id = org_id WHERE project_id IS NULL;
UPDATE sessions SET project_id = org_id WHERE project_id IS NULL;
UPDATE agents   SET project_id = org_id WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_org_project   ON events(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_org_project ON sessions(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_agents_org_project   ON agents(org_id, project_id);

-- Replace the org-only isolation policy (from 003) with org + (tolerant) project
-- for the three data tables. current_setting(..., true) returns NULL when the GUC
-- is unset → the project clause is skipped (org-only). When set, it is enforced.
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['events', 'sessions', 'agents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (' ||
        'org_id = current_setting(''app.current_org'')::uuid AND ' ||
        '(current_setting(''app.current_project'', true) IS NULL OR ' ||
         'project_id = current_setting(''app.current_project'', true)::uuid)' ||
      ') WITH CHECK (' ||
        'org_id = current_setting(''app.current_org'')::uuid AND ' ||
        '(current_setting(''app.current_project'', true) IS NULL OR ' ||
         'project_id = current_setting(''app.current_project'', true)::uuid)' ||
      ')',
      tbl || '_tenant_isolation', tbl
    );
  END LOOP;
END $$;

-- Migration 008: Fix RLS for auth/org operations (F-16, F-17, F-31, F-32)
--
-- Problems:
-- 1. org_members, orgs have RLS requiring app.current_org, but cross-org queries
--    (listUserOrgs, auth flows) need user-scoped access.
-- 2. users table has no RLS — password hashes exposed.
-- 3. _email_tokens table has no RLS — tokens accessible cross-tenant.

-- ═══════════════════════════════════════════
-- Fix org_members: replace strict policy with one that also allows user-scoped access
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS org_members_tenant_isolation ON org_members;
CREATE POLICY org_members_tenant_isolation ON org_members
  USING (
    org_id = current_setting('app.current_org', true)::uuid
    OR user_id = current_setting('app.current_user', true)::uuid
  )
  WITH CHECK (
    org_id = current_setting('app.current_org', true)::uuid
  );

-- ═══════════════════════════════════════════
-- Fix orgs: allow listing orgs user belongs to
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS orgs_tenant_isolation ON orgs;
CREATE POLICY orgs_tenant_isolation ON orgs
  USING (
    id = current_setting('app.current_org', true)::uuid
    OR id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = current_setting('app.current_user', true)::uuid
    )
  )
  WITH CHECK (
    id = current_setting('app.current_org', true)::uuid
  );

-- ═══════════════════════════════════════════
-- Fix org_invitations: also allow user-scoped access for accepting invites
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS org_invitations_tenant_isolation ON org_invitations;
CREATE POLICY org_invitations_tenant_isolation ON org_invitations
  USING (
    org_id = current_setting('app.current_org', true)::uuid
  )
  WITH CHECK (
    org_id = current_setting('app.current_org', true)::uuid
  );

-- ═══════════════════════════════════════════
-- F-31: users table — add RLS restricting access
-- ═══════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_access ON users;
CREATE POLICY users_access ON users
  FOR ALL
  USING (
    -- Own record
    id = current_setting('app.current_user', true)::uuid
    -- Or fellow org member (for team listings)
    OR id IN (
      SELECT om.user_id FROM org_members om
      WHERE om.org_id = current_setting('app.current_org', true)::uuid
    )
  )
  WITH CHECK (
    id = current_setting('app.current_user', true)::uuid
  );

-- ═══════════════════════════════════════════
-- F-32: _email_tokens — add RLS restricting to own tokens
-- ═══════════════════════════════════════════
ALTER TABLE _email_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE _email_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_tokens_access ON _email_tokens;
CREATE POLICY email_tokens_access ON _email_tokens
  FOR ALL
  USING (
    user_id = current_setting('app.current_user', true)::uuid
  )
  WITH CHECK (
    user_id = current_setting('app.current_user', true)::uuid
  );

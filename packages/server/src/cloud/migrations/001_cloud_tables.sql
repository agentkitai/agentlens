-- Migration 001: Cloud-Specific Tables (S-1.1)
-- Creates: orgs, users, org_members, org_invitations, api_keys, usage_records, invoices, audit_log
-- Idempotent: uses IF NOT EXISTS

-- ═══════════════════════════════════════════
-- ORGANIZATIONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  event_quota INTEGER NOT NULL DEFAULT 10000,
  overage_cap_multiplier REAL NOT NULL DEFAULT 2.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orgs_slug ON orgs(slug);
CREATE INDEX IF NOT EXISTS idx_orgs_stripe ON orgs(stripe_customer_id);

-- ═══════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  oauth_provider TEXT,
  oauth_provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users(oauth_provider, oauth_provider_id)
  WHERE oauth_provider IS NOT NULL;

-- ═══════════════════════════════════════════
-- ORG MEMBERSHIPS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_members (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

-- ═══════════════════════════════════════════
-- ORG INVITATIONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member', 'viewer')),
  invited_by UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON org_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON org_invitations(email);

-- ═══════════════════════════════════════════
-- API KEYS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'staging', 'development', 'test')),
  scopes JSONB NOT NULL DEFAULT '["ingest", "query"]',
  rate_limit_override INTEGER,
  created_by UUID NOT NULL REFERENCES users(id),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- ═══════════════════════════════════════════
-- USAGE RECORDS (hourly aggregates)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usage_records (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hour TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  api_key_id UUID REFERENCES api_keys(id),
  PRIMARY KEY (org_id, hour, api_key_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_org_hour ON usage_records(org_id, hour);

-- ═══════════════════════════════════════════
-- INVOICES
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  base_amount_cents INTEGER NOT NULL,
  overage_amount_cents INTEGER NOT NULL DEFAULT 0,
  overage_events INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);

-- ═══════════════════════════════════════════
-- AUDIT LOG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  ip_address INET,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(org_id, action);

-- Revoke UPDATE/DELETE on audit_log for the app role (append-only)
-- This is a best-effort; the app role name may vary per deployment.
-- In production, run: REVOKE UPDATE, DELETE ON audit_log FROM app_role;
DO $$
BEGIN
  -- Create a restricted app role if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentlens_app') THEN
    CREATE ROLE agentlens_app;
  END IF;
  GRANT SELECT, INSERT ON audit_log TO agentlens_app;
  -- Explicitly no UPDATE or DELETE
END
$$;

-- Migration 002: Port Existing Self-Hosted Tables to Postgres (S-1.2)
-- Adds org_id UUID NOT NULL to each tenant-scoped table.
-- Converts SQLite types: TEXT dates → TIMESTAMPTZ, INTEGER booleans → BOOLEAN.
-- Adds composite indexes on (org_id, ...).
-- Idempotent: uses IF NOT EXISTS.

-- ═══════════════════════════════════════════
-- EVENTS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_org_session ON events(org_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_org_type_ts ON events(org_id, event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_org_ts ON events(org_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_org_agent_ts ON events(org_id, agent_id, timestamp);

-- ═══════════════════════════════════════════
-- SESSIONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'error')),
  event_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  llm_call_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  tags JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_agent ON sessions(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_org_started ON sessions(org_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_org_status ON sessions(org_id, status);

-- ═══════════════════════════════════════════
-- AGENTS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  model_override TEXT,
  paused_at TIMESTAMPTZ,
  pause_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);

-- ═══════════════════════════════════════════
-- ALERT RULES
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  condition TEXT NOT NULL,
  threshold REAL NOT NULL,
  window_minutes INTEGER NOT NULL,
  scope JSONB NOT NULL DEFAULT '{}',
  notify_channels JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(org_id);

-- ═══════════════════════════════════════════
-- ALERT HISTORY
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  current_value REAL NOT NULL,
  threshold REAL NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_history_org ON alert_history(org_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id);

-- ═══════════════════════════════════════════
-- LESSONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  importance TEXT NOT NULL DEFAULT 'normal',
  source_session_id TEXT,
  source_event_id TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_org ON lessons(org_id);
CREATE INDEX IF NOT EXISTS idx_lessons_org_agent ON lessons(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_lessons_org_category ON lessons(org_id, category);
CREATE INDEX IF NOT EXISTS idx_lessons_org_importance ON lessons(org_id, importance);

-- ═══════════════════════════════════════════
-- EMBEDDINGS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  embedding BYTEA NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_org ON embeddings(org_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_org_hash ON embeddings(org_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_embeddings_org_source_time ON embeddings(org_id, source_type, created_at);

-- ═══════════════════════════════════════════
-- SESSION SUMMARIES
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  tool_sequence JSONB NOT NULL DEFAULT '[]',
  error_summary TEXT,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_org ON session_summaries(org_id);

-- ═══════════════════════════════════════════
-- SHARING CONFIG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sharing_config (
  org_id UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  human_review_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  pool_endpoint TEXT,
  anonymous_contributor_id TEXT,
  purge_token TEXT,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 50,
  volume_alert_threshold INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════
-- AGENT SHARING CONFIG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_sharing_config (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  categories JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_id)
);

-- ═══════════════════════════════════════════
-- DENY LIST RULES
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS deny_list_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  is_regex BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deny_list_rules_org ON deny_list_rules(org_id);

-- ═══════════════════════════════════════════
-- SHARING AUDIT LOG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sharing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  lesson_id TEXT,
  anonymous_lesson_id TEXT,
  lesson_hash TEXT,
  redaction_findings TEXT,
  query_text TEXT,
  result_ids TEXT,
  pool_endpoint TEXT,
  initiated_by TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sharing_audit_org_ts ON sharing_audit_log(org_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_sharing_audit_org_type ON sharing_audit_log(org_id, event_type);

-- ═══════════════════════════════════════════
-- SHARING REVIEW QUEUE
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sharing_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  original_title TEXT NOT NULL,
  original_content TEXT NOT NULL,
  redacted_title TEXT NOT NULL,
  redacted_content TEXT NOT NULL,
  redaction_findings TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON sharing_review_queue(org_id, status);

-- ═══════════════════════════════════════════
-- ANONYMOUS ID MAP
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS anonymous_id_map (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  anonymous_agent_id TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, agent_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_anon_map_anon_id ON anonymous_id_map(anonymous_agent_id);

-- ═══════════════════════════════════════════
-- CAPABILITY REGISTRY
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS capability_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  custom_type TEXT,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  quality_metrics JSONB NOT NULL DEFAULT '{}',
  estimated_latency_ms INTEGER,
  estimated_cost_usd REAL,
  max_input_bytes INTEGER,
  scope TEXT NOT NULL DEFAULT 'internal',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  accept_delegations BOOLEAN NOT NULL DEFAULT FALSE,
  inbound_rate_limit INTEGER NOT NULL DEFAULT 10,
  outbound_rate_limit INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capability_org_agent ON capability_registry(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_capability_org_task ON capability_registry(org_id, task_type);

-- ═══════════════════════════════════════════
-- DISCOVERY CONFIG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS discovery_config (
  org_id UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  min_trust_threshold INTEGER NOT NULL DEFAULT 60,
  delegation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════
-- DELEGATION LOG
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS delegation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  anonymous_target_id TEXT,
  anonymous_source_id TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  request_size_bytes INTEGER,
  response_size_bytes INTEGER,
  execution_time_ms INTEGER,
  cost_usd REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delegation_org_ts ON delegation_log(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delegation_org_agent ON delegation_log(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_delegation_org_status ON delegation_log(org_id, status);

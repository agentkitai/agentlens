# AgentLens Cloud v0.11.0 — Technical Architecture

## Phase 6: Hosted Multi-Tenant SaaS Platform

**Date:** 2026-02-09
**Author:** Winston (Software Architect, BMAD Pipeline)
**Source:** Phase 6 PRD (John, 2026-02-09)
**Status:** Draft
**Version:** 0.1

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architectural Principles](#2-architectural-principles)
3. [Multi-Tenancy](#3-multi-tenancy)
4. [Data Model](#4-data-model)
5. [Ingestion Pipeline](#5-ingestion-pipeline)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [API Design](#7-api-design)
8. [SDK Changes](#8-sdk-changes)
9. [Dashboard](#9-dashboard)
10. [Usage Metering & Billing](#10-usage-metering--billing)
11. [Data Retention](#11-data-retention)
12. [Migration Tooling](#12-migration-tooling)
13. [Infrastructure](#13-infrastructure)
14. [Security](#14-security)
15. [Scalability](#15-scalability)
16. [Monitoring & Observability](#16-monitoring--observability)
17. [Storage Adapter Pattern](#17-storage-adapter-pattern)
18. [Open Decisions](#18-open-decisions)

---

## 1. System Overview

AgentLens Cloud is a multi-tenant deployment of the existing AgentLens observability platform. The SDK protocol is identical — switching from self-hosted to Cloud is a URL + API key change. Cloud adds multi-tenancy (Postgres + RLS), managed infrastructure (AWS), and a billing layer (Stripe).

### 1.1 High-Level Architecture

```
┌──────────────────┐
│   Python SDK     │  AGENTLENS_URL=https://api.agentlens.ai
│   agentlensai    │  AGENTLENS_API_KEY=al_live_...
└────────┬─────────┘
         │ HTTPS POST /v1/events
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AgentLens Cloud                               │
│                                                                      │
│  ┌────────────────────┐     ┌──────────────┐     ┌───────────────┐  │
│  │   API Gateway       │     │  Redis        │     │  Queue        │  │
│  │   (ALB + ECS)       │────▶│  Streams      │────▶│  Workers      │  │
│  │                     │     │  (ElastiCache)│     │  (ECS Tasks)  │  │
│  │  • Auth (API key)   │     └──────────────┘     └───────┬───────┘  │
│  │  • Rate limiting    │                                   │          │
│  │  • Schema validation│                                   ▼          │
│  │  • Returns 202      │                          ┌───────────────┐  │
│  └────────┬────────────┘                          │  PostgreSQL   │  │
│           │                                       │  (RDS)        │  │
│           │ Dashboard queries                     │               │  │
│           ▼                                       │  • RLS per    │  │
│  ┌────────────────────┐                          │    org_id     │  │
│  │   Dashboard API     │─────────────────────────▶│  • pgvector   │  │
│  │   (ECS Service)     │                          │  • Partitioned│  │
│  └────────┬────────────┘                          └───────────────┘  │
│           │                                                          │
│           ▼                                                          │
│  ┌────────────────────┐     ┌──────────────┐                        │
│  │   Dashboard SPA     │     │  Stripe       │                       │
│  │   (CloudFront + S3) │     │  (Billing)    │                       │
│  │   app.agentlens.ai  │     └──────────────┘                        │
│  └────────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy model | Shared DB + RLS | Simpler ops, proven at scale (Supabase, PostHog), cost-efficient |
| Queue technology | Redis Streams (ElastiCache) | Simple, fast, familiar; SQS as fallback if needed |
| Database | RDS PostgreSQL + pgvector | Managed, PITR, extensions; avoid Neon/Supabase complexity for MVP |
| Codebase strategy | Single codebase, storage adapter | Feature parity guaranteed, one test suite for both backends |
| Compute | ECS Fargate | No server management, autoscaling, cost-effective at MVP scale |

### 1.3 Domain Architecture

| Domain | Purpose |
|--------|---------|
| `api.agentlens.ai` | Ingestion + query API (v1) |
| `app.agentlens.ai` | Dashboard SPA |
| `agentlens.ai` | Marketing / docs site |

---

## 2. Architectural Principles

### P1: Self-Hosted Parity
Cloud is a deployment mode, not a fork. The storage adapter pattern ensures every feature works on both SQLite (self-hosted) and PostgreSQL (Cloud). The same integration test suite runs against both backends in CI.

### P2: Accept Fast, Process Later
The ingestion endpoint returns `202 Accepted` immediately after auth + basic validation. All enrichment (cost calculation, hash chain, usage metering) happens asynchronously via queue workers. This decouples intake latency from processing complexity.

### P3: Isolation at the Data Layer
Tenant isolation is enforced by PostgreSQL RLS, not application logic. Application code sets `app.current_org` on every connection; RLS does the rest. Even a bug in application code cannot leak cross-tenant data.

### P4: No Feature Gating
Every AgentLens feature is available at every tier. Tiers differ only in volume, retention, team size, and support. This preserves the open-source trust signal.

### P5: Zero Lock-In
Data is exportable at any time. The SDK protocol is identical between Cloud and self-hosted. Migration in either direction is a config change + optional data import.

---

## 3. Multi-Tenancy

### 3.1 Strategy: Shared Database with Row-Level Security

All organizations share a single PostgreSQL cluster. Every tenant-scoped table has an `org_id` column. RLS policies enforce that queries only return rows matching the session's current org.

### 3.2 Tenant Context Propagation

```
SDK Request → API Gateway → Extract org_id from API key → Set on request context
                                                              │
Dashboard Request → Auth middleware → Extract org_id from JWT → Set on request context
                                                              │
                                                              ▼
                                                    DB Connection Pool
                                                              │
                                                    SET app.current_org = 'org_xxx'
                                                              │
                                                    Execute query (RLS enforced)
                                                              │
                                                    RESET app.current_org
                                                              │
                                                    Return connection to pool
```

### 3.3 RLS Policy Pattern

Applied to every tenant-scoped table:

```sql
-- Example for the events table
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_tenant_isolation ON events
  USING (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);

-- Force RLS even for table owners (defense in depth)
ALTER TABLE events FORCE ROW LEVEL SECURITY;
```

### 3.4 Connection Pool Discipline

Using PgBouncer (or built-in pool) in **transaction mode**:

1. Acquire connection from pool
2. `SET LOCAL app.current_org = $org_id` (LOCAL = transaction-scoped, auto-resets on commit/rollback)
3. Execute queries within transaction
4. Commit/rollback → `app.current_org` automatically cleared
5. Return connection to pool

`SET LOCAL` is critical — it scopes the setting to the current transaction, preventing leakage on connection reuse. This satisfies FR-43.

### 3.5 Isolation Guarantees

| Layer | Mechanism |
|-------|-----------|
| Database | RLS policies on every tenant-scoped table |
| Application | `SET LOCAL app.current_org` per transaction |
| API Gateway | org_id derived from authenticated API key, never from user input |
| Dashboard | org_id derived from JWT session, never from URL params |
| CI/CD | Automated isolation tests on every deploy (FR-40, FR-41) |

### 3.6 Isolation Test Suite

```typescript
// Runs on every deployment — failure blocks deploy
describe('Tenant Isolation', () => {
  it('Org A cannot read Org B events', async () => {
    await insertEvent(orgA, { type: 'llm_call', ... });
    setOrgContext(orgB);
    const events = await queryEvents();
    expect(events).toHaveLength(0);
  });

  it('Org A cannot write to Org B', async () => {
    setOrgContext(orgA);
    await expect(insertEvent(orgB, { ... })).toReject(); // RLS WITH CHECK blocks it
  });

  it('No org context returns zero rows', async () => {
    // Deliberately don't set app.current_org
    const events = await queryEventsWithoutContext();
    expect(events).toHaveLength(0);
  });

  // ... tests for every tenant-scoped table
});
```

---

## 4. Data Model

### 4.1 New Tables (Cloud-specific)

```sql
-- ═══════════════════════════════════════════
-- ORGANIZATIONS
-- ═══════════════════════════════════════════

CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
    -- { retention_days, redaction_rules[], prompt_masking, overage_cap }
  event_quota INTEGER NOT NULL DEFAULT 10000,
  overage_cap_multiplier REAL NOT NULL DEFAULT 2.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orgs_slug ON orgs(slug);
CREATE INDEX idx_orgs_stripe ON orgs(stripe_customer_id);

-- ═══════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,  -- null for OAuth-only users
  display_name TEXT,
  avatar_url TEXT,
  oauth_provider TEXT,  -- 'google', 'github', null
  oauth_provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_oauth
  ON users(oauth_provider, oauth_provider_id)
  WHERE oauth_provider IS NOT NULL;

-- ═══════════════════════════════════════════
-- ORG MEMBERSHIPS
-- ═══════════════════════════════════════════

CREATE TABLE org_members (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);

-- ═══════════════════════════════════════════
-- ORG INVITATIONS
-- ═══════════════════════════════════════════

CREATE TABLE org_invitations (
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

CREATE INDEX idx_invitations_token ON org_invitations(token);
CREATE INDEX idx_invitations_email ON org_invitations(email);

-- ═══════════════════════════════════════════
-- API KEYS
-- ═══════════════════════════════════════════

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,  -- first 8 chars: 'al_live_' or 'al_test_'
  key_hash TEXT NOT NULL,    -- bcrypt hash of full key
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'staging', 'development', 'test')),
  scopes JSONB NOT NULL DEFAULT '["ingest", "query"]',
  rate_limit_override INTEGER,  -- null = use tier default
  created_by UUID NOT NULL REFERENCES users(id),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_org ON api_keys(org_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- ═══════════════════════════════════════════
-- USAGE RECORDS (hourly aggregates)
-- ═══════════════════════════════════════════

CREATE TABLE usage_records (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hour TIMESTAMPTZ NOT NULL,  -- truncated to hour
  event_count INTEGER NOT NULL DEFAULT 0,
  api_key_id UUID REFERENCES api_keys(id),
  PRIMARY KEY (org_id, hour, api_key_id)
);

CREATE INDEX idx_usage_org_hour ON usage_records(org_id, hour);

-- ═══════════════════════════════════════════
-- INVOICES
-- ═══════════════════════════════════════════

CREATE TABLE invoices (
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

CREATE INDEX idx_invoices_org ON invoices(org_id);

-- ═══════════════════════════════════════════
-- AUDIT LOG
-- ═══════════════════════════════════════════

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  actor_id TEXT NOT NULL,  -- user UUID or api_key prefix
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  ip_address INET,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partitioned by month for retention management
CREATE INDEX idx_audit_org_time ON audit_log(org_id, created_at);
CREATE INDEX idx_audit_action ON audit_log(org_id, action);
```

### 4.2 Existing Tables — Cloud Adaptations

Existing self-hosted tables (`sessions`, `events`, `llm_calls`, `health_scores`, `agents`, `lessons`, `embeddings`, `benchmarks`, `guardrails`, etc.) are migrated to PostgreSQL with these changes:

1. **Add `org_id UUID NOT NULL`** to every table
2. **Enable RLS** with the tenant isolation policy (§3.3)
3. **Replace SQLite types** → Postgres types (TEXT dates → TIMESTAMPTZ, INTEGER booleans → BOOLEAN, etc.)
4. **Add composite indexes** on `(org_id, ...)` for all frequent query patterns

Example migration for `events`:

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (timestamp);

-- Monthly partitions
CREATE TABLE events_2026_01 PARTITION OF events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE events_2026_02 PARTITION OF events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... auto-created by maintenance job

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

CREATE POLICY events_isolation ON events
  USING (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);

CREATE INDEX idx_events_org_session ON events(org_id, session_id);
CREATE INDEX idx_events_org_type_ts ON events(org_id, type, timestamp);
CREATE INDEX idx_events_org_ts ON events(org_id, timestamp);
```

### 4.3 Partitioning Strategy

| Table | Partition Key | Partition Granularity | Rationale |
|-------|--------------|----------------------|-----------|
| `events` | `timestamp` | Monthly | Largest table; enables efficient retention purge by dropping partitions |
| `llm_calls` | `timestamp` | Monthly | High volume, same retention pattern |
| `audit_log` | `created_at` | Monthly | Separate retention from event data |
| `usage_records` | `hour` | Monthly | Billing queries are time-bounded |
| All others | None (simple tables) | — | Not large enough to warrant partitioning |

**Partition maintenance job:** A daily cron creates partitions 3 months ahead and drops partitions older than the longest retention window (Enterprise custom, max 1 year). Retention purge is a `DROP TABLE events_YYYY_MM` — instant, no vacuum needed.

### 4.4 Indexes Summary

All tenant-scoped queries use `org_id` as the first column in composite indexes. Key access patterns:

| Query Pattern | Index |
|--------------|-------|
| Events by session | `(org_id, session_id)` |
| Events by time range | `(org_id, timestamp)` |
| Events by type + time | `(org_id, type, timestamp)` |
| Sessions by agent | `(org_id, agent_id, created_at)` |
| Health scores by agent + time | `(org_id, agent_id, timestamp)` |
| API key lookup (auth) | `(key_prefix)` — not org-scoped, used pre-auth |
| Usage for billing | `(org_id, hour)` |

---

## 5. Ingestion Pipeline

### 5.1 Architecture

```
SDK ──POST /v1/events──▶ ALB ──▶ API Gateway Service (ECS)
                                        │
                                   ┌────┴────┐
                                   │ 1. Auth  │ Validate API key (cache lookup)
                                   │ 2. Rate  │ Check per-key + per-org limits (Redis)
                                   │ 3. Valid │ Schema validation
                                   │ 4. Enrich│ Attach org_id, api_key_id, recv_ts
                                   │ 5. Queue │ XADD to Redis Stream
                                   │ 6. Reply │ Return 202 Accepted
                                   └────┬────┘
                                        │
                                   Redis Stream
                                   (event_ingestion)
                                        │
                              ┌─────────┼─────────┐
                              ▼         ▼         ▼
                          Worker 1  Worker 2  Worker N  (ECS Tasks, consumer group)
                              │
                         ┌────┴────┐
                         │ 1. Cost │ Calculate LLM cost from model + tokens
                         │ 2. Hash │ Verify/compute hash chain
                         │ 3. Usage│ Increment usage_records (batched)
                         │ 4. Write│ Batch INSERT into PostgreSQL
                         │ 5. ACK  │ XACK the stream message
                         └─────────┘
                              │
                         On failure (3 retries):
                              │
                         Dead Letter Stream
                         (event_ingestion_dlq)
```

### 5.2 API Gateway Service

**Responsibilities:**
- API key authentication (§6)
- Rate limiting via Redis (sliding window counter)
- Basic schema validation (required fields, known event types)
- Attach metadata: `org_id`, `api_key_id`, `received_at`
- Publish to Redis Stream
- Return `202 Accepted` with `X-Request-Id`

**Latency target:** < 100ms p95 for the `202` response (NFR-02).

### 5.3 Rate Limiting

Implemented using Redis sliding window counters:

```
Key: rate:{org_id}:{window}       → per-org aggregate
Key: rate:{api_key_id}:{window}   → per-key
```

| Tier | Per-Key Limit | Per-Org Limit |
|------|--------------|---------------|
| Free | 100 events/min | 200 events/min |
| Pro | 5,000 events/min | 10,000 events/min |
| Team | 50,000 events/min | 100,000 events/min |
| Enterprise | Custom | Custom |

When exceeded: `429 Too Many Requests` with `Retry-After` header. SDK handles retry with exponential backoff (existing behavior).

### 5.4 Batch Endpoint

`POST /v1/events/batch` accepts up to 100 events per request (FR-35). Each event is individually validated; valid events are queued, invalid events return per-event errors:

```json
{
  "accepted": 97,
  "rejected": 3,
  "errors": [
    { "index": 12, "error": "missing required field: type" },
    { "index": 45, "error": "unknown event type: foo" },
    { "index": 88, "error": "timestamp in future" }
  ]
}
```

### 5.5 Queue Workers

- **Consumer group:** `ingestion_workers` on Redis Stream `event_ingestion`
- **Batch processing:** Workers read up to 50 messages per `XREADGROUP`, batch-insert into Postgres
- **Retry:** On failure, message is not ACK'd; Redis redelivers after visibility timeout. After 3 failures → move to DLQ stream
- **Usage accounting:** Workers atomically increment `usage_records` via `INSERT ... ON CONFLICT DO UPDATE SET event_count = event_count + $delta`

### 5.6 Backpressure

If Redis Stream length exceeds threshold (configurable, default 100,000 pending messages):
- API Gateway returns `503 Service Unavailable` with `Retry-After: 5`
- CloudWatch alarm fires for ops team
- Auto-scaling policy adds more worker tasks

### 5.7 Dead Letter Queue

Failed events (after 3 retries) are moved to `event_ingestion_dlq` Redis Stream with error metadata. A dashboard page shows DLQ depth and allows manual inspection/replay. DLQ events expire after 7 days.

---

## 6. Authentication & Authorization

### 6.1 Authentication Flows

```
┌─────────────────────────────────────────────────────────┐
│                   Authentication                         │
│                                                          │
│  SDK Requests          Dashboard Requests                │
│  ┌──────────┐         ┌───────────────────┐             │
│  │ API Key  │         │ OAuth (Google/GH)  │             │
│  │ Bearer   │         │ Email/Password     │             │
│  │ al_live_ │         │      ↓             │             │
│  └────┬─────┘         │ Auth.js / NextAuth │             │
│       │               │      ↓             │             │
│       ▼               │ JWT in HTTP-only   │             │
│  API Key Cache        │ secure cookie      │             │
│  (Redis, 60s TTL)     │ (7-day expiry)     │             │
│       │               └────────┬───────────┘             │
│       ▼                        ▼                         │
│  org_id resolved        org_id + user_id + role resolved │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 6.2 API Key Authentication

1. Extract `Authorization: Bearer al_...` from request header
2. Extract key prefix (first 12 chars: `al_live_xxxx` or `al_test_xxxx`)
3. Check Redis cache for prefix → `{ org_id, key_id, scopes, rate_limit, revoked }`
4. If cache miss: query `api_keys` table by prefix, bcrypt-verify full key against hash
5. If valid: cache result with 60s TTL, attach org_id to request context
6. If revoked or invalid: return `401 Unauthorized`

**Key revocation:** On revocation, immediately delete the cache entry. Worst case propagation delay = 60s (cache TTL). FR-18 requires < 5s — we use Redis pub/sub to broadcast revocation events to all API Gateway instances for immediate cache invalidation.

### 6.3 Dashboard Authentication (Auth.js)

- **Providers:** Google OAuth, GitHub OAuth, email/password (credentials provider)
- **Session strategy:** JWT stored in HTTP-only, Secure, SameSite=Strict cookie
- **JWT payload:** `{ sub: user_id, email, name, orgs: [{ org_id, role }] }`
- **Session expiry:** 7 days of inactivity (sliding window)
- **Email verification:** Required for email/password signups before account activation (FR-02)
- **Password reset:** Time-limited token (1 hour), sent via email (FR-52)
- **Password requirements:** Min 8 chars, 1 uppercase, 1 lowercase, 1 digit (FR-53)
- **Brute-force protection:** Lock account after 10 failed attempts in 15 minutes (NFR-22)

### 6.4 RBAC Permission Matrix

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| View dashboard data | ✅ | ✅ | ✅ | ✅ |
| Create/configure sessions, benchmarks | ✅ | ✅ | ✅ | ❌ |
| Manage API keys | ✅ | ✅ | ❌ | ❌ |
| Manage team members | ✅ | ✅ | ❌ | ❌ |
| Manage billing | ✅ | ❌ | ❌ | ❌ |
| Manage org settings | ✅ | ✅ | ❌ | ❌ |
| Delete org | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ |
| Export data | ✅ | ✅ | ❌ | ❌ |

### 6.5 RBAC Middleware

```typescript
function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { orgId, role } = req.session; // from JWT
    if (!allowedRoles.includes(role)) {
      auditLog(orgId, 'permission_denied', { action: req.path, role });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Usage:
router.post('/api/v1/org/:orgId/api-keys', requireRole('owner', 'admin'), createApiKey);
router.delete('/api/v1/org/:orgId', requireRole('owner'), deleteOrg);
```

---

## 7. API Design

All endpoints are versioned under `/v1`. Requests and responses use JSON. Errors follow a consistent format:

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Retry after 5 seconds.",
    "retry_after": 5
  }
}
```

### 7.1 Ingestion API (SDK-facing, API key auth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/v1/events` | Ingest a single event | API key |
| `POST` | `/v1/events/batch` | Ingest up to 100 events | API key |

### 7.2 Query API (SDK + Dashboard, API key or JWT)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/v1/sessions` | List sessions (paginated, filtered) | API key / JWT |
| `GET` | `/v1/sessions/:id` | Get session with events | API key / JWT |
| `GET` | `/v1/events` | Query events (filtered by type, time, session) | API key / JWT |
| `GET` | `/v1/agents` | List agents | API key / JWT |
| `GET` | `/v1/agents/:id` | Agent details + health scores | API key / JWT |
| `GET` | `/v1/analytics/costs` | Cost analytics (time range, model, agent) | API key / JWT |
| `GET` | `/v1/analytics/health` | Health score analytics | API key / JWT |
| `GET` | `/v1/analytics/usage` | Token usage analytics | API key / JWT |
| `GET` | `/v1/benchmarks` | List benchmark experiments | API key / JWT |
| `GET` | `/v1/benchmarks/:id` | Benchmark results | API key / JWT |
| `GET` | `/v1/guardrails` | List guardrail rules | API key / JWT |
| `GET` | `/v1/memory/search` | Semantic memory search | API key / JWT |

### 7.3 Management API (Dashboard, JWT auth)

| Method | Path | Description | Min Role |
|--------|------|-------------|----------|
| `POST` | `/v1/orgs` | Create organization | Any authenticated |
| `GET` | `/v1/orgs` | List user's organizations | Any authenticated |
| `PATCH` | `/v1/orgs/:id` | Update org settings | Admin |
| `DELETE` | `/v1/orgs/:id` | Delete organization | Owner |
| `POST` | `/v1/orgs/:id/transfer` | Transfer ownership | Owner |
| `GET` | `/v1/orgs/:id/members` | List members | Member |
| `POST` | `/v1/orgs/:id/invitations` | Invite member | Admin |
| `PATCH` | `/v1/orgs/:id/members/:userId` | Change member role | Admin |
| `DELETE` | `/v1/orgs/:id/members/:userId` | Remove member | Admin |
| `POST` | `/v1/orgs/:id/api-keys` | Create API key | Admin |
| `GET` | `/v1/orgs/:id/api-keys` | List API keys (prefix only) | Admin |
| `DELETE` | `/v1/orgs/:id/api-keys/:keyId` | Revoke API key | Admin |
| `GET` | `/v1/orgs/:id/audit` | Query audit log | Admin |
| `GET` | `/v1/orgs/:id/audit/export` | Export audit log | Admin |

### 7.4 Billing API (Dashboard, JWT auth)

| Method | Path | Description | Min Role |
|--------|------|-------------|----------|
| `GET` | `/v1/orgs/:id/usage` | Current period usage stats | Member |
| `GET` | `/v1/orgs/:id/usage/history` | Historical usage data | Member |
| `GET` | `/v1/orgs/:id/billing` | Billing overview (plan, invoices) | Owner |
| `POST` | `/v1/orgs/:id/billing/upgrade` | Upgrade plan | Owner |
| `POST` | `/v1/orgs/:id/billing/downgrade` | Downgrade plan (end of period) | Owner |
| `POST` | `/v1/orgs/:id/billing/portal` | Get Stripe customer portal URL | Owner |
| `GET` | `/v1/orgs/:id/invoices` | List invoices | Owner |
| `POST` | `/v1/webhooks/stripe` | Stripe webhook handler | Stripe signature |

### 7.5 Migration API

| Method | Path | Description | Min Role |
|--------|------|-------------|----------|
| `POST` | `/v1/import` | Import JSONL data | Admin |
| `GET` | `/v1/export` | Export org data as JSONL | Admin |

---

## 8. SDK Changes

### 8.1 Scope

Changes to the Python SDK (`agentlensai`) are minimal and fully backward-compatible. No new package, no breaking changes.

### 8.2 Changes

```python
# New convenience initializer (FR-94)
import agentlensai

# Option 1: Explicit cloud mode
agentlensai.init(cloud=True, api_key="al_live_xxx...")

# Option 2: Environment variables (existing pattern, just new vars)
# AGENTLENS_URL=https://api.agentlens.ai
# AGENTLENS_API_KEY=al_live_xxx...
agentlensai.init()

# Option 3: Explicit URL (existing behavior, unchanged)
agentlensai.init(server_url="https://api.agentlens.ai", api_key="al_live_xxx...")
```

### 8.3 Implementation Details

```python
# agentlensai/config.py

CLOUD_URL = "https://api.agentlens.ai"

class Config:
    def __init__(
        self,
        server_url: str | None = None,
        api_key: str | None = None,
        cloud: bool = False,
        **kwargs,
    ):
        # Resolve API key: param > env var
        self.api_key = api_key or os.environ.get("AGENTLENS_API_KEY")

        # Resolve server URL: explicit > cloud flag > env var > default
        if server_url:
            self.server_url = server_url
        elif cloud:
            self.server_url = CLOUD_URL
        else:
            self.server_url = os.environ.get("AGENTLENS_URL", "http://localhost:3000")

        # ... existing config ...
```

```python
# agentlensai/transport.py — modifications

class HttpTransport:
    def _build_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def send_event(self, event: dict) -> None:
        try:
            resp = await self._post("/v1/events", event)
            if resp.status == 401:
                logger.error("Authentication failed. Check your API key (prefix: %s...)",
                             self.config.api_key[:12] if self.config.api_key else "none")
                # FR-97: never log the full key
            elif resp.status == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                await self._buffer_and_retry(event, retry_after)
            elif resp.status == 402:
                logger.warning("Event quota exceeded for your plan. Event buffered locally.")
                self._buffer_locally(event)
            # 202 Accepted = success, 503 = backpressure → retry
        except ConnectionError:
            # Existing graceful degradation: buffer locally, retry with backoff (FR-95)
            self._buffer_locally(event)
```

### 8.4 Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| No `api_key`, no `cloud` flag | Connects to `localhost:3000` as before |
| `api_key` set, no URL | Connects to `localhost:3000` with auth header (self-hosted with auth) |
| `cloud=True` + `api_key` | Connects to `https://api.agentlens.ai` with auth header |
| `server_url` + `api_key` | Connects to custom URL with auth header |
| Cloud unreachable | Buffers locally, retries with exponential backoff (existing) |

---

## 9. Dashboard

### 9.1 Architecture

```
┌──────────────────────────────────────────────────┐
│   Dashboard SPA (React + Tailwind)                │
│   Hosted: S3 + CloudFront (app.agentlens.ai)     │
│                                                   │
│   ┌─────────────────────────────────────────────┐ │
│   │  Auth Layer (Auth.js)                        │ │
│   │  Login / Signup / OAuth / Password Reset     │ │
│   └─────────────────────────────────────────────┘ │
│                                                   │
│   ┌──────────┐  ┌────────────────────────────┐   │
│   │ Org      │  │  Existing Feature Pages     │   │
│   │ Switcher │  │  (reused from self-hosted)  │   │
│   │          │  │                             │   │
│   │ [Acme ▼] │  │  • Session Timeline         │   │
│   │  Acme    │  │  • LLM Analytics            │   │
│   │  Beta Co │  │  • Health Scores            │   │
│   │          │  │  • Session Replay           │   │
│   └──────────┘  │  • Benchmarking             │   │
│                 │  • Guardrails               │   │
│   ┌──────────┐  │  • Agent Memory             │   │
│   │ NEW Pages│  │  • Cost Dashboard           │   │
│   │          │  │                             │   │
│   │ Team Mgmt│  └────────────────────────────┘   │
│   │ API Keys │                                    │
│   │ Usage    │                                    │
│   │ Billing  │                                    │
│   │ Audit Log│                                    │
│   │ Settings │                                    │
│   └──────────┘                                    │
└──────────────────────────────────────────────────┘
```

### 9.2 Org Switcher

Global component in the sidebar/header. Switching orgs:
1. Updates the active `org_id` in client state (React context)
2. Triggers re-fetch of all data scoped to the new org
3. Updates the JWT if needed (or uses a separate org context cookie)

### 9.3 New Dashboard Pages

| Page | Description | Access |
|------|-------------|--------|
| **Team Management** | List members, invite by email, change roles, remove members | Admin+ |
| **API Keys** | Create keys (show once), list with prefix/name/last_used, revoke | Admin+ |
| **Usage Dashboard** | Events consumed vs quota, usage graph over time, projected usage, cost breakdown | Member+ |
| **Billing** | Current plan, upgrade/downgrade, payment method (Stripe portal), invoices | Owner |
| **Audit Log** | Filterable log of auth events, key operations, settings changes | Admin+ |
| **Org Settings** | Name, slug, retention config, redaction rules, prompt masking toggle, overage cap | Admin+ |

### 9.4 Component Reuse

All existing dashboard components (session timeline, analytics charts, health score displays, replay viewer, benchmark UI, guardrail config, memory search) are reused as-is. The only change is that their data-fetching hooks include the active `org_id` in API calls, and the backend enforces RLS.

### 9.5 Dashboard Deployment

- **Build:** React SPA compiled to static assets
- **Hosting:** S3 bucket behind CloudFront CDN
- **API calls:** Dashboard → `api.agentlens.ai` (same API service, authenticated via JWT cookie)
- **CORS:** `app.agentlens.ai` allowed on API; credentials included

---

## 10. Usage Metering & Billing

### 10.1 Metering Architecture

```
Event ingested → Queue Worker → INCREMENT usage_records(org_id, hour)
                                         │
                                  (batched: accumulate in memory,
                                   flush every 10s or 100 events)
                                         │
                                         ▼
                                  usage_records table
                                         │
                            ┌─────────────┼──────────────┐
                            ▼             ▼              ▼
                     Dashboard        Quota Check     Stripe Sync
                     (real-time       (on ingestion:   (hourly cron:
                      usage view)      is org over?)    report usage)
```

### 10.2 Quota Enforcement

On every ingestion request, after API key auth:

```
current_month_usage = Redis counter: usage:{org_id}:{YYYY-MM}
                      (synced from usage_records every minute)

if tier == 'free' AND current_month_usage >= 10000:
    return 402 Payment Required { "error": "quota_exceeded", "upgrade_url": "..." }

if tier in ('pro', 'team') AND current_month_usage >= quota:
    if overage_cap_reached:
        return 402 Payment Required
    else:
        accept (will be billed as overage)
```

### 10.3 Warning Notifications

At 80% quota (FR-58):
- Dashboard banner: "You've used 80% of your monthly event quota"
- Email to org Owner

At 100% quota (Pro/Team, continuing as overage):
- Dashboard banner: "You're now incurring overage charges"
- Email to org Owner with current overage amount

### 10.4 Stripe Integration

```
┌─────────────────────────────────────────────────┐
│                Stripe Integration                │
│                                                  │
│  Signup → Create Stripe Customer                 │
│  Upgrade → Create Subscription (price_id)        │
│  Monthly → Report Usage (metered billing)        │
│  Overages → Usage record on metered price item   │
│  Portal → Stripe Customer Portal (payment, etc.) │
│  Webhooks → invoice.paid, subscription.updated,  │
│             customer.subscription.deleted         │
└─────────────────────────────────────────────────┘
```

**Stripe objects:**
- **Customer** = Org (1:1 mapping)
- **Subscription** = Plan tier (one per org)
- **Price** (flat): Base subscription fee ($29/mo or $99/mo)
- **Price** (metered): Overage events, reported hourly via `stripe.subscriptionItems.createUsageRecord()`
- **Customer Portal**: Used for payment method management, invoice history

### 10.5 Billing Events

| Event | Stripe API Call |
|-------|----------------|
| Org created (Free) | `stripe.customers.create()` |
| Upgrade to Pro | `stripe.subscriptions.create({ items: [base_price, overage_price] })` |
| Downgrade | `stripe.subscriptions.update({ cancel_at_period_end: true })` + schedule new |
| Hourly usage sync | `stripe.subscriptionItems.createUsageRecord({ quantity: overage_events })` |
| Annual billing | `stripe.subscriptions.create({ ... , billing_cycle_anchor: ... })` |

---

## 11. Data Retention

### 11.1 Per-Tier Policies

| Tier | Event Retention | Audit Log Retention |
|------|----------------|-------------------|
| Free | 7 days | 90 days |
| Pro | 30 days | 90 days |
| Team | 90 days | 1 year |
| Enterprise | Custom | Custom |

### 11.2 Retention Purge Job

**Schedule:** Daily at 03:00 UTC

```
For each org:
  retention_days = org.settings.retention_days (from tier)
  cutoff = now() - retention_days

  For each monthly partition of events:
    if partition.max_timestamp < cutoff:
      -- Entire partition is expired: DROP it (instant)
      DROP TABLE events_YYYY_MM;
    else if partition contains some expired rows:
      -- Partial purge within the partition
      DELETE FROM events WHERE org_id = :org_id AND timestamp < :cutoff;

  -- Same pattern for llm_calls, health_scores, etc.
```

Partition-based retention (dropping entire monthly partitions) is the primary mechanism. Partial deletes within a partition handle the edge case at the retention boundary.

### 11.3 Org Deletion

When an org is deleted (FR-09, FR-71):

1. Mark org as `deleted` (soft delete)
2. Enqueue async deletion job
3. Job deletes all data in order: events → sessions → agents → api_keys → members → usage_records → audit_log → org
4. Confirm deletion within 24 hours
5. Stripe: cancel subscription, delete customer

### 11.4 Export Before Delete

The dashboard prompts org owners to export data before deletion. The export endpoint (§7.5) is always available. Deletion requires explicit confirmation ("type org name to confirm").

---

## 12. Migration Tooling

### 12.1 Data Format: JSONL

```jsonl
{"_type":"session","id":"abc","agent_id":"agent1","created_at":"2026-01-15T10:00:00Z",...}
{"_type":"event","id":"def","session_id":"abc","type":"llm_call","timestamp":"2026-01-15T10:00:01Z","data":{...}}
{"_type":"event","id":"ghi","session_id":"abc","type":"tool_call","timestamp":"2026-01-15T10:00:02Z","data":{...}}
{"_type":"health_score","id":"jkl","agent_id":"agent1","timestamp":"2026-01-15T11:00:00Z",...}
```

Each line is a self-contained JSON object with a `_type` discriminator. Sessions come before their events (dependency order).

### 12.2 Self-Hosted → Cloud

```bash
# 1. Export from self-hosted SQLite
npx @agentlensai/server export --format jsonl > agentlens-export.jsonl

# 2. Import to Cloud
curl -X POST https://api.agentlens.ai/v1/import \
  -H "Authorization: Bearer al_live_xxx..." \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @agentlens-export.jsonl

# 3. Switch SDK config
export AGENTLENS_URL=https://api.agentlens.ai
export AGENTLENS_API_KEY=al_live_xxx...
```

### 12.3 Cloud → Self-Hosted

```bash
# 1. Export from Cloud
curl -H "Authorization: Bearer al_live_xxx..." \
  https://api.agentlens.ai/v1/export?format=jsonl > cloud-export.jsonl

# 2. Import to self-hosted
npx @agentlensai/server import --file cloud-export.jsonl

# 3. Switch SDK config back
export AGENTLENS_URL=http://localhost:3000
unset AGENTLENS_API_KEY
```

### 12.4 Import Behavior

- **Streaming:** Import endpoint accepts chunked transfer encoding for large datasets (FR-80)
- **Rate limited:** Max 10,000 records/minute per org (FR-81)
- **Idempotent:** Records with existing IDs are skipped (not overwritten)
- **Error handling:** Invalid records are skipped; response includes error count and details
- **ID preservation:** Event IDs, timestamps, session associations are all preserved (FR-79)

---

## 13. Infrastructure

### 13.1 AWS Architecture

```
                    ┌─────────────┐
                    │  Route 53   │
                    │  DNS        │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
      ┌───────────────┐        ┌───────────────┐
      │  CloudFront   │        │  ALB           │
      │  (Dashboard)  │        │  (API)         │
      │  app.agentlens│        │  api.agentlens │
      │       ↓       │        │       ↓        │
      │  S3 Bucket    │        │  Target Groups │
      └───────────────┘        └───────┬────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼                         ▼
                  ┌───────────────┐        ┌───────────────┐
                  │  ECS Fargate  │        │  ECS Fargate  │
                  │  API Service  │        │  Worker Tasks │
                  │  (2-10 tasks) │        │  (2-20 tasks) │
                  └───────┬───────┘        └───────┬───────┘
                          │                         │
                  ┌───────┴─────────────────────────┘
                  │
          ┌───────┴────────┐
          ▼                ▼
  ┌───────────────┐  ┌───────────────┐
  │  ElastiCache  │  │  RDS Postgres │
  │  Redis 7      │  │  (Multi-AZ)   │
  │  (Streams +   │  │  + pgvector   │
  │   Cache)      │  │               │
  └───────────────┘  │  Primary      │
                     │  + Read       │
                     │    Replica    │
                     └───────────────┘
```

### 13.2 Service Inventory

| Service | AWS Resource | Config |
|---------|-------------|--------|
| API Gateway | ECS Fargate Service | 2–10 tasks, 0.5 vCPU / 1GB each, ALB health checks |
| Queue Workers | ECS Fargate Tasks | 2–20 tasks, 0.5 vCPU / 1GB each, autoscale on queue depth |
| Database | RDS PostgreSQL 16 | db.r6g.large (Multi-AZ), 100GB gp3, pgvector extension |
| Read Replica | RDS Read Replica | db.r6g.large, dashboard queries routed here |
| Cache/Queue | ElastiCache Redis 7 | cache.r6g.large, cluster mode disabled, 1 replica |
| Dashboard CDN | CloudFront + S3 | Global edge, gzip, cache 1h for assets |
| DNS | Route 53 | Hosted zone for agentlens.ai |
| Load Balancer | ALB | HTTPS termination, WAF integration |
| Secrets | AWS Secrets Manager | DB credentials, Stripe keys, OAuth secrets |
| Logs | CloudWatch Logs | All ECS task logs, 30-day retention |

### 13.3 Infrastructure as Code

**Tool:** AWS CDK (TypeScript) — matches the existing codebase language.

```
infra/
├── bin/
│   └── agentlens-cloud.ts        # CDK app entry point
├── lib/
│   ├── vpc-stack.ts               # VPC, subnets, security groups
│   ├── database-stack.ts          # RDS, ElastiCache
│   ├── compute-stack.ts           # ECS cluster, services, tasks
│   ├── cdn-stack.ts               # CloudFront, S3
│   ├── dns-stack.ts               # Route 53
│   └── monitoring-stack.ts        # CloudWatch dashboards, alarms
├── cdk.json
└── package.json
```

### 13.4 Environments

| Environment | Purpose | Database | Scale |
|-------------|---------|----------|-------|
| `dev` | Development | Single-AZ RDS (t4g.small) | 1 API task, 1 worker |
| `staging` | Pre-production | Single-AZ RDS (t4g.medium) | 2 API tasks, 2 workers |
| `production` | Live | Multi-AZ RDS (r6g.large) | 2–10 API, 2–20 workers |

### 13.5 CI/CD Pipeline

```
GitHub Push → GitHub Actions:
  1. Lint + type check
  2. Unit tests
  3. Integration tests (SQLite)
  4. Integration tests (PostgreSQL — Docker)
  5. Tenant isolation tests (PostgreSQL)
  6. Build Docker images → ECR
  7. CDK diff (staging)
  8. Deploy staging → smoke tests
  9. Manual approval
  10. Deploy production
  11. Post-deploy tenant isolation tests (production)
```

---

## 14. Security

### 14.1 Encryption

| Layer | Mechanism |
|-------|-----------|
| In transit (external) | TLS 1.3 via ALB + CloudFront |
| In transit (internal) | TLS between ECS tasks and RDS/ElastiCache |
| At rest (database) | AES-256, RDS default encryption |
| At rest (S3) | SSE-S3 |
| At rest (ElastiCache) | Encryption at rest enabled |
| API keys | bcrypt hashed, never stored in plaintext |
| Secrets | AWS Secrets Manager, rotated quarterly |

### 14.2 Network Security

- VPC with public subnets (ALB only) and private subnets (ECS, RDS, Redis)
- Security groups: ALB → ECS (port 8080), ECS → RDS (5432), ECS → Redis (6379)
- No direct internet access from private subnets (NAT gateway for outbound)
- WAF on ALB: rate limiting, SQL injection protection, known-bad IP blocking

### 14.3 Application Security

| Control | Implementation |
|---------|---------------|
| CSRF | CSRF tokens on all state-changing dashboard endpoints (NFR-19) |
| CSP | Content-Security-Policy headers on dashboard (NFR-20) |
| XSS | React's built-in escaping + CSP |
| SQL Injection | Parameterized queries only (FR-42); no raw SQL interpolation |
| Session fixation | New session ID on login |
| Cookie security | HTTP-only, Secure, SameSite=Strict |

### 14.4 Audit Logging

All security-relevant events are logged to the `audit_log` table (§4.1):

- Authentication: login, logout, failed login, password reset
- API key: create, revoke, use (first use per day)
- Members: invite, join, role change, remove
- Settings: plan change, retention change, redaction config
- Data: export, import, org deletion
- Admin: ownership transfer

Audit logs are append-only (PC-18). No user can modify or delete entries. Retention: 90 days minimum, up to 1 year for Enterprise.

### 14.5 Pre-Launch Security

- Penetration testing focused on tenant isolation bypass (NFR-21)
- Dependency vulnerability scanning (Snyk / GitHub Dependabot)
- SAST in CI pipeline
- Secrets scanning (prevent keys in code)

---

## 15. Scalability

### 15.1 Horizontal Scaling Strategy

| Component | Scaling Trigger | Scale Range |
|-----------|----------------|-------------|
| API Gateway (ECS) | CPU > 60% or request count | 2–10 tasks |
| Queue Workers (ECS) | Redis Stream pending messages > 10K | 2–20 tasks |
| Read Replica | Dashboard query latency > 300ms | Add replicas |
| Redis | Memory > 70% | Upgrade instance size |
| RDS Primary | CPU > 70% or connections > 80% | Upgrade instance size |

### 15.2 Connection Pooling

```
ECS Tasks → PgBouncer (sidecar) → RDS
            ├── transaction mode
            ├── max 20 connections per task
            └── total pool: ~200 connections (10 API + 20 workers × 20 ÷ 2 sharing)
```

PgBouncer runs as a sidecar container in each ECS task. Transaction pooling mode allows `SET LOCAL` for RLS context while maximizing connection reuse. RDS max_connections = 500 (r6g.large default), leaving headroom.

### 15.3 Read Replica Routing

- **Dashboard queries** (analytics, session lists, health scores) → Read Replica
- **Ingestion writes** → Primary
- **Real-time queries** (session detail shortly after ingestion) → Primary (to avoid replication lag)

Application-level routing based on query type. No proxy needed — the storage adapter handles routing.

### 15.4 Caching Strategy

| Data | Cache | TTL | Invalidation |
|------|-------|-----|-------------|
| API key → org_id mapping | Redis | 60s | Pub/sub on revocation |
| Org plan/quota metadata | Redis | 5 min | On plan change |
| Monthly usage counter | Redis | Real-time | Increment on ingest |
| Dashboard analytics (expensive queries) | Redis | 1 min | Time-based expiry |
| Static assets (dashboard) | CloudFront | 1 hour | Deploy invalidation |

### 15.5 Capacity Planning (MVP)

**Target:** 10,000 events/sec sustained (NFR-06)

| Resource | Calculation |
|----------|------------|
| API Gateway | 10K req/s ÷ ~2K req/s per task = 5 tasks |
| Redis Streams | Single node handles 100K+ ops/s — not a bottleneck |
| Queue Workers | 10K events/s, batch-50 = 200 batches/s ÷ ~50 batches/s per worker = 4 workers |
| RDS writes | 200 batch inserts/s × 50 rows = 10K rows/s — within r6g.large capacity |
| Storage | 10K events × 2KB avg × 86400s = ~1.7TB/day at max sustained (unlikely) |

At realistic MVP load (1K events/s average), 2 API tasks + 2 workers are sufficient.

---

## 16. Monitoring & Observability

### 16.1 SLOs

| SLO | Target | Measurement |
|-----|--------|------------|
| Ingestion endpoint uptime | 99.9% | Synthetic health checks every 30s |
| Dashboard uptime | 99.5% | Synthetic page load every 60s |
| Ingestion API latency (202 response) | < 100ms p95 | ALB metrics |
| End-to-end ingestion latency | < 2s p95 | Custom metric (recv_ts → write_ts) |
| Dashboard query latency | < 500ms p95 | Application metrics |

### 16.2 CloudWatch Dashboards

**Operational Dashboard:**
- Request rate (events/sec) by tier
- Error rate (4xx, 5xx)
- Queue depth (pending messages)
- Worker throughput (events processed/sec)
- RDS CPU, connections, IOPS
- Redis memory, operations/sec
- ECS task count, CPU, memory

**Business Dashboard:**
- Active orgs (daily)
- Events ingested (hourly)
- Signups (daily)
- Tier distribution
- Usage by tier (% of quota consumed)

### 16.3 Alarms

| Alarm | Threshold | Action |
|-------|-----------|--------|
| API 5xx rate > 1% | 5 min sustained | PagerDuty |
| Queue depth > 50K | — | Auto-scale workers + alert |
| Queue depth > 100K | — | Return 503 (backpressure) + PagerDuty |
| RDS CPU > 80% | 10 min sustained | Alert |
| RDS storage < 20% free | — | Alert |
| DLQ depth > 100 | — | Alert |
| API latency p95 > 200ms | 5 min sustained | Alert |
| Ingestion e2e latency p95 > 5s | 5 min sustained | PagerDuty |
| Tenant isolation test failure | Any | Block deploy + PagerDuty |

### 16.4 Dogfooding

AgentLens Cloud monitors itself using AgentLens. The Cloud instance has a dedicated org that receives observability events from the platform's own internal operations (API requests, worker processing, etc.). This validates the product at real scale.

---

## 17. Storage Adapter Pattern

### 17.1 Design

The server codebase uses a storage adapter interface. Both SQLite (self-hosted) and PostgreSQL (Cloud) implement the same interface. Feature code never touches the database directly.

```typescript
// packages/server/src/storage/adapter.ts

export interface StorageAdapter {
  // Events
  insertEvents(orgId: string, events: Event[]): Promise<void>;
  queryEvents(orgId: string, filter: EventFilter): Promise<Event[]>;
  getEventsBySession(orgId: string, sessionId: string): Promise<Event[]>;

  // Sessions
  upsertSession(orgId: string, session: Session): Promise<void>;
  getSessions(orgId: string, filter: SessionFilter): Promise<Session[]>;
  getSession(orgId: string, sessionId: string): Promise<Session | null>;

  // Agents
  upsertAgent(orgId: string, agent: Agent): Promise<void>;
  getAgents(orgId: string): Promise<Agent[]>;

  // Health Scores
  insertHealthScore(orgId: string, score: HealthScore): Promise<void>;
  getHealthScores(orgId: string, filter: HealthScoreFilter): Promise<HealthScore[]>;

  // Analytics
  getCostAnalytics(orgId: string, filter: TimeRangeFilter): Promise<CostAnalytics>;
  getUsageAnalytics(orgId: string, filter: TimeRangeFilter): Promise<UsageAnalytics>;

  // Benchmarks
  createBenchmark(orgId: string, benchmark: Benchmark): Promise<void>;
  getBenchmarks(orgId: string): Promise<Benchmark[]>;

  // Guardrails
  getGuardrails(orgId: string): Promise<Guardrail[]>;
  upsertGuardrail(orgId: string, guardrail: Guardrail): Promise<void>;

  // Memory (Phase 3)
  storeMemory(orgId: string, entry: MemoryEntry): Promise<void>;
  searchMemory(orgId: string, query: string, limit: number): Promise<MemoryEntry[]>;

  // Community/Discovery (Phase 4) — same interface, org-scoped
  // ...
}
```

### 17.2 Implementations

```typescript
// SQLite (self-hosted): orgId is ignored (single tenant) or defaults to 'local'
export class SqliteStorageAdapter implements StorageAdapter { ... }

// PostgreSQL (Cloud): orgId used for SET LOCAL app.current_org
export class PostgresStorageAdapter implements StorageAdapter { ... }
```

### 17.3 CI Verification

The same integration test suite runs against both adapters:

```typescript
// test/storage-adapter.test.ts
describe.each([
  ['sqlite', createSqliteAdapter],
  ['postgres', createPostgresAdapter],
])('StorageAdapter (%s)', (name, createAdapter) => {
  it('inserts and queries events', async () => { ... });
  it('scopes sessions to org', async () => { ... });
  // ... all feature tests
});
```

---

## 18. Open Decisions

| # | Decision | Options | Recommendation | Status |
|---|----------|---------|---------------|--------|
| OD-1 | PgBouncer vs. application-level pool | PgBouncer sidecar vs. node-postgres pool | PgBouncer sidecar — proven, handles `SET LOCAL` well | Proposed |
| OD-2 | Auth.js vs. custom auth | Auth.js (NextAuth) vs. Lucia vs. custom | Auth.js — widely adopted, supports Google/GitHub/credentials | Proposed |
| OD-3 | Dashboard: SSR vs. SPA | Next.js SSR vs. Vite SPA | SPA (Vite) — matches existing dashboard, simpler deployment to S3+CloudFront | Proposed |
| OD-4 | Partition management | Manual vs. pg_partman extension | pg_partman — automates creation/dropping of partitions | Proposed |
| OD-5 | CDK vs. Terraform | AWS CDK (TypeScript) vs. Terraform | CDK — same language as codebase, native AWS support | Proposed |
| OD-6 | Domain availability | agentlens.ai, agentlens.dev, agentlens.io | Needs resolution — check availability | Blocked (Amit) |
| OD-7 | Legal entity | Personal vs. LLC vs. incorporated | Needs resolution for Stripe, ToS, DPA | Blocked (Amit) |

---

## Appendix A: Requirement Traceability

| Architecture Section | PRD Requirements Covered |
|---------------------|------------------------|
| §3 Multi-Tenancy | FR-36 through FR-44 |
| §4 Data Model | FR-01–FR-12 (orgs/users), FR-13–FR-22 (API keys), FR-54 (usage), FR-73 (partitioning) |
| §5 Ingestion Pipeline | FR-23–FR-35 |
| §6 Auth & Authz | FR-01–FR-02, FR-45–FR-53, NFR-15–NFR-22 |
| §7 API Design | NFR-28, NFR-30 |
| §8 SDK Changes | FR-93–FR-97 |
| §9 Dashboard | FR-07, FR-45–FR-53, FR-82–FR-92, NFR-29 |
| §10 Billing | FR-54–FR-66 |
| §11 Data Retention | FR-67–FR-73 |
| §12 Migration | FR-74–FR-81 |
| §13 Infrastructure | NFR-13 |
| §14 Security | NFR-15–NFR-22, PC-01–PC-18 |
| §15 Scalability | NFR-06–NFR-09 |
| §16 Monitoring | NFR-10–NFR-14 |
| §17 Storage Adapter | FR-92 (OQ-1) |

---

*End of architecture document. Covers 15 architectural sections mapping to 97 functional requirements, 30 non-functional requirements, and 18 privacy/compliance requirements from the PRD.*

# AgentLens Cloud v0.11.0 — Sprint Plan

## Phase 6: Hosted Multi-Tenant SaaS Platform

**Date:** 2026-02-09
**Author:** Bob (Scrum Master, BMAD Pipeline)
**Source:** Phase 6 PRD (97 FRs, 30 NFRs), Architecture Doc, Product Brief
**Version:** 1.0

---

## Execution Strategy

48 stories across 9 epics, organized into **12 batches**. Four tracks run after foundations:

- **Track A (Data Layer):** Postgres schema → RLS → query adapter → retention
- **Track B (Auth & API):** OAuth + users → API keys → RBAC → audit
- **Track C (Ingestion):** Queue setup → gateway → workers → backpressure → SDK
- **Track D (Billing & Dashboard):** Stripe integration → usage metering → dashboard pages → docs

**Isolation-first ordering enforced:** Postgres schema + RLS (Epic 1) and Auth (Epic 2) MUST complete before any ingestion or query work.

**Estimated total duration:** 10–12 weeks with parallel execution across tracks.

---

## Epic Breakdown

| Epic | Name | Stories | Critical Path? |
|------|------|---------|---------------|
| E1 | Cloud Infrastructure Foundation | 6 | ✅ Yes — everything depends on this |
| E2 | Authentication & API Keys | 6 | ✅ Yes — ingestion needs API key auth |
| E3 | Ingestion Pipeline | 6 | ✅ Yes — core value path |
| E4 | Multi-Tenant Query Layer | 5 | Depends on E1 |
| E5 | SDK Cloud Mode | 4 | Depends on E2 + E3 |
| E6 | Usage Metering & Billing | 6 | Depends on E3 |
| E7 | Dashboard Multi-Tenancy | 7 | Depends on E2 + E4 |
| E8 | Data Retention & Migration | 4 | Depends on E1 + E4 |
| E9 | Docs & Publishing | 4 | Depends on all above |

**Total stories: 48**

---

## Critical Path Diagram

```
B1: E1.1–E1.3 (Postgres schema, RLS, org/user tables)
 │
 ├───────────────────────────────┐
 ▼                               ▼
B2: E1.4–E1.6 (Partitioning,   B2: E2.1–E2.2 (OAuth, user registration)
    connection pool, indexes)        │
 │                               ▼
 ▼                              B3: E2.3–E2.4 (API key CRUD, JWT sessions)
B3: E4.1–E4.2 (Storage              │
    adapter, session/event queries)  ▼
 │                              B4: E2.5–E2.6 (RBAC middleware, audit log)
 ▼                               │
B4: E4.3–E4.5 (Analytics,       ├───────────────────┐
    search, CI dual-backend)     ▼                   ▼
 │                              B5: E3.1–E3.2       B5: E7.1–E7.2
 │                              (Redis streams,      (Org switcher,
 │                               API gateway)         team mgmt)
 │                               │                   │
 │                               ▼                   ▼
 │                              B6: E3.3–E3.4       B6: E7.3–E7.4
 │                              (Batch writer,       (API key page,
 │                               rate limiting)       usage page)
 │                               │                   │
 │                               ▼                   ▼
 │                              B7: E3.5–E3.6       B7: E6.1–E6.3
 │                              (Backpressure,       (Stripe setup,
 │                               DLQ + monitoring)    metering, quotas)
 │                               │                   │
 │                               ▼                   ▼
 │                              B8: E5.1–E5.4       B8: E6.4–E6.6
 │                              (SDK cloud mode,     (Invoicing, annual,
 │                               retry, tests)        overage)
 │                                                   │
 ▼                                                   ▼
B9: E8.1–E8.2 (Retention jobs, partition mgmt)      B9: E7.5–E7.7
 │                                                   (Billing page,
 ▼                                                    audit page,
B10: E8.3–E8.4 (Export/import, migration CLI)         onboarding)
 │                                                   │
 └───────────────────────────────────────────────────┘
                        │
                        ▼
B11: E9.1–E9.2 (Cloud setup guide, SDK migration guide)
                        │
                        ▼
B12: E9.3–E9.4 (API reference, pricing page)
```

---

## Stories

### Epic 1: Cloud Infrastructure Foundation

#### S-1.1: PostgreSQL Schema — Cloud-Specific Tables
**Description:** Create the cloud-specific Postgres tables: `orgs`, `users`, `org_members`, `org_invitations`, `api_keys`, `usage_records`, `invoices`, `audit_log`. Include all constraints, indexes, and CHECK constraints per architecture doc §4.1.
**Acceptance Criteria:**
- All 8 tables created with correct types, constraints, and indexes
- `orgs.plan` CHECK constraint covers free/pro/team/enterprise
- `org_members.role` CHECK constraint covers owner/admin/member/viewer
- `api_keys.key_hash` column is NOT NULL; no plaintext key storage
- `audit_log` is append-only (no UPDATE/DELETE grants for app role)
- Migration script runs idempotently (re-run safe)
**Estimated Tests:** 12
**Dependencies:** None

#### S-1.2: PostgreSQL Schema — Migrate Existing Tables
**Description:** Port all existing self-hosted tables (`sessions`, `events`, `llm_calls`, `health_scores`, `agents`, `lessons`, `embeddings`, `benchmarks`, `guardrails`) to Postgres. Add `org_id UUID NOT NULL` to each. Convert SQLite types (TEXT dates → TIMESTAMPTZ, INTEGER booleans → BOOLEAN). Add composite indexes on `(org_id, ...)`.
**Acceptance Criteria:**
- All existing tables have Postgres equivalents with `org_id` column
- Type conversions are correct (TIMESTAMPTZ, BOOLEAN, UUID, JSONB)
- Composite indexes exist for all frequent query patterns per architecture §4.4
- Migration script runs clean on empty database
**Estimated Tests:** 15
**Dependencies:** S-1.1

#### S-1.3: Row-Level Security Policies
**Description:** Enable RLS on every tenant-scoped table. Create USING/WITH CHECK policies keyed on `current_setting('app.current_org')::uuid`. Force RLS even for table owners. Write isolation test suite verifying: (a) Org A can't read Org B, (b) Org A can't write to Org B, (c) no org context → zero rows.
**Acceptance Criteria:**
- RLS enabled and forced on all tenant-scoped tables (FR-36, FR-38)
- Isolation tests pass for every tenant-scoped table (FR-40)
- Queries without `app.current_org` set return 0 rows
- Cross-org INSERT blocked by WITH CHECK policy
- Tests run in CI and block deployment on failure (FR-41)
**Estimated Tests:** 24 (3 per table × 8 tables minimum)
**Dependencies:** S-1.1, S-1.2

#### S-1.4: Table Partitioning
**Description:** Partition `events` and `llm_calls` by `timestamp` (monthly). Partition `audit_log` and `usage_records` by time. Create maintenance job to auto-create partitions 3 months ahead and drop expired partitions.
**Acceptance Criteria:**
- `events` partitioned by month with sample partitions created
- `llm_calls` partitioned by month
- `audit_log` and `usage_records` partitioned by month
- Maintenance job creates future partitions and drops old ones
- Queries work transparently across partitions
- Partition drop is instant (no vacuum needed)
**Estimated Tests:** 10
**Dependencies:** S-1.2

#### S-1.5: Connection Pool with Tenant Context
**Description:** Implement connection pool wrapper that acquires connection, runs `SET LOCAL app.current_org = $org_id` within a transaction, executes query, and returns connection to pool. `SET LOCAL` ensures auto-reset on commit/rollback. Compatible with PgBouncer transaction mode.
**Acceptance Criteria:**
- `SET LOCAL` used (not `SET`) — scoped to transaction (FR-43)
- Connection returned to pool has no residual `app.current_org`
- Concurrent requests with different org_ids don't leak
- Works with PgBouncer in transaction mode
- Load test: 100 concurrent connections, 10 different orgs, zero cross-org leakage
**Estimated Tests:** 8
**Dependencies:** S-1.3

#### S-1.6: pgvector Extension & Embedding Tables
**Description:** Enable pgvector extension. Migrate embedding/vector tables to Postgres with `org_id` and RLS. Verify semantic search works with RLS enforced.
**Acceptance Criteria:**
- pgvector extension enabled
- Embedding tables have `org_id` + RLS policies
- Semantic similarity search returns only current org's results
- Vector index (ivfflat or hnsw) created for performance
**Estimated Tests:** 6
**Dependencies:** S-1.3

---

### Epic 2: Authentication & API Keys

#### S-2.1: OAuth Setup (Google + GitHub)
**Description:** Integrate Auth.js/NextAuth with Google and GitHub OAuth providers. On first OAuth login, create user record. Return JWT in HTTP-only secure cookie with SameSite=Strict. JWT payload includes `{ sub, email, name, orgs: [{ org_id, role }] }`.
**Acceptance Criteria:**
- Google OAuth login creates user and returns JWT cookie (FR-01, FR-46)
- GitHub OAuth login creates user and returns JWT cookie
- JWT stored in HTTP-only, Secure, SameSite=Strict cookie (FR-47, NFR-18)
- Duplicate OAuth login links to existing user (by email)
- Session expires after 7 days of inactivity (sliding window)
**Estimated Tests:** 10
**Dependencies:** S-1.1

#### S-2.2: Email/Password Registration
**Description:** Implement email/password signup with verification. Password requirements: min 8 chars, 1 upper, 1 lower, 1 digit. Email verification required before activation. Password reset via time-limited token (1 hour). Brute-force protection: lock after 10 failed attempts in 15 min.
**Acceptance Criteria:**
- Email/password registration works (FR-01, FR-02)
- Password complexity enforced (FR-53)
- Email verification required before account activation
- Password reset via email token, expires in 1 hour (FR-52)
- Account locks after 10 failed logins in 15 minutes (NFR-22)
- Login returns same JWT cookie format as OAuth
**Estimated Tests:** 14
**Dependencies:** S-1.1

#### S-2.3: API Key CRUD
**Description:** Implement API key create/list/revoke endpoints. Keys follow `al_live_<random32>` / `al_test_<random32>` format. Store bcrypt hash only. Show full key once at creation. List shows prefix + metadata only. Revocation invalidates Redis cache immediately via pub/sub. Track `last_used_at`.
**Acceptance Criteria:**
- Create returns full key once; DB stores only bcrypt hash (FR-15, FR-16)
- Key format matches `al_live_` or `al_test_` prefix (FR-14)
- List endpoint returns prefix, name, environment, last_used_at (FR-17)
- Revocation deletes Redis cache entry + pub/sub broadcast (FR-18, <5s propagation)
- Tier limits enforced: Free=2, Pro=10, Team=50 (FR-19)
- Only Owner/Admin can manage keys (FR-20)
**Estimated Tests:** 12
**Dependencies:** S-2.1, S-1.5

#### S-2.4: API Key Authentication Middleware
**Description:** Implement middleware that extracts `Authorization: Bearer al_...`, looks up key prefix in Redis cache (60s TTL), falls back to DB lookup + bcrypt verify on cache miss. Attaches `org_id` to request context. Returns 401 for invalid/revoked keys.
**Acceptance Criteria:**
- Valid key → org_id resolved, request proceeds (FR-24, FR-25)
- Invalid/revoked key → 401 Unauthorized
- Cache hit path < 10ms p95 (NFR-05)
- Cache miss → DB lookup → cache populated
- `last_used_at` updated (batched, non-blocking) (FR-21)
- Full key never logged; prefix only in error messages (FR-97)
**Estimated Tests:** 10
**Dependencies:** S-2.3

#### S-2.5: RBAC Middleware
**Description:** Implement `requireRole(...roles)` middleware for dashboard API routes. Check JWT session role against allowed roles per the permission matrix (FR-48). Log permission-denied events to audit log.
**Acceptance Criteria:**
- Owner can access all endpoints
- Admin blocked from billing and org deletion
- Member blocked from API keys, team management, billing, settings
- Viewer can only read dashboard data
- Permission denied → 403 + audit log entry (FR-51)
- Middleware composable on any route
**Estimated Tests:** 16 (4 roles × 4 action categories)
**Dependencies:** S-2.1

#### S-2.6: Audit Log Implementation
**Description:** Implement audit log writes for all security-relevant events: auth (login/logout/failed), API key ops (create/revoke), member management, settings changes, data exports, billing events. Entries are append-only, immutable.
**Acceptance Criteria:**
- All event types from PC-14 logged with required fields (PC-15)
- Entries include timestamp, actor, action, resource, IP, result
- No UPDATE or DELETE possible on audit_log (PC-18)
- Query endpoint with filters: action, time range, actor (PC-17)
- Export endpoint returns JSON (PC-17)
- Retention per tier enforced (PC-16)
**Estimated Tests:** 10
**Dependencies:** S-2.5

---

### Epic 3: Ingestion Pipeline

#### S-3.1: Redis Streams Setup
**Description:** Configure Redis (ElastiCache) with `event_ingestion` stream and `event_ingestion_dlq` dead letter stream. Create consumer group `ingestion_workers`. Implement health check and stream length monitoring.
**Acceptance Criteria:**
- Redis Stream `event_ingestion` created with consumer group
- DLQ stream `event_ingestion_dlq` exists
- Stream length queryable for backpressure monitoring
- Health check endpoint verifies Redis connectivity
- CloudWatch metrics for stream depth
**Estimated Tests:** 6
**Dependencies:** S-1.5

#### S-3.2: API Gateway Service
**Description:** Build the ingestion API service: `POST /v1/events` and `POST /v1/events/batch`. Auth via API key middleware (S-2.4). Schema validation. Enrich with org_id, api_key_id, received_at. Publish to Redis Stream. Return 202 Accepted with X-Request-Id.
**Acceptance Criteria:**
- Single event endpoint returns 202 on valid auth + payload (FR-23, FR-26)
- Batch endpoint accepts up to 100 events, returns per-event errors (FR-35)
- Invalid schema → 400 with descriptive error (FR-27)
- No auth → 401 (FR-24)
- Events enriched with org_id, api_key_id, received_at
- Response latency < 100ms p95 (NFR-02)
**Estimated Tests:** 14
**Dependencies:** S-2.4, S-3.1

#### S-3.3: Queue Workers — Batch Writer
**Description:** Implement consumer group workers that read up to 50 messages per XREADGROUP, perform enrichment (cost calculation, hash chain), and batch INSERT into Postgres. XACK on success. After 3 failures, move to DLQ.
**Acceptance Criteria:**
- Workers consume from stream and write to Postgres with correct org_id (FR-29)
- Batch INSERT (up to 50 events per write) for throughput
- Cost calculation runs on LLM events
- Hash chain verification/computation runs
- 3 retries then DLQ (NFR-14)
- XACK only after successful DB write
**Estimated Tests:** 12
**Dependencies:** S-3.2

#### S-3.4: Rate Limiting
**Description:** Implement sliding window rate limiting via Redis. Per-key and per-org limits. Tier-based defaults: Free=100/min, Pro=5K/min, Team=50K/min. Return 429 with Retry-After header.
**Acceptance Criteria:**
- Per-key rate limit enforced (FR-30)
- Per-org aggregate rate limit enforced (FR-31)
- 429 response includes Retry-After header (FR-32)
- Limits configurable per tier
- Per-key override supported (FR-22)
- Rate limit state in Redis (not in-memory)
**Estimated Tests:** 10
**Dependencies:** S-3.2

#### S-3.5: Backpressure Mechanism
**Description:** Monitor Redis Stream length. When pending messages exceed threshold (default 100K), API gateway returns 503 with Retry-After. CloudWatch alarm fires. Auto-scaling policy adds workers.
**Acceptance Criteria:**
- Stream depth check on every ingestion request (FR-33)
- 503 returned when threshold exceeded
- Retry-After header included
- CloudWatch alarm configured
- Threshold configurable via environment variable
**Estimated Tests:** 6
**Dependencies:** S-3.3

#### S-3.6: DLQ Management & Monitoring
**Description:** DLQ stream stores failed events with error metadata. Dashboard page shows DLQ depth and allows inspection/replay. DLQ events expire after 7 days.
**Acceptance Criteria:**
- Failed events (3 retries) land in DLQ with error details
- DLQ depth visible in monitoring
- Manual replay endpoint re-queues DLQ events
- Events expire from DLQ after 7 days
- DLQ depth included in health check
**Estimated Tests:** 8
**Dependencies:** S-3.3

---

### Epic 4: Multi-Tenant Query Layer

#### S-4.1: Storage Adapter Pattern
**Description:** Implement a storage adapter interface supporting both SQLite (self-hosted) and PostgreSQL (cloud). All existing query functions go through the adapter. Feature parity guaranteed by running same test suite against both backends (FR-92).
**Acceptance Criteria:**
- Adapter interface defined with all query/write methods
- SQLite adapter wraps existing implementation
- PostgreSQL adapter implements same interface
- Both adapters pass the same integration test suite (FR-92)
- Backend selected by config/environment variable
**Estimated Tests:** 8 (adapter interface tests, run 2x)
**Dependencies:** S-1.5

#### S-4.2: Session & Event Queries (Postgres)
**Description:** Implement Postgres adapter for session list, session detail, event queries. All queries use org_id composite indexes. Pagination support. RLS provides automatic tenant scoping.
**Acceptance Criteria:**
- `GET /v1/sessions` returns paginated, filtered sessions (org-scoped)
- `GET /v1/sessions/:id` returns session with events
- `GET /v1/events` supports type, time, session filters
- All queries use composite indexes (no seq scans on large tables)
- Same results as SQLite adapter for identical data
**Estimated Tests:** 12
**Dependencies:** S-4.1

#### S-4.3: Analytics Queries (Postgres)
**Description:** Implement Postgres adapter for cost analytics, health score analytics, token usage analytics. Aggregate queries optimized for Postgres (window functions, date_trunc, etc.).
**Acceptance Criteria:**
- `GET /v1/analytics/costs` returns cost data by time/model/agent
- `GET /v1/analytics/health` returns health score trends
- `GET /v1/analytics/usage` returns token usage breakdown
- Queries complete < 500ms p95 for typical org sizes (NFR-03)
- Results match SQLite adapter output format
**Estimated Tests:** 10
**Dependencies:** S-4.1

#### S-4.4: Semantic Search (Postgres + pgvector)
**Description:** Implement Postgres adapter for memory/embedding search using pgvector. Similarity search scoped by RLS. Support same query interface as SQLite adapter.
**Acceptance Criteria:**
- `GET /v1/memory/search` returns semantically similar results
- Results scoped to current org via RLS
- pgvector index used for performance
- Same API contract as self-hosted search
**Estimated Tests:** 6
**Dependencies:** S-1.6, S-4.1

#### S-4.5: CI Dual-Backend Test Runner
**Description:** Configure CI pipeline to run the full integration test suite against both SQLite and Postgres backends. Both must pass for CI to go green. This is the feature parity guarantee.
**Acceptance Criteria:**
- CI runs tests against SQLite backend
- CI runs same tests against Postgres backend
- Both must pass for merge/deploy (NFR-27)
- Test results show which backend each failure is from
- Coverage ≥ 85% on both backends (NFR-23)
**Estimated Tests:** 4 (meta-tests for CI config)
**Dependencies:** S-4.2, S-4.3

---

### Epic 5: SDK Cloud Mode

#### S-5.1: API Key Header Support
**Description:** Add `api_key` parameter to SDK init and `AGENTLENS_API_KEY` env var support. When set, include `Authorization: Bearer <key>` on all requests. Never log full key — prefix only in errors (FR-97).
**Acceptance Criteria:**
- `agentlensai.init(api_key="al_live_...")` sends auth header (FR-93)
- `AGENTLENS_API_KEY` env var works as fallback
- Full key never appears in logs (FR-97)
- Key prefix shown in error messages for debugging
- No auth header sent when no key configured (backward compat)
**Estimated Tests:** 8
**Dependencies:** S-2.4

#### S-5.2: Cloud Convenience Init
**Description:** Add `cloud=True` parameter that sets URL to `https://api.agentlens.ai`. Implement URL resolution priority: explicit server_url > cloud flag > env var > localhost default.
**Acceptance Criteria:**
- `agentlensai.init(cloud=True, api_key="al_...")` connects to cloud URL (FR-94)
- `AGENTLENS_URL` env var overrides cloud flag
- Explicit `server_url` overrides everything
- No params → localhost:3000 (backward compat)
- Single package, no separate cloud SDK (FR-96)
**Estimated Tests:** 8
**Dependencies:** S-5.1

#### S-5.3: Cloud Error Handling & Retry
**Description:** Handle cloud-specific HTTP responses: 401 (auth error with prefix logging), 402 (quota exceeded — buffer locally), 429 (rate limit — retry with Retry-After), 503 (backpressure — retry). Existing graceful degradation (buffer + backoff) for connection errors.
**Acceptance Criteria:**
- 401 → clear error log with key prefix (FR-97)
- 402 → warning log, buffer locally (FR-95)
- 429 → retry after Retry-After header delay
- 503 → retry with exponential backoff
- Connection error → buffer locally + retry (existing behavior preserved)
- No data loss on transient cloud outage
**Estimated Tests:** 10
**Dependencies:** S-5.1

#### S-5.4: SDK Integration Tests (Cloud Mode)
**Description:** End-to-end tests: SDK → Cloud API → event stored → queryable via API. Test all backward compatibility scenarios from architecture §8.4.
**Acceptance Criteria:**
- SDK sends event to cloud endpoint, receives 202
- Event appears in query API within 5 seconds
- All 5 compatibility scenarios from arch doc §8.4 pass
- Rate limiting triggers SDK retry correctly
- Graceful degradation works when cloud unreachable
**Estimated Tests:** 10
**Dependencies:** S-5.2, S-5.3, S-3.3

---

### Epic 6: Usage Metering & Billing

#### S-6.1: Stripe Integration Setup
**Description:** Integrate Stripe: create Customer on org creation, Products + Prices for Free/Pro/Team tiers (flat base + metered overage). Implement webhook handler for `invoice.paid`, `subscription.updated`, `customer.subscription.deleted`.
**Acceptance Criteria:**
- Org creation → Stripe Customer created (FR-55)
- Products/Prices configured for all tiers
- Metered price item for overage events
- Webhook handler processes key events
- Stripe signature verification on webhooks
- Webhook failures don't crash the service
**Estimated Tests:** 10
**Dependencies:** S-1.1

#### S-6.2: Usage Metering Pipeline
**Description:** Queue workers increment `usage_records` per org per hour. Batch accumulation in memory, flush every 10s or 100 events. Redis counter synced from usage_records for fast quota checks. Hourly cron reports overage to Stripe.
**Acceptance Criteria:**
- usage_records updated accurately (within 1% margin) (FR-54, AC-15)
- Redis counter `usage:{org_id}:{YYYY-MM}` reflects current month usage
- Hourly Stripe usage record creation for overage
- Batched writes (not per-event DB writes)
- Counter survives worker restart (persisted to DB)
**Estimated Tests:** 10
**Dependencies:** S-3.3, S-6.1

#### S-6.3: Quota Enforcement
**Description:** On ingestion, check current month usage against tier quota. Free tier: hard cutoff at 10K → 402. Pro/Team: allow overage up to configurable cap (default 2x). Send 80% warning notification (email + banner). Send 100% notification.
**Acceptance Criteria:**
- Free tier blocked at 10K events → 402 with upgrade URL (FR-59, AC-11)
- Pro/Team continue with overage billing (FR-59, AC-12)
- Overage cap enforced (FR-61)
- 80% warning email + banner (FR-58, AC-13)
- 100% notification for overage tiers
- Quota check < 5ms (Redis lookup)
**Estimated Tests:** 12
**Dependencies:** S-6.2

#### S-6.4: Plan Upgrade/Downgrade
**Description:** Implement upgrade (immediate) and downgrade (end of period) via Stripe subscriptions. Upgrade creates/updates subscription. Downgrade sets `cancel_at_period_end` and schedules new plan.
**Acceptance Criteria:**
- Upgrade takes effect immediately (FR-65, AC-14)
- Downgrade takes effect at end of billing period (FR-65)
- Stripe subscription updated correctly
- Tier limits (keys, members, orgs) enforced after change
- Proration handled on upgrade
**Estimated Tests:** 8
**Dependencies:** S-6.1

#### S-6.5: Invoice Generation & Annual Billing
**Description:** Monthly invoices via Stripe with itemized usage (base + overage). Support annual billing with 20% discount. Invoice records stored in `invoices` table synced from Stripe webhooks.
**Acceptance Criteria:**
- Monthly invoice shows base subscription + overage line items (FR-63)
- Annual billing option with 20% discount (FR-64)
- `invoices` table synced from Stripe webhook events
- Invoice list queryable via API
- Overage correctly calculated: Pro=$0.10/1K, Team=$0.08/1K (FR-60)
**Estimated Tests:** 8
**Dependencies:** S-6.4

#### S-6.6: Free Trial (14-day Pro)
**Description:** New signups get 14-day Pro trial, no credit card required. After trial, downgrade to Free unless upgraded. Trial status shown in dashboard.
**Acceptance Criteria:**
- New org starts with 14-day Pro trial (FR-66)
- No credit card required for trial
- Trial expiry → automatic downgrade to Free
- Dashboard shows trial status and days remaining
- Upgrade during trial converts to paid immediately
**Estimated Tests:** 6
**Dependencies:** S-6.4

---

### Epic 7: Dashboard Multi-Tenancy

#### S-7.1: Org Switcher Component
**Description:** Global sidebar/header component showing current org with dropdown of user's orgs. Switching org updates React context, triggers data re-fetch, updates active org in client state.
**Acceptance Criteria:**
- Org switcher visible on every page (FR-50)
- Switching org reloads all data for new org context
- Only user's orgs shown (from JWT)
- Current org visually highlighted
- URL doesn't leak org data (no org_id in URL params)
**Estimated Tests:** 6
**Dependencies:** S-2.1

#### S-7.2: Team Management Page
**Description:** Dashboard page to list members, invite by email, change roles, remove members. Invitation emails sent with 7-day expiry token. Owner can transfer ownership.
**Acceptance Criteria:**
- List members with role, joined date (FR-05)
- Invite by email with role selection (FR-05)
- Invitation expires after 7 days
- Change member role (Admin+ only) (FR-06)
- Remove member (Admin+ only)
- Transfer ownership (Owner only) (FR-08)
- Member limits enforced per tier (FR-10)
**Estimated Tests:** 12
**Dependencies:** S-2.5

#### S-7.3: API Key Management Page
**Description:** Dashboard page to create API keys (show full key once), list keys with prefix/name/env/last_used, and revoke keys. Admin+ access only.
**Acceptance Criteria:**
- Create key → show full key once with copy button (FR-15)
- List shows prefix, name, environment, last_used_at
- Revoke key with confirmation dialog
- Key limit per tier enforced (FR-19)
- Environment label selection (production/staging/development/test)
- Admin+ access enforced
**Estimated Tests:** 8
**Dependencies:** S-2.3, S-7.1

#### S-7.4: Usage Dashboard Page
**Description:** Dashboard page showing: events consumed (current period), quota remaining, usage-over-time graph, projected usage at current rate, cost breakdown by API key.
**Acceptance Criteria:**
- Current period event count vs quota displayed (FR-62)
- Usage over time graph (hourly/daily granularity)
- Projected usage at current rate
- Breakdown by API key
- 80% quota warning banner (FR-58)
- Real-time or near-real-time updates (< 1 min delay)
**Estimated Tests:** 8
**Dependencies:** S-6.2

#### S-7.5: Billing Page
**Description:** Dashboard page (Owner only) showing current plan, upgrade/downgrade buttons, payment method (via Stripe portal link), invoice history.
**Acceptance Criteria:**
- Current plan and next billing date shown (FR-55)
- Upgrade button triggers plan change (FR-65)
- Downgrade button with end-of-period notice
- "Manage payment" opens Stripe Customer Portal
- Invoice list with amounts and status
- Owner-only access enforced
**Estimated Tests:** 8
**Dependencies:** S-6.4

#### S-7.6: Audit Log Page
**Description:** Dashboard page (Admin+) showing filterable audit log. Filters: action type, time range, actor. Export as JSON.
**Acceptance Criteria:**
- Audit log table with pagination (PC-17)
- Filter by action, time range, actor
- Export filtered results as JSON
- Admin+ access enforced
- Entries immutable (no edit/delete in UI)
**Estimated Tests:** 6
**Dependencies:** S-2.6

#### S-7.7: Onboarding Flow
**Description:** New user onboarding: create org → create first API key → show SDK snippet → verify first event received. Progress indicators and inline docs.
**Acceptance Criteria:**
- Step-by-step wizard after first signup (AC-01)
- Org creation step with name/slug
- API key creation with copy-to-clipboard
- SDK code snippet with user's actual API key inserted
- "Waiting for first event..." indicator with success confirmation
- Complete flow < 2 minutes (AC-01)
**Estimated Tests:** 6
**Dependencies:** S-7.1, S-7.3

---

### Epic 8: Data Retention & Migration

#### S-8.1: Retention Purge Job
**Description:** Daily cron (03:00 UTC) that purges events beyond each org's retention window. Primary mechanism: DROP entire expired monthly partitions. Partial DELETE for boundary partitions. Same pattern for llm_calls, health_scores, etc.
**Acceptance Criteria:**
- Job runs daily, purges per org retention setting (FR-67, FR-68)
- Full partition drop for fully expired months (instant)
- Partial delete within boundary partition
- Tier defaults: Free=7d, Pro=30d, Team=90d (FR-67)
- Hard delete, not soft delete (FR-69)
- Job logs purge counts per org
**Estimated Tests:** 8
**Dependencies:** S-1.4

#### S-8.2: Org & User Deletion
**Description:** Org deletion: soft-delete → async job purges all data within 24h → Stripe cancellation. User deletion: remove from all orgs, anonymize audit entries, delete credentials within 24h. Confirmation required ("type org name").
**Acceptance Criteria:**
- Org deletion requires typing org name (FR-09)
- All data purged within 24 hours (FR-71)
- Stripe subscription cancelled, customer deleted
- User deletion removes from all orgs (FR-72)
- Audit log entries anonymized (not deleted)
- Export prompt shown before deletion
**Estimated Tests:** 10
**Dependencies:** S-1.5, S-6.1

#### S-8.3: JSONL Export/Import Endpoints
**Description:** `POST /v1/import` accepts JSONL with `_type` discriminator. `GET /v1/export` returns org data as JSONL. Streaming upload for large datasets. Rate limit: 10K records/min. Idempotent (skip existing IDs). Admin+ access.
**Acceptance Criteria:**
- Import accepts JSONL, assigns org_id, inserts records (FR-75, FR-76)
- Export returns all org data as JSONL (FR-77)
- Streaming upload supported for >100MB (FR-80)
- Rate limited to 10K records/min (FR-81)
- Existing IDs skipped (idempotent) (FR-79)
- Round-trip preserves all IDs, timestamps, metadata (FR-79, AC-18)
**Estimated Tests:** 12
**Dependencies:** S-4.2

#### S-8.4: Self-Hosted Migration CLI
**Description:** `npx @agentlensai/server export --format jsonl` exports SQLite data. `npx @agentlensai/server import --file export.jsonl` imports JSONL to SQLite. Documents the full self-hosted ↔ cloud migration flow.
**Acceptance Criteria:**
- Export command produces valid JSONL from SQLite (FR-74)
- Import command ingests JSONL into SQLite (FR-78)
- Self-hosted → Cloud round-trip preserves data (AC-16, AC-17, AC-18)
- Cloud → self-hosted round-trip preserves data
- CLI includes progress indicator for large datasets
**Estimated Tests:** 8
**Dependencies:** S-8.3

---

### Epic 9: Docs & Publishing

#### S-9.1: Cloud Setup Guide
**Description:** End-to-end guide: signup → create org → get API key → configure SDK → verify events → explore dashboard. Hosted at docs site.
**Acceptance Criteria:**
- Step-by-step with screenshots
- Code snippets for Python SDK configuration
- Troubleshooting section (common errors: 401, 429, 402)
- Time-to-complete < 5 minutes following the guide
- Links to SDK reference and API docs
**Estimated Tests:** 2 (doc build + link validation)
**Dependencies:** S-5.2, S-7.7

#### S-9.2: SDK Migration Guide
**Description:** Guide for migrating from self-hosted to cloud and vice versa. Covers config changes, data migration via CLI, and verification steps.
**Acceptance Criteria:**
- Self-hosted → Cloud migration documented with CLI commands
- Cloud → Self-hosted migration documented
- Data verification steps included
- Common pitfalls and FAQ section
- Links to export/import API reference
**Estimated Tests:** 2
**Dependencies:** S-8.4

#### S-9.3: API Reference
**Description:** OpenAPI spec for all Cloud API endpoints (ingestion, query, management, billing, migration). Auto-generated documentation.
**Acceptance Criteria:**
- OpenAPI 3.0 spec covering all endpoints from architecture §7
- Auto-generated documentation page
- Request/response examples for every endpoint
- Error code reference
- Authentication section (API key + JWT)
**Estimated Tests:** 3 (spec validation + example tests)
**Dependencies:** S-3.2, S-6.4, S-8.3

#### S-9.4: Pricing Page
**Description:** Public pricing page at agentlens.ai showing tier comparison, overage rates, FAQ, and CTA buttons. Annual toggle showing 20% discount.
**Acceptance Criteria:**
- Tier comparison table matching PRD §16.1
- Annual/monthly toggle with discount shown
- Overage rates clearly displayed
- FAQ section addressing common questions
- CTA buttons linking to signup
- Mobile responsive
**Estimated Tests:** 2 (render + responsive check)
**Dependencies:** None (can be built anytime, but publish after E6)

---

## Batch Plan

### Batch 1: Database Foundation
**Stories:** S-1.1, S-1.2, S-1.3
**Track:** A (Data Layer)
**Parallel:** 3 stories, sequential dependency
**Goal:** All Postgres tables exist with RLS enforced and tested
**Estimated Tests:** 51
**Duration:** 3–4 days

### Batch 2: Infrastructure + Auth Start
**Stories:** S-1.4, S-1.5, S-1.6, S-2.1, S-2.2
**Track:** A (S-1.4–1.6) + B (S-2.1–2.2)
**Parallel:** Track A and Track B independent
**Goal:** Partitioning, connection pool, pgvector ready; OAuth and email auth working
**Estimated Tests:** 48
**Duration:** 3–4 days

### Batch 3: Auth Complete + Query Start
**Stories:** S-2.3, S-2.4, S-4.1, S-4.2
**Track:** B (S-2.3–2.4) + A (S-4.1–4.2)
**Parallel:** API key CRUD + middleware || Storage adapter + queries
**Goal:** API key auth working end-to-end; basic queries via Postgres adapter
**Estimated Tests:** 42
**Duration:** 3–4 days

### Batch 4: Auth Hardening + Query Complete
**Stories:** S-2.5, S-2.6, S-4.3, S-4.4
**Track:** B (S-2.5–2.6) + A (S-4.3–4.4)
**Parallel:** RBAC + audit log || Analytics + semantic search
**Goal:** Full auth stack; all query types working on Postgres
**Estimated Tests:** 42
**Duration:** 3–4 days

### Batch 5: Ingestion Pipeline Core + Dashboard Start
**Stories:** S-3.1, S-3.2, S-4.5, S-7.1
**Track:** C (S-3.1–3.2) + A (S-4.5) + D (S-7.1)
**Parallel:** Redis + API gateway || CI dual-backend || Org switcher
**Goal:** Events accepted via cloud endpoint; CI runs both backends; org switching works
**Estimated Tests:** 34
**Duration:** 3–4 days

### Batch 6: Ingestion Workers + Dashboard Team
**Stories:** S-3.3, S-3.4, S-7.2, S-7.3
**Track:** C (S-3.3–3.4) + D (S-7.2–7.3)
**Parallel:** Batch writer + rate limiting || Team mgmt + API key page
**Goal:** Events flowing end-to-end (SDK → queue → Postgres); team management live
**Estimated Tests:** 42
**Duration:** 3–4 days

### Batch 7: Ingestion Hardening + Billing Start
**Stories:** S-3.5, S-3.6, S-6.1, S-6.2
**Track:** C (S-3.5–3.6) + D (S-6.1–6.2)
**Parallel:** Backpressure + DLQ || Stripe setup + metering
**Goal:** Production-ready ingestion; usage metering pipeline active
**Estimated Tests:** 30
**Duration:** 3–4 days

### Batch 8: SDK Cloud + Billing Core
**Stories:** S-5.1, S-5.2, S-6.3, S-6.4
**Track:** C (S-5.1–5.2) + D (S-6.3–6.4)
**Parallel:** SDK api_key + cloud init || Quota enforcement + plan changes
**Goal:** SDK can target cloud; billing enforces quotas and handles plan changes
**Estimated Tests:** 36
**Duration:** 3–4 days

### Batch 9: SDK Hardening + Billing Complete + Dashboard Pages
**Stories:** S-5.3, S-5.4, S-6.5, S-6.6, S-7.4
**Track:** C (S-5.3–5.4) + D (S-6.5–6.6, S-7.4)
**Parallel:** SDK error handling + e2e tests || Invoicing + trial + usage page
**Goal:** SDK production-ready; billing complete; usage dashboard live
**Estimated Tests:** 42
**Duration:** 3–4 days

### Batch 10: Dashboard Complete + Retention
**Stories:** S-7.5, S-7.6, S-7.7, S-8.1, S-8.2
**Track:** D (S-7.5–7.7) + A (S-8.1–8.2)
**Parallel:** Billing/audit/onboarding pages || Retention + deletion
**Goal:** All dashboard pages live; data lifecycle automated
**Estimated Tests:** 38
**Duration:** 3–4 days

### Batch 11: Migration + Docs Start
**Stories:** S-8.3, S-8.4, S-9.1, S-9.2
**Track:** A (S-8.3–8.4) + D (S-9.1–9.2)
**Parallel:** Export/import + CLI || Setup guide + migration guide
**Goal:** Full migration path working; core docs written
**Estimated Tests:** 24
**Duration:** 2–3 days

### Batch 12: Final Docs + Polish
**Stories:** S-9.3, S-9.4
**Track:** D
**Parallel:** API reference + pricing page
**Goal:** All documentation and public pages complete
**Estimated Tests:** 5
**Duration:** 1–2 days

---

## Summary

| Metric | Value |
|--------|-------|
| Total Epics | 9 |
| Total Stories | 48 |
| Total Batches | 12 |
| Total Estimated Tests | ~434 |
| Estimated Duration | 10–12 weeks |
| Parallel Tracks | 4 (Data, Auth, Ingestion, Dashboard/Billing) |
| Critical Path | E1 → E2 → E3 → E5 (SDK end-to-end) |

### FR Coverage

| Epic | FRs Covered |
|------|-------------|
| E1 | FR-36–44, FR-73 |
| E2 | FR-01–02, FR-13–22, FR-45–53, PC-14–18 |
| E3 | FR-23–35 |
| E4 | FR-82–92 |
| E5 | FR-93–97 |
| E6 | FR-54–66 |
| E7 | FR-03–12, FR-49–50 |
| E8 | FR-67–72, FR-74–81 |
| E9 | Documentation (supports all FRs) |

---

*End of sprint plan. 48 stories, 12 batches, ~434 tests, 10–12 weeks estimated.*

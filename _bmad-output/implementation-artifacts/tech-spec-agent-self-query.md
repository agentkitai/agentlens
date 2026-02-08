# Tech Spec: Agent Self-Query & Memory

**Version:** 1.0  
**Date:** 2026-02-08  
**Status:** Draft — Ready for Implementation  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Model Changes](#2-data-model-changes)
3. [Tenant Isolation Design](#3-tenant-isolation-design)
4. [Vector Search Architecture](#4-vector-search-architecture)
5. [Epic 1: Tenant Isolation](#5-epic-1-tenant-isolation)
6. [Epic 2: Semantic Search (Recall)](#6-epic-2-semantic-search-recall)
7. [Epic 3: Lessons Learned (Learn)](#7-epic-3-lessons-learned-learn)
8. [Epic 4: Pattern Analysis (Reflect)](#8-epic-4-pattern-analysis-reflect)
9. [Epic 5: Cross-Session Context](#9-epic-5-cross-session-context)
10. [Epic 6: SDK & Dashboard](#10-epic-6-sdk--dashboard)
11. [Epic 7: Documentation & CLI](#11-epic-7-documentation--cli)

---

## 1. Overview

### 1.1 Problem Statement

Every AI observability platform today — including AgentLens — is built for **humans watching agents**. Dashboards, charts, alert rules. But no tool exists for **agents watching themselves**.

An AI agent that runs hundreds of sessions has no structured way to:
- Recall what worked before when it encountered a similar problem
- Reflect on patterns in its own behavior (error rates, tool sequences, costs)
- Learn from past mistakes and record distilled insights
- Retrieve relevant context from prior interactions with the same user or topic

This is a fundamental missing capability. Without memory, agents repeat the same mistakes, fail to build on past successes, and can't accumulate institutional knowledge.

### 1.2 Value Proposition

AgentLens becomes **the memory layer for AI agents** — not just a log viewer, but an active participant in agent reasoning. Agents query their own history via MCP tools to make better decisions.

**For agent developers:** Drop-in memory that makes agents smarter session over session. No custom vector DB setup, no separate knowledge management system.

**For enterprises:** Structured, tenant-isolated, auditable agent memory with the same security model they already use for observability.

**Positioning:** "AgentLens: Observability for humans. Memory for agents."

### 1.3 New MCP Tools

| Tool | Purpose | Primary Use |
|------|---------|-------------|
| `agentlens_recall` | Semantic search over past events and sessions | "Find when I dealt with authentication issues" |
| `agentlens_learn` | CRUD for distilled agent insights/lessons | "Remember: always run tests before deploy" |
| `agentlens_reflect` | Pattern analysis and behavioral aggregation | "What's my error rate for file operations?" |
| `agentlens_context` | Cross-session context retrieval | "What happened last time this user asked about migrations?" |

### 1.4 Scope & Constraints

- SQLite remains the default storage backend — no mandatory external dependencies
- Vector embeddings work locally (sqlite-vec) OR via API (OpenAI embeddings)
- 100% backward compatible — existing data migrates cleanly
- All new capabilities are tenant-scoped — zero cross-tenant data leakage
- MCP tools are the primary agent interface; REST endpoints for SDK/programmatic access
- Self-hosted friendly — everything works offline with local embeddings

---

## 2. Data Model Changes

### 2.1 Existing Schema (Current State)

```
events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash)
sessions (id, agent_id, agent_name, started_at, ended_at, status, event_count, tool_call_count, error_count, total_cost_usd, llm_call_count, total_input_tokens, total_output_tokens, tags)
agents (id, name, description, first_seen_at, last_seen_at, session_count)
alert_rules (id, name, enabled, condition, threshold, window_minutes, scope, notify_channels, created_at, updated_at)
alert_history (id, rule_id, triggered_at, resolved_at, current_value, threshold, message)
api_keys (id, key_hash, name, scopes, created_at, last_used_at, revoked_at, rate_limit)
```

### 2.2 Schema Changes

#### 2.2.1 Add `tenant_id` to `api_keys`

```sql
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
```

The `api_keys` table becomes the source of truth for tenant identity. Each API key belongs to exactly one tenant.

#### 2.2.2 Add `tenant_id` to `events`

```sql
ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_events_tenant_id ON events(tenant_id);
CREATE INDEX idx_events_tenant_session ON events(tenant_id, session_id);
CREATE INDEX idx_events_tenant_agent_ts ON events(tenant_id, agent_id, timestamp);
```

#### 2.2.3 Add `tenant_id` to `sessions`

```sql
ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_sessions_tenant_id ON sessions(tenant_id);
CREATE INDEX idx_sessions_tenant_agent ON sessions(tenant_id, agent_id);
CREATE INDEX idx_sessions_tenant_started ON sessions(tenant_id, started_at);
```

#### 2.2.4 Add `tenant_id` to `agents`

```sql
ALTER TABLE agents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_agents_tenant_id ON agents(tenant_id);
```

#### 2.2.5 Add `tenant_id` to `alert_rules` and `alert_history`

```sql
ALTER TABLE alert_rules ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE alert_history ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
```

#### 2.2.6 New Table: `lessons`

```sql
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,                    -- ULID
  tenant_id TEXT NOT NULL,                -- Tenant isolation
  agent_id TEXT,                          -- Optional: specific to an agent, or NULL for tenant-wide
  category TEXT NOT NULL DEFAULT 'general', -- Grouping: 'error-handling', 'deployment', 'coding', etc.
  title TEXT NOT NULL,                    -- Short lesson title
  content TEXT NOT NULL,                  -- The lesson/insight content
  context TEXT NOT NULL DEFAULT '{}',     -- JSON: tags, topics, trigger conditions
  importance TEXT NOT NULL DEFAULT 'normal', -- 'low', 'normal', 'high', 'critical'
  source_session_id TEXT,                 -- Optional: session that spawned this lesson
  source_event_id TEXT,                   -- Optional: event that spawned this lesson
  access_count INTEGER NOT NULL DEFAULT 0, -- How often this lesson has been retrieved
  last_accessed_at TEXT,                  -- Last time this lesson was retrieved
  created_at TEXT NOT NULL,               -- ISO 8601
  updated_at TEXT NOT NULL,               -- ISO 8601
  archived_at TEXT                        -- Soft-delete / archive
);

CREATE INDEX idx_lessons_tenant ON lessons(tenant_id);
CREATE INDEX idx_lessons_tenant_agent ON lessons(tenant_id, agent_id);
CREATE INDEX idx_lessons_tenant_category ON lessons(tenant_id, category);
CREATE INDEX idx_lessons_tenant_importance ON lessons(tenant_id, importance);
```

#### 2.2.7 New Table: `embeddings`

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,                    -- ULID
  tenant_id TEXT NOT NULL,                -- Tenant isolation
  source_type TEXT NOT NULL,              -- 'event', 'session', 'lesson'
  source_id TEXT NOT NULL,                -- ID of the source record
  content_hash TEXT NOT NULL,             -- SHA-256 of the embedded text (dedup)
  text_content TEXT NOT NULL,             -- The text that was embedded
  embedding BLOB NOT NULL,               -- Float32 array serialized as binary
  embedding_model TEXT NOT NULL,          -- e.g., 'all-MiniLM-L6-v2', 'text-embedding-3-small'
  dimensions INTEGER NOT NULL,            -- e.g., 384, 1536
  created_at TEXT NOT NULL
);

CREATE INDEX idx_embeddings_tenant ON embeddings(tenant_id);
CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX idx_embeddings_content_hash ON embeddings(tenant_id, content_hash);
```

#### 2.2.8 New Table: `session_summaries`

Auto-generated summaries for completed sessions, used for semantic search and context retrieval.

```sql
CREATE TABLE session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  tenant_id TEXT NOT NULL,
  summary TEXT NOT NULL,                  -- Auto-generated text summary
  topics TEXT NOT NULL DEFAULT '[]',      -- JSON array of extracted topics
  tool_sequence TEXT NOT NULL DEFAULT '[]', -- JSON array of tools used in order
  error_summary TEXT,                     -- Summary of errors if any
  outcome TEXT,                           -- 'success', 'partial', 'failure'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_summaries_tenant ON session_summaries(tenant_id);
```

### 2.3 Core Type Changes

New TypeScript types to add to `@agentlensai/core`:

```typescript
// ─── Tenant-Scoped Base ─────────────────────────────────────────────

/** All tenant-scoped queries include this */
interface TenantScoped {
  tenantId: string;
}

// ─── Lessons ────────────────────────────────────────────────────────

type LessonImportance = 'low' | 'normal' | 'high' | 'critical';

interface Lesson {
  id: string;
  tenantId: string;
  agentId?: string;
  category: string;
  title: string;
  content: string;
  context: Record<string, unknown>;
  importance: LessonImportance;
  sourceSessionId?: string;
  sourceEventId?: string;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

interface LessonQuery {
  agentId?: string;
  category?: string;
  importance?: LessonImportance;
  search?: string;       // Semantic search over title + content
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

// ─── Recall (Semantic Search) ───────────────────────────────────────

interface RecallQuery {
  query: string;          // Natural language query
  scope?: 'events' | 'sessions' | 'lessons' | 'all';
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  minScore?: number;      // Minimum similarity score (0-1)
}

interface RecallResult {
  results: Array<{
    sourceType: 'event' | 'session' | 'lesson';
    sourceId: string;
    score: number;        // Cosine similarity
    text: string;         // The matched text
    metadata: Record<string, unknown>; // Source-specific context
  }>;
  query: string;
  totalResults: number;
}

// ─── Reflect (Pattern Analysis) ─────────────────────────────────────

type ReflectAnalysis =
  | 'error_patterns'      // What errors recur and what preceded them
  | 'tool_sequences'      // Common tool usage patterns
  | 'cost_analysis'       // Token/cost analysis by task type
  | 'performance_trends'  // Latency, success rate trends
  | 'session_comparison'; // Compare recent sessions with historical

interface ReflectQuery {
  analysis: ReflectAnalysis;
  agentId?: string;
  from?: string;
  to?: string;
  /** Additional params per analysis type */
  params?: Record<string, unknown>;
  limit?: number;
}

interface ReflectResult {
  analysis: ReflectAnalysis;
  insights: Array<{
    type: string;
    summary: string;
    data: Record<string, unknown>;
    confidence: number;   // 0-1
  }>;
  metadata: {
    sessionsAnalyzed: number;
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Context (Cross-Session) ────────────────────────────────────────

interface ContextQuery {
  /** Natural language description of what context is needed */
  topic: string;
  /** Optional: scope to sessions involving a specific user/entity */
  userId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

interface ContextResult {
  sessions: Array<{
    sessionId: string;
    summary: string;
    relevanceScore: number;
    startedAt: string;
    endedAt?: string;
    keyEvents: Array<{
      eventType: string;
      summary: string;
      timestamp: string;
    }>;
  }>;
  lessons: Lesson[];       // Relevant lessons
  topic: string;
  totalSessions: number;
}
```

---

## 3. Tenant Isolation Design

### 3.1 Core Principle

**Every database query that returns tenant data MUST include `WHERE tenant_id = ?`.** This is enforced at the storage layer, not the route layer, making it impossible to accidentally skip.

### 3.2 Tenant Identity Flow

```
API Key (als_xxx)
  → SHA-256 hash lookup in api_keys table
  → api_keys.tenant_id extracted
  → Stored in Hono context as c.get('apiKey').tenantId
  → Passed to every store method as first argument or query field
  → Every SQL query includes WHERE tenant_id = ?
```

### 3.3 Auth Middleware Changes

The `ApiKeyInfo` type gains a `tenantId` field:

```typescript
export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  tenantId: string;  // NEW
}
```

The auth middleware reads `tenant_id` from the API key row and attaches it to the context. In dev mode (`AUTH_DISABLED=true`), `tenantId` defaults to `'default'`.

### 3.4 Storage Layer Changes

The `IEventStore` interface methods gain tenant scoping. Two approaches considered:

**Option A: Add `tenantId` parameter to every method.** Verbose but explicit.

**Option B (Chosen): Create `TenantScopedStore` wrapper.** A per-request wrapper that binds `tenantId` and delegates to the underlying store. This keeps the existing method signatures cleaner and makes tenant scoping automatic.

```typescript
class TenantScopedStore implements IEventStore {
  constructor(
    private readonly inner: SqliteEventStore,
    private readonly tenantId: string
  ) {}

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    return this.inner.queryEvents({ ...query, tenantId: this.tenantId });
  }
  // ... all methods delegate with tenantId injected
}
```

Route handlers create a `TenantScopedStore` per request:

```typescript
const tenantStore = new TenantScopedStore(store, c.get('apiKey').tenantId);
```

### 3.5 MCP Tenant Flow

The MCP server authenticates via `AGENTLENS_API_KEY` environment variable. All API calls include this key, which maps to a tenant on the server side. The MCP tools don't need to know about tenants — isolation is enforced server-side.

### 3.6 Migration Strategy

1. Add `tenant_id` columns with `DEFAULT 'default'` — all existing data gets `tenant_id = 'default'`
2. Add `tenant_id` to `api_keys` table with `DEFAULT 'default'`
3. All existing API keys are assigned to the `'default'` tenant
4. New `POST /api/keys` endpoint accepts optional `tenantId` param (admin only)
5. A separate admin endpoint `POST /api/tenants` allows creating tenants (future)

---

## 4. Vector Search Architecture

### 4.1 Embedding Strategy

AgentLens supports two embedding backends, selectable via config:

| Backend | Library | Dimensions | Speed | Dependencies |
|---------|---------|-----------|-------|-------------|
| **Local (default)** | `@xenova/transformers` (ONNX) with `all-MiniLM-L6-v2` | 384 | ~50ms/embed | None (bundled) |
| **API** | OpenAI `text-embedding-3-small` | 1536 | ~200ms/embed | `OPENAI_API_KEY` |

Configuration:

```
AGENTLENS_EMBEDDING_BACKEND=local|openai   (default: local)
AGENTLENS_EMBEDDING_MODEL=all-MiniLM-L6-v2  (default for local)
OPENAI_API_KEY=sk-xxx                       (required if backend=openai)
```

### 4.2 Storage

Embeddings are stored in the `embeddings` table as `BLOB` (raw Float32Array binary). This avoids the need for `sqlite-vss` or `sqlite-vec` extensions, which have portability issues.

### 4.3 Similarity Search

Cosine similarity is computed in application code, not SQL. The flow:

1. Embed the query text → query vector
2. Load candidate embeddings from the `embeddings` table (filtered by `tenant_id`, `source_type`, optional time range)
3. Compute cosine similarity in JavaScript between query vector and each candidate
4. Sort by similarity, apply `minScore` filter, return top `limit` results

**Performance considerations:**
- For <100K embeddings per tenant, in-memory cosine similarity is fast (<100ms)
- Embeddings are loaded in batches of 1000 to avoid memory spikes
- A tenant-scoped embedding count check warns if > 100K embeddings (suggest pruning or upgrading to a dedicated vector DB)
- Future: migrate to `sqlite-vec` when it stabilizes, or add PostgreSQL+pgvector backend

### 4.4 What Gets Embedded

| Source | Text Content | When |
|--------|-------------|------|
| Events (error) | `"{eventType}: {payload.error or payload summary}"` | On ingest, for `tool_error`, `error`/`critical` severity events |
| Events (tool_call) | `"tool_call: {toolName}({arg summary})"` | On ingest, for `tool_call` events |
| Sessions | Session summary text (from `session_summaries` table) | On session end, after summary generation |
| Lessons | `"{title}: {content}"` | On lesson create/update |

### 4.5 Embedding Pipeline

Embeddings are generated asynchronously via a background worker:

1. Event/session/lesson is created → a job is pushed to an in-memory queue
2. Background worker picks up jobs, generates embeddings, stores in `embeddings` table
3. If the worker is busy, jobs queue (bounded queue, oldest dropped if full)
4. On server startup, a catch-up scan finds un-embedded records and queues them

This keeps the write path (ingest) fast and non-blocking.

---

## 5. Epic 1: Tenant Isolation

**Goal:** Add multi-tenant support to the entire system. Every piece of data is associated with a tenant. Every query is tenant-scoped. This is the foundational epic — all other epics depend on it.

### Story 1.1: Add `tenantId` to `api_keys` Table and Auth Middleware

**Description:** Add a `tenant_id` column to the `api_keys` table. Update the auth middleware to extract `tenantId` from the API key record and attach it to the request context. Update `ApiKeyInfo` type.

**Acceptance Criteria:**
- Given an API key with `tenant_id = 'acme'`, when a request authenticates with that key, then `c.get('apiKey').tenantId` equals `'acme'`
- Given `AUTH_DISABLED=true`, when any request arrives, then `tenantId` defaults to `'default'`
- Given an existing database without `tenant_id` on `api_keys`, when the server starts, then migration adds the column with `DEFAULT 'default'`

**Files to Create or Modify:**
- `packages/server/src/middleware/auth.ts` — Add `tenantId` to `ApiKeyInfo`, read from DB row
- `packages/server/src/db/schema.sqlite.ts` — Add `tenantId` to `apiKeys` schema
- `packages/server/src/db/migrate.ts` — Add migration for `api_keys.tenant_id`
- `packages/server/src/routes/api-keys.ts` — Accept optional `tenantId` on key creation
- `packages/core/src/types.ts` — (No change needed — `ApiKeyInfo` lives in server)

**Tests:**
- `packages/server/src/__tests__/auth.test.ts` — Test tenantId extraction from API key
- `packages/server/src/__tests__/api-keys.test.ts` — Test key creation with tenantId

---

### Story 1.2: Add `tenantId` to Events, Sessions, and Agents Tables

**Description:** Add `tenant_id` column to `events`, `sessions`, and `agents` tables. Add indexes for tenant-scoped queries. Existing data gets `DEFAULT 'default'`.

**Acceptance Criteria:**
- Given an existing database, when the server starts, then `tenant_id` columns are added to `events`, `sessions`, `agents` with `DEFAULT 'default'`
- Given the new schema, then indexes `idx_events_tenant_id`, `idx_events_tenant_session`, `idx_sessions_tenant_id`, `idx_agents_tenant_id` exist

**Files to Create or Modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add `tenantId` to `events`, `sessions`, `agents` table definitions, add new indexes
- `packages/server/src/db/migrate.ts` — Add migration logic for all three tables
- `packages/core/src/types.ts` — Add optional `tenantId` to `AgentLensEvent`, `Session`, `Agent` interfaces

**Tests:**
- `packages/server/src/db/__tests__/init.test.ts` — Verify migration creates columns and indexes

---

### Story 1.3: Tenant-Scoped Event Store

**Description:** Create a `TenantScopedStore` class that wraps `SqliteEventStore` and injects `tenantId` into every operation. Update `SqliteEventStore` to accept `tenantId` in queries and enforce it in WHERE clauses.

**Acceptance Criteria:**
- Given tenant A inserts events, when tenant B queries events, then tenant B sees zero events from tenant A
- Given tenant A creates a session, when tenant B queries sessions, then tenant B cannot see tenant A's session
- Given tenant A and tenant B both have agents with the same `agentId`, their data is completely separate
- Given an event query with no explicit tenantId on the internal store, then the query MUST throw an error (defense-in-depth)

**Files to Create or Modify:**
- `packages/server/src/db/tenant-scoped-store.ts` — **NEW** — `TenantScopedStore` wrapper class
- `packages/server/src/db/sqlite-store.ts` — Add `tenantId` to all `_buildEventConditions`, `_buildSessionConditions`, `_handleSessionUpdate`, `_handleAgentUpsert`, and all write paths
- `packages/core/src/storage.ts` — Consider adding `tenantId` as an optional field on existing query types, or a new tenant-aware interface extension
- `packages/core/src/types.ts` — Add `tenantId?: string` to `EventQuery` and `SessionQuery`

**Tests:**
- `packages/server/src/db/__tests__/sqlite-store-tenant.test.ts` — **NEW** — Comprehensive tenant isolation tests:
  - Two tenants insert events, each only sees their own
  - Session queries are isolated
  - Agent lists are isolated
  - Analytics are isolated
  - `getLastEventHash` is tenant-scoped
  - `getStats` returns tenant-scoped counts

---

### Story 1.4: Tenant Scoping in Route Handlers

**Description:** Update all route handlers to create a `TenantScopedStore` per request and use it instead of the global store.

**Acceptance Criteria:**
- Given any API endpoint under `/api/events`, `/api/sessions`, `/api/agents`, `/api/stats`, `/api/analytics`, `/api/alerts`, when accessed with an authenticated API key, then only data belonging to that key's tenant is returned
- Given the ingest endpoint `POST /api/events`, when events are ingested, then they are stamped with the tenant's `tenantId`

**Files to Create or Modify:**
- `packages/server/src/routes/events.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/sessions.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/agents.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/stats.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/analytics.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/alerts.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/ingest.ts` — Use `TenantScopedStore`
- `packages/server/src/routes/stream.ts` — Filter SSE by tenant
- `packages/server/src/index.ts` — Update `createApp` to pass store + db so routes can create tenant-scoped wrappers

**Tests:**
- `packages/server/src/__tests__/events-query.test.ts` — Update to verify tenant scoping
- `packages/server/src/__tests__/sessions.test.ts` — Update to verify tenant scoping
- `packages/server/src/__tests__/tenant-isolation.test.ts` — **NEW** — End-to-end test: two API keys with different tenants, insert via one, query via the other, verify isolation

---

### Story 1.5: Add `tenantId` to Alert Rules and History

**Description:** Add `tenant_id` column to `alert_rules` and `alert_history`. Update `AlertEngine` to evaluate alerts per-tenant.

**Acceptance Criteria:**
- Given tenant A creates an alert rule, when tenant B lists alert rules, then tenant B does not see it
- Given an alert triggers for tenant A, the alert history record has `tenant_id` of tenant A

**Files to Create or Modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add `tenantId` to `alertRules`, `alertHistory`
- `packages/server/src/db/migrate.ts` — Migration for new columns
- `packages/server/src/db/sqlite-store.ts` — Tenant scope alert rule and history queries
- `packages/server/src/lib/alert-engine.ts` — Tenant-aware alert evaluation
- `packages/server/src/routes/alerts.ts` — Use `TenantScopedStore`

**Tests:**
- `packages/server/src/__tests__/alerts.test.ts` — Update with tenant scoping

---

## 6. Epic 2: Semantic Search (Recall)

**Goal:** Enable agents to search past events, sessions, and lessons by meaning using vector embeddings and cosine similarity.

### Story 2.1: Embedding Service Infrastructure

**Description:** Create an embedding service that supports both local (Xenova/transformers.js) and OpenAI backends. Implement the embedding generation pipeline with model loading, caching, and error handling.

**Acceptance Criteria:**
- Given `AGENTLENS_EMBEDDING_BACKEND=local`, when embedding text, then the local ONNX model is used, producing a 384-dimension vector
- Given `AGENTLENS_EMBEDDING_BACKEND=openai`, when embedding text, then the OpenAI API is called, producing a 1536-dimension vector
- Given the embedding service, when the same text is embedded twice, then the same vector is returned (deterministic for local)
- Given model first load, when the server starts, then the model downloads are logged and cached

**Files to Create or Modify:**
- `packages/server/src/lib/embeddings/index.ts` — **NEW** — `EmbeddingService` interface and factory
- `packages/server/src/lib/embeddings/local.ts` — **NEW** — Local embedding using `@xenova/transformers`
- `packages/server/src/lib/embeddings/openai.ts` — **NEW** — OpenAI embedding client
- `packages/server/src/lib/embeddings/types.ts` — **NEW** — `EmbeddingVector`, `EmbeddingBackend` types
- `packages/server/src/config.ts` — Add embedding config fields

**Tests:**
- `packages/server/src/lib/embeddings/__tests__/local.test.ts` — **NEW** — Test local embedding generation
- `packages/server/src/lib/embeddings/__tests__/openai.test.ts` — **NEW** — Test OpenAI embedding (mocked)

---

### Story 2.2: Embeddings Table and Storage

**Description:** Create the `embeddings` and `session_summaries` tables. Implement CRUD operations for embeddings including deduplication via content hash.

**Acceptance Criteria:**
- Given an embedding is stored, when queried by `source_type` and `source_id`, then the embedding is returned
- Given the same content hash already exists for a tenant, when storing an embedding, then the existing record is updated (not duplicated)
- Given an embedding is stored as a Float32Array blob, when retrieved, then it deserializes back to the correct Float32Array

**Files to Create or Modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add `embeddings` and `sessionSummaries` table definitions
- `packages/server/src/db/migrate.ts` — Migration for new tables
- `packages/server/src/db/embedding-store.ts` — **NEW** — `EmbeddingStore` class with CRUD + similarity search
- `packages/core/src/types.ts` — Add `Lesson`, `RecallQuery`, `RecallResult` types

**Tests:**
- `packages/server/src/db/__tests__/embedding-store.test.ts` — **NEW** — Store/retrieve/dedup/similarity tests

---

### Story 2.3: Background Embedding Worker

**Description:** Implement a background worker that processes an in-memory queue of records to embed. On ingest, relevant events get queued. On session end, session summaries get queued. Worker runs in the same process.

**Acceptance Criteria:**
- Given an event with `eventType = 'tool_error'` is ingested, then the event is queued for embedding
- Given a session ends, then a session summary is generated and queued for embedding
- Given the embedding queue is full (default 10,000), when a new item is enqueued, then the oldest item is dropped
- Given the server starts, then un-embedded records are detected and queued for catch-up

**Files to Create or Modify:**
- `packages/server/src/lib/embeddings/worker.ts` — **NEW** — `EmbeddingWorker` class with queue management
- `packages/server/src/lib/embeddings/summarizer.ts` — **NEW** — Generate text summaries for events and sessions (heuristic, not LLM-based)
- `packages/server/src/index.ts` — Start embedding worker alongside alert engine
- `packages/server/src/routes/events.ts` — After ingest, enqueue relevant events

**Tests:**
- `packages/server/src/lib/embeddings/__tests__/worker.test.ts` — **NEW** — Queue management, backpressure, catch-up

---

### Story 2.4: Cosine Similarity Search Implementation

**Description:** Implement the in-application cosine similarity search over stored embeddings with tenant scoping.

**Acceptance Criteria:**
- Given embeddings for tenant A, when tenant B performs a similarity search, then zero results from tenant A are returned
- Given a query "authentication error", when searching event embeddings, then events about authentication errors rank highest
- Given `minScore = 0.7`, then only results with cosine similarity ≥ 0.7 are returned
- Given `limit = 5`, then at most 5 results are returned, sorted by similarity descending

**Files to Create or Modify:**
- `packages/server/src/db/embedding-store.ts` — Add `similaritySearch(tenantId, queryVector, opts)` method
- `packages/server/src/lib/embeddings/math.ts` — **NEW** — `cosineSimilarity(a: Float32Array, b: Float32Array)` utility

**Tests:**
- `packages/server/src/db/__tests__/embedding-store.test.ts` — Similarity search tests with known vectors

---

### Story 2.5: `agentlens_recall` MCP Tool

**Description:** Register the `agentlens_recall` tool on the MCP server. The tool takes a natural language query and returns semantically similar past events, sessions, and lessons.

**Acceptance Criteria:**
- Given an agent calls `agentlens_recall` with `{ query: "authentication issues" }`, then it receives a list of relevant past events/sessions ranked by similarity
- Given `scope: 'events'`, then only event embeddings are searched
- Given `scope: 'lessons'`, then only lesson embeddings are searched
- Given `scope: 'all'` (default), then events, sessions, and lessons are all searched
- Given no relevant results, then the tool returns an empty list with a helpful message

**Files to Create or Modify:**
- `packages/mcp/src/tools.ts` — Add `registerRecall(server, transport)` function
- `packages/mcp/src/tools/recall.ts` — **NEW** — `agentlens_recall` tool implementation (calls new REST endpoint)
- `packages/mcp/src/tools.ts` — Update `registerTools` to include `registerRecall`

**Tests:**
- `packages/mcp/src/__tests__/recall.test.ts` — **NEW** — Tool registration and response format

---

### Story 2.6: `GET /api/recall` REST Endpoint

**Description:** Create a REST endpoint for semantic search that the MCP tool and SDKs call.

**Acceptance Criteria:**
- Given `GET /api/recall?query=auth+error&scope=events&limit=10`, then returns `RecallResult` JSON
- Given the endpoint, then all results are tenant-scoped
- Given `minScore` parameter, then results below the threshold are excluded

**Files to Create or Modify:**
- `packages/server/src/routes/recall.ts` — **NEW** — `recallRoutes(store, embeddingStore, embeddingService)` route handler
- `packages/server/src/index.ts` — Register `/api/recall` route with auth middleware

**Tests:**
- `packages/server/src/__tests__/recall.test.ts` — **NEW** — Endpoint tests with mocked embedding store

---

## 7. Epic 3: Lessons Learned (Learn)

**Goal:** Give agents an explicit knowledge store for distilled insights. Not event data — structured, titled, categorized lessons that agents create and retrieve.

### Story 3.1: Lessons Table and Store

**Description:** Create the `lessons` table and implement `LessonStore` with CRUD operations.

**Acceptance Criteria:**
- Given a lesson is created with `tenantId = 'acme'`, when queried by tenant `'acme'`, then the lesson is returned
- Given a lesson is created with `tenantId = 'acme'`, when queried by tenant `'other'`, then it is NOT returned
- Given a lesson is archived (`archived_at` is set), when queried without `includeArchived`, then it is NOT returned
- Given a lesson is retrieved, then its `access_count` increments and `last_accessed_at` updates

**Files to Create or Modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add `lessons` table definition
- `packages/server/src/db/migrate.ts` — Migration for `lessons` table
- `packages/server/src/db/lesson-store.ts` — **NEW** — `LessonStore` class with CRUD, query, search
- `packages/core/src/types.ts` — Add `Lesson`, `LessonQuery`, `LessonImportance` types

**Tests:**
- `packages/server/src/db/__tests__/lesson-store.test.ts` — **NEW** — Full CRUD + tenant isolation tests

---

### Story 3.2: Lessons REST API

**Description:** Create REST endpoints for lesson CRUD operations.

**Acceptance Criteria:**
- `POST /api/lessons` — Creates a lesson, returns the created lesson with ID
- `GET /api/lessons` — Lists lessons with filters (category, agentId, importance, search)
- `GET /api/lessons/:id` — Gets a single lesson
- `PUT /api/lessons/:id` — Updates a lesson
- `DELETE /api/lessons/:id` — Archives a lesson (soft delete)
- All endpoints enforce tenant isolation

**Files to Create or Modify:**
- `packages/server/src/routes/lessons.ts` — **NEW** — `lessonsRoutes(lessonStore)` route handler
- `packages/server/src/index.ts` — Register `/api/lessons` route with auth middleware

**Tests:**
- `packages/server/src/__tests__/lessons.test.ts` — **NEW** — Full endpoint tests

---

### Story 3.3: `agentlens_learn` MCP Tool

**Description:** Register the `agentlens_learn` MCP tool. Supports creating, listing, and retrieving lessons. The tool interface should be simple — agents use it like a notebook.

**Tool operations via `action` parameter:**

| Action | Description |
|--------|-------------|
| `save` | Save a new lesson |
| `list` | List lessons (with optional filters) |
| `get` | Get a specific lesson by ID |
| `update` | Update an existing lesson |
| `delete` | Archive a lesson |
| `search` | Semantic search over lessons |

**Acceptance Criteria:**
- Given an agent calls `agentlens_learn` with `{ action: "save", title: "Always run tests", content: "Before deploying to prod, always run the test suite", category: "deployment" }`, then a lesson is created and the ID is returned
- Given an agent calls `agentlens_learn` with `{ action: "search", query: "deployment best practices" }`, then relevant lessons are returned ranked by relevance
- Given an agent calls `agentlens_learn` with `{ action: "list", category: "error-handling" }`, then only lessons in that category are returned

**Files to Create or Modify:**
- `packages/mcp/src/tools/learn.ts` — **NEW** — `agentlens_learn` tool implementation
- `packages/mcp/src/tools.ts` — Update `registerTools` to include `registerLearn`
- `packages/mcp/src/transport.ts` — Add methods for lesson CRUD API calls

**Tests:**
- `packages/mcp/src/__tests__/learn.test.ts` — **NEW** — Tool registration, each action variant

---

### Story 3.4: Auto-Embed Lessons

**Description:** When a lesson is created or updated, automatically generate and store an embedding for semantic retrieval.

**Acceptance Criteria:**
- Given a lesson is created, then an embedding is generated from `"{title}: {content}"` and stored in the `embeddings` table
- Given a lesson is updated, then the embedding is regenerated
- Given a lesson is archived, then the embedding is NOT deleted (still searchable for recall)

**Files to Create or Modify:**
- `packages/server/src/routes/lessons.ts` — Enqueue embedding on create/update
- `packages/server/src/lib/embeddings/worker.ts` — Handle `lesson` source type

**Tests:**
- `packages/server/src/__tests__/lessons.test.ts` — Verify embedding is created after lesson save

---

## 8. Epic 4: Pattern Analysis (Reflect)

**Goal:** Give agents the ability to analyze their own behavioral patterns — error rates, tool sequences, cost trends, performance changes.

### Story 4.1: Error Pattern Analysis

**Description:** Implement the `error_patterns` analysis type. Queries events with error severity or `tool_error` type, groups them by error message/type, and identifies recurring patterns.

**Acceptance Criteria:**
- Given multiple sessions with similar errors, when `agentlens_reflect` is called with `{ analysis: "error_patterns" }`, then it returns grouped error patterns with frequency counts
- Given error events, then the result includes: error message pattern, occurrence count, first/last seen, preceding tool sequence
- Results are tenant-scoped

**Files to Create or Modify:**
- `packages/server/src/lib/analysis/error-patterns.ts` — **NEW** — Error pattern extraction logic
- `packages/server/src/lib/analysis/index.ts` — **NEW** — Analysis dispatcher

**Tests:**
- `packages/server/src/lib/analysis/__tests__/error-patterns.test.ts` — **NEW**

---

### Story 4.2: Tool Sequence Analysis

**Description:** Implement the `tool_sequences` analysis type. Analyzes sequences of tool calls across sessions to find common patterns, sequences that lead to errors, and sequences that lead to success.

**Acceptance Criteria:**
- Given sessions with tool call events, when `tool_sequences` analysis runs, then common N-gram tool sequences are returned with frequency
- Given error events following tool sequences, then the result identifies which tool sequences commonly precede errors
- Given the analysis, then it reports: most common sequences, error-prone sequences, average sequence length

**Files to Create or Modify:**
- `packages/server/src/lib/analysis/tool-sequences.ts` — **NEW** — Tool sequence N-gram analysis
- `packages/server/src/lib/analysis/index.ts` — Register `tool_sequences` handler

**Tests:**
- `packages/server/src/lib/analysis/__tests__/tool-sequences.test.ts` — **NEW**

---

### Story 4.3: Cost Analysis

**Description:** Implement the `cost_analysis` analysis type. Aggregates cost and token usage across sessions, broken down by task type (inferred from session tags), model, and time period.

**Acceptance Criteria:**
- Given sessions with LLM response events, when `cost_analysis` runs, then it returns cost breakdown by model, by tag, and trend over time
- Given the analysis, then it includes: total cost, average cost per session, cost trend (increasing/decreasing/stable), most expensive operations

**Files to Create or Modify:**
- `packages/server/src/lib/analysis/cost-analysis.ts` — **NEW**
- `packages/server/src/lib/analysis/index.ts` — Register `cost_analysis` handler

**Tests:**
- `packages/server/src/lib/analysis/__tests__/cost-analysis.test.ts` — **NEW**

---

### Story 4.4: Performance Trends Analysis

**Description:** Implement the `performance_trends` analysis type. Tracks latency, success rate, and throughput trends over time.

**Acceptance Criteria:**
- Given sessions over time, when `performance_trends` runs, then it returns trend data: success rate over time, average latency over time, throughput (sessions per hour)
- Trends are identified as: improving, stable, degrading

**Files to Create or Modify:**
- `packages/server/src/lib/analysis/performance-trends.ts` — **NEW**
- `packages/server/src/lib/analysis/index.ts` — Register handler

**Tests:**
- `packages/server/src/lib/analysis/__tests__/performance-trends.test.ts` — **NEW**

---

### Story 4.5: `agentlens_reflect` MCP Tool

**Description:** Register the `agentlens_reflect` MCP tool that calls the analysis API.

**Acceptance Criteria:**
- Given an agent calls `agentlens_reflect` with `{ analysis: "error_patterns" }`, then it receives a structured analysis of error patterns
- Given an agent calls with `{ analysis: "cost_analysis", params: { model: "claude-opus-4-6" } }`, then cost analysis is scoped to that model
- Given an invalid `analysis` type, then the tool returns a helpful error listing valid options

**Files to Create or Modify:**
- `packages/mcp/src/tools/reflect.ts` — **NEW** — `agentlens_reflect` tool
- `packages/mcp/src/tools.ts` — Update `registerTools`
- `packages/mcp/src/transport.ts` — Add `queryAnalysis` method for REST calls

**Tests:**
- `packages/mcp/src/__tests__/reflect.test.ts` — **NEW**

---

### Story 4.6: `GET /api/reflect` REST Endpoint

**Description:** Create the REST endpoint for pattern analysis.

**Acceptance Criteria:**
- `GET /api/reflect?analysis=error_patterns&agentId=X&from=...&to=...` returns `ReflectResult`
- All analysis types are accessible via REST
- Results are tenant-scoped

**Files to Create or Modify:**
- `packages/server/src/routes/reflect.ts` — **NEW** — Route handler
- `packages/server/src/index.ts` — Register `/api/reflect` route

**Tests:**
- `packages/server/src/__tests__/reflect.test.ts` — **NEW**

---

## 9. Epic 5: Cross-Session Context

**Goal:** Enable agents to retrieve relevant context from past sessions for a specific topic, user, or situation.

### Story 5.1: Session Summary Generation

**Description:** When a session ends, automatically generate a text summary from its events. Store in `session_summaries` table. The summary is heuristic (not LLM-generated) — extracts key information from event payloads.

**Summary includes:**
- Agent name and session duration
- Tools used (with counts)
- Errors encountered
- LLM models used and cost
- Session tags
- Key event payloads (truncated)

**Acceptance Criteria:**
- Given a session ends with status `completed`, then a summary record is created in `session_summaries`
- Given a session with tool calls and errors, then the summary mentions the tools and errors
- Given the summary, then topics are extracted from tool names, error messages, and session tags

**Files to Create or Modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add `sessionSummaries` table
- `packages/server/src/db/migrate.ts` — Migration
- `packages/server/src/lib/embeddings/summarizer.ts` — Session summary generation logic
- `packages/server/src/db/sqlite-store.ts` — Hook into session end to trigger summary generation

**Tests:**
- `packages/server/src/lib/embeddings/__tests__/summarizer.test.ts` — **NEW** — Summary generation from event sequences

---

### Story 5.2: Context Retrieval Logic

**Description:** Implement context retrieval that combines semantic search over session summaries with relevant lessons to provide rich cross-session context.

**Acceptance Criteria:**
- Given a topic query "database migrations", when `context` is called, then sessions involving database-related tools and migration events are returned
- Given a `userId` parameter, when context is retrieved, then only sessions with that user in metadata are included
- Given context results, then each session includes: summary, relevance score, key events, start/end time
- Given relevant lessons exist, then they are included alongside session context

**Files to Create or Modify:**
- `packages/server/src/lib/context/retrieval.ts` — **NEW** — `ContextRetriever` class combining session search + lesson lookup
- `packages/server/src/lib/context/index.ts` — **NEW** — exports

**Tests:**
- `packages/server/src/lib/context/__tests__/retrieval.test.ts` — **NEW**

---

### Story 5.3: `agentlens_context` MCP Tool

**Description:** Register the `agentlens_context` MCP tool that retrieves relevant cross-session context for a given topic or situation.

**Acceptance Criteria:**
- Given an agent calls `agentlens_context` with `{ topic: "database migrations" }`, then it receives relevant past sessions and lessons
- Given `userId: "user123"`, then results are filtered to sessions involving that user
- Given the results, then each session includes a summary and key events (not the full timeline)
- Given no relevant context, then the tool returns an empty result with a message "No relevant past context found"

**Files to Create or Modify:**
- `packages/mcp/src/tools/context.ts` — **NEW** — `agentlens_context` tool
- `packages/mcp/src/tools.ts` — Update `registerTools`
- `packages/mcp/src/transport.ts` — Add `queryContext` method

**Tests:**
- `packages/mcp/src/__tests__/context.test.ts` — **NEW**

---

### Story 5.4: `GET /api/context` REST Endpoint

**Description:** Create the REST endpoint for cross-session context retrieval.

**Acceptance Criteria:**
- `GET /api/context?topic=database+migrations&userId=user123&limit=5` returns `ContextResult`
- Results are tenant-scoped
- Sessions are ranked by relevance and recency

**Files to Create or Modify:**
- `packages/server/src/routes/context.ts` — **NEW** — Route handler
- `packages/server/src/index.ts` — Register `/api/context` route

**Tests:**
- `packages/server/src/__tests__/context.test.ts` — **NEW**

---

## 10. Epic 6: SDK & Dashboard

**Goal:** Expose the new capabilities through the TypeScript and Python SDKs, and add dashboard pages for lessons management and semantic search.

### Story 6.1: TypeScript SDK — Recall, Learn, Reflect, Context

**Description:** Add methods to `AgentLensClient` for the four new capabilities.

**New Methods:**
```typescript
// Recall
async recall(query: RecallQuery): Promise<RecallResult>

// Lessons
async createLesson(lesson: CreateLessonInput): Promise<Lesson>
async getLessons(query?: LessonQuery): Promise<{ lessons: Lesson[]; total: number }>
async getLesson(id: string): Promise<Lesson>
async updateLesson(id: string, updates: Partial<CreateLessonInput>): Promise<Lesson>
async deleteLesson(id: string): Promise<{ id: string; archived: boolean }>

// Reflect
async reflect(query: ReflectQuery): Promise<ReflectResult>

// Context
async getContext(query: ContextQuery): Promise<ContextResult>
```

**Acceptance Criteria:**
- All new methods follow the same error handling pattern as existing methods
- All methods use the authenticated API key (tenant scoped server-side)
- Types are exported from `@agentlensai/sdk`

**Files to Create or Modify:**
- `packages/sdk/src/client.ts` — Add new methods
- `packages/sdk/src/index.ts` — Export new types
- `packages/core/src/types.ts` — Export new types (shared with server)
- `packages/core/src/index.ts` — Export new types

**Tests:**
- `packages/sdk/src/__tests__/recall.test.ts` — **NEW**
- `packages/sdk/src/__tests__/lessons.test.ts` — **NEW**
- `packages/sdk/src/__tests__/reflect.test.ts` — **NEW**
- `packages/sdk/src/__tests__/context.test.ts` — **NEW**

---

### Story 6.2: Python SDK — Recall, Learn, Reflect, Context

**Description:** Add methods to `AgentLensClient` and `AsyncAgentLensClient` for the four new capabilities.

**New Methods (sync client):**
```python
def recall(self, query: RecallQuery) -> RecallResult
def create_lesson(self, lesson: CreateLessonInput) -> Lesson
def get_lessons(self, query: LessonQuery | None = None) -> LessonListResult
def get_lesson(self, lesson_id: str) -> Lesson
def update_lesson(self, lesson_id: str, updates: UpdateLessonInput) -> Lesson
def delete_lesson(self, lesson_id: str) -> DeleteLessonResult
def reflect(self, query: ReflectQuery) -> ReflectResult
def get_context(self, query: ContextQuery) -> ContextResult
```

**Acceptance Criteria:**
- All new methods follow existing patterns (Pydantic models, `_request` helper, camelCase aliases)
- Both sync and async clients are updated
- New Pydantic models for all new types

**Files to Create or Modify:**
- `packages/python-sdk/src/agentlensai/models.py` — Add new Pydantic models (`Lesson`, `RecallQuery`, `RecallResult`, `ReflectQuery`, `ReflectResult`, `ContextQuery`, `ContextResult`, etc.)
- `packages/python-sdk/src/agentlensai/client.py` — Add methods to sync client
- `packages/python-sdk/src/agentlensai/async_client.py` — Add methods to async client
- `packages/python-sdk/src/agentlensai/_utils.py` — Add query param builders for new endpoints

**Tests:**
- `packages/python-sdk/tests/test_recall.py` — **NEW**
- `packages/python-sdk/tests/test_lessons.py` — **NEW**
- `packages/python-sdk/tests/test_reflect.py` — **NEW**
- `packages/python-sdk/tests/test_context.py` — **NEW**

---

### Story 6.3: Dashboard — Lessons Management Page

**Description:** Create a new `/lessons` page in the dashboard for viewing, creating, editing, and archiving lessons.

**UI Components:**
- Lesson list with filters (category, importance, search)
- Lesson detail view/edit panel
- Create lesson modal
- Category sidebar/filter
- Import/export lessons (JSON)

**Acceptance Criteria:**
- Given the user navigates to `/lessons`, then a list of lessons is displayed grouped by category
- Given the user clicks "New Lesson", then a creation form appears with fields: title, content, category, importance
- Given a lesson is selected, then its full content is displayed with edit/archive buttons
- Given the search box, when the user types, then lessons are filtered by title/content (client-side for now)

**Files to Create or Modify:**
- `packages/dashboard/src/pages/Lessons.tsx` — **NEW** — Main lessons page
- `packages/dashboard/src/components/LessonEditor.tsx` — **NEW** — Create/edit form
- `packages/dashboard/src/components/LessonList.tsx` — **NEW** — List with filters
- `packages/dashboard/src/api/client.ts` — Add lesson API methods
- `packages/dashboard/src/App.tsx` — Add `/lessons` route

**Tests:**
- Component tests with Vitest + Testing Library (follow existing patterns)

---

### Story 6.4: Dashboard — Semantic Search Page

**Description:** Create a `/search` page in the dashboard for semantic search across events, sessions, and lessons.

**UI Components:**
- Search input with scope selector (all, events, sessions, lessons)
- Results list showing source type, text preview, similarity score
- Click-through to source (event detail, session detail, lesson)
- Time range filter

**Acceptance Criteria:**
- Given the user types "authentication error" and clicks search, then semantically similar results are displayed
- Given a result is clicked, then the user navigates to the source detail page
- Given results, then they show: source type badge, text preview, similarity score bar, timestamp

**Files to Create or Modify:**
- `packages/dashboard/src/pages/Search.tsx` — **NEW** — Semantic search page
- `packages/dashboard/src/components/SearchResults.tsx` — **NEW** — Result cards
- `packages/dashboard/src/api/client.ts` — Add `recall` API method
- `packages/dashboard/src/App.tsx` — Add `/search` route

**Tests:**
- Component tests

---

### Story 6.5: Dashboard — Reflect/Insights Page

**Description:** Create an `/insights` page in the dashboard that shows pattern analysis results.

**UI Components:**
- Analysis type selector (error patterns, tool sequences, cost analysis, performance trends)
- Time range picker
- Agent filter
- Visualization cards per analysis type:
  - Error patterns: table of recurring errors with counts
  - Tool sequences: flow diagram or sequence chart
  - Cost analysis: cost breakdown charts
  - Performance trends: line charts

**Acceptance Criteria:**
- Given the user selects "Error Patterns", then a table of recurring errors is displayed with frequency, first/last seen
- Given the user selects "Cost Analysis", then cost breakdown by model and over time is shown
- Given an agent filter is applied, then analysis is scoped to that agent

**Files to Create or Modify:**
- `packages/dashboard/src/pages/Insights.tsx` — **NEW**
- `packages/dashboard/src/components/ErrorPatterns.tsx` — **NEW**
- `packages/dashboard/src/components/ToolSequences.tsx` — **NEW**
- `packages/dashboard/src/components/CostInsights.tsx` — **NEW**
- `packages/dashboard/src/components/PerformanceTrends.tsx` — **NEW**
- `packages/dashboard/src/api/client.ts` — Add `reflect` API method
- `packages/dashboard/src/App.tsx` — Add `/insights` route

**Tests:**
- Component tests

---

## 11. Epic 7: Documentation & CLI

**Goal:** Document all new capabilities and add CLI commands for lessons management and search.

### Story 7.1: CLI — Recall Command

**Description:** Add `agentlens recall <query>` CLI command for semantic search.

**Usage:**
```
agentlens recall "authentication errors"
agentlens recall "deployment failures" --scope events --limit 20
agentlens recall "user onboarding" --from 2026-01-01 --to 2026-02-01
```

**Acceptance Criteria:**
- Given `agentlens recall "auth errors"`, then results are displayed in a formatted table with source type, score, and text preview
- Given `--scope sessions`, then only session results are shown
- Given `--json` flag, then raw JSON is output

**Files to Create or Modify:**
- `packages/cli/src/commands/recall.ts` — **NEW**
- `packages/cli/src/index.ts` — Register `recall` command

**Tests:**
- `packages/cli/src/__tests__/recall.test.ts` — **NEW**

---

### Story 7.2: CLI — Lessons Commands

**Description:** Add `agentlens lessons` subcommands for lesson management.

**Usage:**
```
agentlens lessons list
agentlens lessons list --category deployment --importance high
agentlens lessons create --title "Always run tests" --content "..." --category deployment
agentlens lessons get <id>
agentlens lessons update <id> --content "updated content"
agentlens lessons delete <id>
agentlens lessons search "deployment best practices"
```

**Acceptance Criteria:**
- All CRUD operations work correctly via CLI
- List output is formatted as a table
- `--json` flag outputs raw JSON for all commands

**Files to Create or Modify:**
- `packages/cli/src/commands/lessons.ts` — **NEW**
- `packages/cli/src/index.ts` — Register `lessons` command

**Tests:**
- `packages/cli/src/__tests__/lessons.test.ts` — **NEW**

---

### Story 7.3: CLI — Reflect Command

**Description:** Add `agentlens reflect <analysis>` CLI command for pattern analysis.

**Usage:**
```
agentlens reflect error_patterns
agentlens reflect cost_analysis --agent my-agent --from 2026-01-01
agentlens reflect tool_sequences --limit 20
agentlens reflect performance_trends
```

**Acceptance Criteria:**
- Each analysis type outputs formatted results appropriate to its type
- Error patterns: table with error, count, first/last seen
- Cost analysis: cost summary with breakdowns
- Tool sequences: sequence list with frequencies

**Files to Create or Modify:**
- `packages/cli/src/commands/reflect.ts` — **NEW**
- `packages/cli/src/index.ts` — Register `reflect` command

**Tests:**
- `packages/cli/src/__tests__/reflect.test.ts` — **NEW**

---

### Story 7.4: CLI — Context Command

**Description:** Add `agentlens context <topic>` CLI command.

**Usage:**
```
agentlens context "database migrations"
agentlens context "user authentication" --user user123
agentlens context "API rate limiting" --agent my-agent --limit 3
```

**Acceptance Criteria:**
- Given a topic, then relevant sessions and lessons are displayed
- Sessions show: ID, summary, relevance score, time
- Lessons show: title, content preview

**Files to Create or Modify:**
- `packages/cli/src/commands/context.ts` — **NEW**
- `packages/cli/src/index.ts` — Register `context` command

**Tests:**
- `packages/cli/src/__tests__/context.test.ts` — **NEW**

---

### Story 7.5: API Reference Documentation

**Description:** Document all new REST endpoints with request/response schemas.

**New endpoints to document:**
- `GET /api/recall` — Semantic search
- `POST /api/lessons` — Create lesson
- `GET /api/lessons` — List lessons
- `GET /api/lessons/:id` — Get lesson
- `PUT /api/lessons/:id` — Update lesson
- `DELETE /api/lessons/:id` — Archive lesson
- `GET /api/reflect` — Pattern analysis
- `GET /api/context` — Cross-session context

**Acceptance Criteria:**
- Each endpoint has: description, parameters, request body schema, response schema, example curl commands
- Tenant isolation behavior is documented for each endpoint
- Error responses are documented

**Files to Create or Modify:**
- `docs/api-reference.md` — **NEW** or update existing
- `docs/api/recall.md` — **NEW**
- `docs/api/lessons.md` — **NEW**
- `docs/api/reflect.md` — **NEW**
- `docs/api/context.md` — **NEW**

---

### Story 7.6: Agent Integration Guide

**Description:** Write a comprehensive guide for agent developers on how to use the self-query tools.

**Contents:**
1. Overview — what memory capabilities exist
2. Setup — MCP server config, API key, embedding backend
3. Recall — when to use it, query strategies, interpreting results
4. Learn — lesson lifecycle, categories, when agents should create lessons
5. Reflect — analysis types, scheduling periodic reflection
6. Context — retrieving relevant history, use in system prompts
7. Patterns — recommended patterns for self-improving agents
8. Configuration — embedding backends, tuning parameters

**Acceptance Criteria:**
- Guide includes working code examples for MCP tool usage
- Guide includes Python SDK and TypeScript SDK examples
- Configuration options are clearly documented with defaults

**Files to Create or Modify:**
- `docs/guides/agent-memory.md` — **NEW** — Main integration guide
- `docs/guides/tenant-isolation.md` — **NEW** — Tenant setup and security guide
- `docs/guides/embedding-config.md` — **NEW** — Embedding backend configuration
- `README.md` — Update with new features section

---

### Story 7.7: MCP Tool Descriptions & Examples

**Description:** Ensure all four new MCP tools have excellent descriptions that help AI agents understand when and how to use them.

**Acceptance Criteria:**
- Each tool's description field explains: what it does, when to use it, what it returns
- Parameter descriptions are clear and include example values
- The descriptions work well as system-prompt-style guidance for the calling agent

**Files to Create or Modify:**
- `packages/mcp/src/tools/recall.ts` — Refine tool description
- `packages/mcp/src/tools/learn.ts` — Refine tool description
- `packages/mcp/src/tools/reflect.ts` — Refine tool description
- `packages/mcp/src/tools/context.ts` — Refine tool description

---

## Appendix A: Configuration Reference

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTLENS_EMBEDDING_BACKEND` | `local` | Embedding backend: `local` or `openai` |
| `AGENTLENS_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Model name for local backend |
| `OPENAI_API_KEY` | — | Required if embedding backend is `openai` |
| `AGENTLENS_EMBEDDING_QUEUE_SIZE` | `10000` | Max items in embedding queue |
| `AGENTLENS_EMBEDDING_BATCH_SIZE` | `32` | Batch size for embedding generation |

### New Server Config Fields

```typescript
interface ServerConfig {
  // ... existing fields ...
  embeddingBackend: 'local' | 'openai';
  embeddingModel: string;
  openaiApiKey?: string;
  embeddingQueueSize: number;
  embeddingBatchSize: number;
}
```

## Appendix B: Dependency Changes

### New Dependencies — Server

| Package | Purpose | Version |
|---------|---------|---------|
| `@xenova/transformers` | Local ONNX inference for embeddings | `^2.17` |

### New Dev Dependencies

None expected — existing test framework (Vitest) covers all new code.

## Appendix C: Implementation Order

Recommended implementation sequence (respecting dependencies):

1. **Epic 1** (Tenant Isolation) — Foundation for everything else
2. **Epic 2, Stories 2.1-2.2** (Embedding infra + storage) — Needed by recall, learn, context
3. **Epic 3** (Lessons) — Self-contained after tenant isolation
4. **Epic 2, Stories 2.3-2.6** (Background worker + recall) — Depends on embedding infra
5. **Epic 5, Story 5.1** (Session summaries) — Depends on embedding worker
6. **Epic 4** (Reflect) — Pure query/analysis, can parallel with 5
7. **Epic 5, Stories 5.2-5.4** (Context retrieval) — Depends on session summaries + recall
8. **Epic 6** (SDK + Dashboard) — After all endpoints are stable
9. **Epic 7** (Docs + CLI) — Last, documents final state

## Appendix D: File Index

### New Files (by package)

**`packages/core/src/`**
- Types added to `types.ts` (Lesson, RecallQuery, ReflectQuery, ContextQuery, etc.)

**`packages/server/src/`**
- `db/tenant-scoped-store.ts` — TenantScopedStore wrapper
- `db/embedding-store.ts` — Embedding CRUD + similarity search
- `db/lesson-store.ts` — Lesson CRUD
- `lib/embeddings/index.ts` — Embedding service factory
- `lib/embeddings/local.ts` — Local ONNX embedding
- `lib/embeddings/openai.ts` — OpenAI embedding
- `lib/embeddings/types.ts` — Embedding types
- `lib/embeddings/worker.ts` — Background embedding worker
- `lib/embeddings/summarizer.ts` — Text summarizer for events/sessions
- `lib/embeddings/math.ts` — Cosine similarity
- `lib/analysis/index.ts` — Analysis dispatcher
- `lib/analysis/error-patterns.ts` — Error pattern analysis
- `lib/analysis/tool-sequences.ts` — Tool sequence analysis
- `lib/analysis/cost-analysis.ts` — Cost analysis
- `lib/analysis/performance-trends.ts` — Performance trend analysis
- `lib/context/index.ts` — Context retrieval exports
- `lib/context/retrieval.ts` — Context retrieval logic
- `routes/recall.ts` — GET /api/recall
- `routes/lessons.ts` — Lesson CRUD endpoints
- `routes/reflect.ts` — GET /api/reflect
- `routes/context.ts` — GET /api/context

**`packages/mcp/src/`**
- `tools/recall.ts` — agentlens_recall MCP tool
- `tools/learn.ts` — agentlens_learn MCP tool
- `tools/reflect.ts` — agentlens_reflect MCP tool
- `tools/context.ts` — agentlens_context MCP tool

**`packages/sdk/src/`**
- Methods added to `client.ts`

**`packages/python-sdk/src/agentlensai/`**
- Models added to `models.py`
- Methods added to `client.py` and `async_client.py`

**`packages/cli/src/`**
- `commands/recall.ts`
- `commands/lessons.ts`
- `commands/reflect.ts`
- `commands/context.ts`

**`packages/dashboard/src/`**
- `pages/Lessons.tsx`
- `pages/Search.tsx`
- `pages/Insights.tsx`
- `components/LessonEditor.tsx`
- `components/LessonList.tsx`
- `components/SearchResults.tsx`
- `components/ErrorPatterns.tsx`
- `components/ToolSequences.tsx`
- `components/CostInsights.tsx`
- `components/PerformanceTrends.tsx`

**`docs/`**
- `api/recall.md`
- `api/lessons.md`
- `api/reflect.md`
- `api/context.md`
- `guides/agent-memory.md`
- `guides/tenant-isolation.md`
- `guides/embedding-config.md`

### Modified Files

- `packages/core/src/types.ts` — New types + tenantId on existing types
- `packages/core/src/storage.ts` — IEventStore extension for new capabilities
- `packages/core/src/index.ts` — Re-exports
- `packages/server/src/config.ts` — Embedding config
- `packages/server/src/db/schema.sqlite.ts` — New tables + columns
- `packages/server/src/db/migrate.ts` — Migration logic
- `packages/server/src/db/sqlite-store.ts` — Tenant-scoped queries throughout
- `packages/server/src/middleware/auth.ts` — tenantId in ApiKeyInfo
- `packages/server/src/routes/events.ts` — TenantScopedStore + embedding queue
- `packages/server/src/routes/sessions.ts` — TenantScopedStore
- `packages/server/src/routes/agents.ts` — TenantScopedStore
- `packages/server/src/routes/stats.ts` — TenantScopedStore
- `packages/server/src/routes/analytics.ts` — TenantScopedStore
- `packages/server/src/routes/alerts.ts` — TenantScopedStore
- `packages/server/src/routes/ingest.ts` — TenantScopedStore
- `packages/server/src/routes/stream.ts` — Tenant-scoped SSE
- `packages/server/src/routes/api-keys.ts` — tenantId on creation
- `packages/server/src/lib/alert-engine.ts` — Tenant-aware evaluation
- `packages/server/src/index.ts` — New routes, embedding worker startup
- `packages/mcp/src/tools.ts` — Register new tools
- `packages/mcp/src/transport.ts` — New API call methods
- `packages/sdk/src/client.ts` — New methods
- `packages/sdk/src/index.ts` — New exports
- `packages/python-sdk/src/agentlensai/models.py` — New models
- `packages/python-sdk/src/agentlensai/client.py` — New methods
- `packages/python-sdk/src/agentlensai/async_client.py` — New methods
- `packages/python-sdk/src/agentlensai/_utils.py` — New param builders
- `packages/dashboard/src/api/client.ts` — New API methods
- `packages/dashboard/src/App.tsx` — New routes
- `packages/dashboard/src/components/Layout.tsx` — New nav items

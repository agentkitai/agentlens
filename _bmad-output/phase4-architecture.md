# AgentLens v0.9.0 — Technical Architecture

## Phase 4: Agent Memory Sharing & Agent-to-Agent Discovery

**Date:** 2026-02-09  
**Author:** Winston (Software Architect, BMAD Pipeline)  
**Source:** Phase 4 PRD (John, 2026-02-09)  
**Status:** Draft  
**Version:** 0.1

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architectural Principles](#2-architectural-principles)
3. [Component Architecture](#3-component-architecture)
4. [Redaction Pipeline Deep-Dive](#4-redaction-pipeline-deep-dive)
5. [Shared Knowledge Store](#5-shared-knowledge-store)
6. [Agent Discovery & Delegation](#6-agent-discovery--delegation)
7. [Trust Model](#7-trust-model)
8. [Data Models](#8-data-models)
9. [API Design](#9-api-design)
10. [MCP Tool Specifications](#10-mcp-tool-specifications)
11. [Security Analysis](#11-security-analysis)
12. [Privacy Requirements Traceability](#12-privacy-requirements-traceability)
13. [Migration Strategy](#13-migration-strategy)
14. [Testing Strategy](#14-testing-strategy)
15. [Open Decisions](#15-open-decisions)

---

## 1. System Overview

Phase 4 extends AgentLens from a single-tenant observability platform into a collaborative agent ecosystem. Two new subsystems are introduced:

1. **Community Sharing Subsystem** — Anonymized lesson sharing with a 6-layer redaction pipeline
2. **Discovery & Delegation Subsystem** — MCP service mesh for capability-based agent delegation

Both subsystems share a **zero-trust boundary model**: all data crossing the tenant boundary is treated as public. The tenant instance is the trust anchor; the shared pool is assumed hostile.

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TENANT BOUNDARY (trusted)                    │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────────┐   │
│  │ AgentLens│  │ Dashboard │  │      MCP Server              │   │
│  │  Server  │  │  (React)  │  │  ┌────────────────────────┐ │   │
│  │          │  │           │  │  │ agentlens_community    │ │   │
│  │ REST API │  │ Sharing   │  │  │ agentlens_discover     │ │   │
│  │ ┌──────┐ │  │ Controls  │  │  │ agentlens_delegate     │ │   │
│  │ │Redact│ │  │           │  │  └────────────────────────┘ │   │
│  │ │Pipe- │ │  │ Network   │  │                              │   │
│  │ │line  │ │  │ Graph     │  └──────────────────────────────┘   │
│  │ └──────┘ │  │           │                                     │
│  └────┬─────┘  └───────────┘                                     │
│       │                                                          │
│  ┌────┴──────────────────────────────────────────────────────┐   │
│  │              Tenant-Local SQLite (Drizzle ORM)            │   │
│  │  events │ sessions │ agents │ lessons │ embeddings        │   │
│  │  sharing_config │ sharing_audit │ capability_registry     │   │
│  │  delegation_log │ anonymous_id_map │ deny_list_rules      │   │
│  └───────────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────────┘
                            │ mTLS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SHARED POOL (untrusted / assumed hostile)        │
│                                                                  │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐  │
│  │  Community Pool API  │  │    Discovery Pool API            │  │
│  │  POST /pool/share    │  │    POST /pool/register           │  │
│  │  POST /pool/search   │  │    POST /pool/discover           │  │
│  │  DELETE /pool/purge   │  │    POST /pool/delegate           │  │
│  │  POST /pool/flag     │  │    DELETE /pool/unregister        │  │
│  └──────────┬───────────┘  └──────────┬──────────────────────┘  │
│             │                          │                         │
│  ┌──────────┴──────────────────────────┴─────────────────────┐  │
│  │         PostgreSQL + pgvector (shared_lessons,             │  │
│  │         capability_registry, delegation_proxy,             │  │
│  │         reputation_scores, moderation_queue)               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Package Additions

Phase 4 adds new modules within existing packages (no new top-level packages):

| Package | New Modules |
|---------|-------------|
| `@agentlensai/core` | `community-types.ts`, `discovery-types.ts`, `redaction-types.ts` |
| `@agentlensai/server` | `lib/redaction/`, `lib/community/`, `lib/discovery/`, `db/sharing-*`, `db/discovery-*` |
| `@agentlensai/mcp` | `tools/community.ts`, `tools/discover.ts`, `tools/delegate.ts` |
| `@agentlensai/dashboard` | `pages/Community/`, `pages/Discovery/`, `components/NetworkGraph/` |

---

## 2. Architectural Principles

### P1: Structural Privacy (not policy privacy)
Data leakage is prevented by code architecture, not configuration. Raw lesson content is never passed to any function that has network access. The redaction pipeline produces an immutable `RedactedLesson` type; only this type is accepted by the sharing transport layer.

### P2: Fail-Closed Everything
If any redaction layer errors, the lesson is blocked. If the pool is unreachable, sharing fails silently. If anonymous ID mapping is missing, delegation is rejected. Ambiguity → deny.

### P3: Tenant-Local First
All new data structures (sharing config, audit logs, capability registrations, delegation logs) are stored in the tenant-local SQLite database. The shared pool stores only the minimum anonymized data needed for cross-tenant functionality.

### P4: Type-Enforced Boundaries
TypeScript's type system enforces the trust boundary. `RawLesson` and `RedactedLesson` are distinct types. Functions accepting `RedactedLesson` cannot receive `RawLesson` — the compiler prevents it. Network transport functions only accept anonymized types.

### P5: Additive, Non-Breaking
All Phase 4 features are additive. No existing tables are modified (new columns on existing tables are allowed only with defaults). Core observability continues to work if sharing/discovery are never enabled.

---

## 3. Component Architecture

### 3.1 Redaction Pipeline (`packages/server/src/lib/redaction/`)

```
┌────────────────────────────────────────────────────────────┐
│                    RedactionPipeline                        │
│                                                            │
│  RawLesson ──┐                                             │
│              ▼                                             │
│  ┌──────────────────┐                                      │
│  │ L1: SecretLayer   │ regex: sk-*, ghp_*, AKIA*, entropy  │
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │ L2: PIILayer      │ regex + NER (Presidio via WASM/API) │
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │ L3: PathUrlLayer  │ URL/path/IP pattern matching        │
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │ L4: TenantDeId    │ strip IDs, org names, agent names   │
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │ L5: DenyList      │ tenant-configurable block patterns  │
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │ L6: HumanReview   │ optional queue (pass-through if off)│
│  └────────┬─────────┘                                      │
│           ▼                                                │
│  RedactedLesson (or BLOCKED)                               │
│                                                            │
│  Side effects: RedactionAuditLog (per-layer findings)      │
└────────────────────────────────────────────────────────────┘
```

### 3.2 Community Sharing (`packages/server/src/lib/community/`)

```
┌─────────────────────────────────────────────────┐
│              CommunityService                    │
│                                                  │
│  share(lessonId) ────────────────────────────┐   │
│    │                                         │   │
│    ├─ check tenant/agent/category toggles    │   │
│    ├─ load lesson from LessonStore           │   │
│    ├─ run RedactionPipeline                  │   │
│    ├─ generate anonymous lesson ID           │   │
│    ├─ compute embedding (reuse existing)     │   │
│    ├─ send to PoolTransport                  │   │
│    └─ write SharingAuditLog                  │   │
│                                              │   │
│  search(query) ──────────────────────────────┤   │
│    ├─ query PoolTransport                    │   │
│    └─ write QueryAuditLog                    │   │
│                                              │   │
│  purge() ────────────────────────────────────┤   │
│    ├─ send purge to PoolTransport            │   │
│    ├─ retire anonymous contributor ID        │   │
│    └─ write PurgeAuditLog                    │   │
└──────────────────────────────────────────────────┘
```

### 3.3 Discovery & Delegation (`packages/server/src/lib/discovery/`)

```
┌─────────────────────────────────────────────────┐
│             DiscoveryService                     │
│                                                  │
│  registerCapability(agentId, cap) ───────────┐   │
│    ├─ validate structured schema             │   │
│    ├─ store locally (capability_registry)    │   │
│    ├─ if scope=public: push to PoolTransport │   │
│    └─ assign rotating anonymous ID           │   │
│                                              │   │
│  discover(query) ────────────────────────────┤   │
│    ├─ query local registry (scope=internal)  │   │
│    ├─ query PoolTransport (scope=public)     │   │
│    ├─ merge + rank by composite score        │   │
│    └─ return anonymized results              │   │
│                                              │   │
│  delegate(targetAnonId, task) ───────────────┤   │
│    ├─ check outbound rate limit              │   │
│    ├─ check min trust threshold              │   │
│    ├─ route through PoolTransport (proxy)    │   │
│    ├─ await result or timeout                │   │
│    ├─ update trust score                     │   │
│    └─ write DelegationAuditLog               │   │
└──────────────────────────────────────────────────┘
```

---

## 4. Redaction Pipeline Deep-Dive

### 4.1 Pipeline Interface

```typescript
// packages/core/src/redaction-types.ts

/** Branded type: raw lesson content that has NOT been redacted */
export interface RawLessonContent {
  readonly __brand: 'RawLessonContent';
  readonly title: string;
  readonly content: string;
  readonly context: Record<string, unknown>;
}

/** Branded type: lesson content that HAS passed all redaction layers */
export interface RedactedLessonContent {
  readonly __brand: 'RedactedLessonContent';
  readonly title: string;
  readonly content: string;
  readonly context: Record<string, unknown>;
}

/** A single finding from a redaction layer */
export interface RedactionFinding {
  layer: RedactionLayerName;
  category: string;          // e.g., 'api_key', 'email', 'internal_url'
  originalLength: number;    // length of redacted span (NOT the content itself)
  replacement: string;       // e.g., '[API_KEY]', '[EMAIL]', '[INTERNAL_URL]'
  startOffset: number;
  endOffset: number;
  confidence: number;        // 0.0–1.0
}

export type RedactionLayerName =
  | 'secret_detection'
  | 'pii_detection'
  | 'url_path_scrubbing'
  | 'tenant_deidentification'
  | 'semantic_denylist'
  | 'human_review';

/** Result of running the full pipeline */
export type RedactionResult =
  | { status: 'redacted'; content: RedactedLessonContent; findings: RedactionFinding[]; }
  | { status: 'blocked'; reason: string; layer: RedactionLayerName; }
  | { status: 'pending_review'; reviewId: string; }
  | { status: 'error'; error: string; layer: RedactionLayerName; };

/** Plugin interface for custom redaction layers */
export interface RedactionLayer {
  readonly name: RedactionLayerName | string;
  readonly order: number;  // lower = runs first
  process(input: string, context: RedactionContext): RedactionLayerResult;
}

export interface RedactionContext {
  tenantId: string;
  agentId?: string;
  category: string;
  denyListPatterns: string[];
  knownTenantTerms: string[];  // org name, project names, agent names, user names
}

export interface RedactionLayerResult {
  output: string;
  findings: RedactionFinding[];
  blocked: boolean;
  blockReason?: string;
}
```

### 4.2 Layer 1: Secret Detection

**Library:** Custom regex engine (no external dependency — patterns are well-known and maintainable).

**Patterns (non-exhaustive, maintained in `secret-patterns.ts`):**

| Category | Pattern | Example |
|----------|---------|---------|
| OpenAI keys | `/sk-[a-zA-Z0-9]{20,}/` | `sk-abc123...` |
| GitHub PATs | `/ghp_[a-zA-Z0-9]{36}/` | `ghp_xxxx...` |
| AWS keys | `/AKIA[0-9A-Z]{16}/` | `AKIAIOSFODNN7EXAMPLE` |
| Slack tokens | `/xox[bpras]-[a-zA-Z0-9-]+/` | `xoxb-...` |
| Bearer tokens | `/Bearer\s+[a-zA-Z0-9._~+\/=-]{20,}/` | `Bearer eyJ...` |
| Basic auth | `/Basic\s+[a-zA-Z0-9+\/=]{10,}/` | `Basic dXNlcjpw...` |
| URL passwords | `/\/\/[^:]+:[^@]+@/` | `//user:pass@host` |
| High-entropy strings | Shannon entropy > 4.5 bits/char, length > 20 | Random hex/base64 |
| Private keys | `/-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/` | PEM blocks |
| Connection strings | `/(?:mongodb|postgres|mysql|redis):\/\/[^\s]+/` | `postgres://user:pass@...` |

**Entropy calculator:** Sliding window (64 chars) across the text. Any window with Shannon entropy > 4.5 and no dictionary words (checked against a 10K common-word set) is flagged. This catches random tokens/secrets that don't match known patterns.

**Replacement:** `[SECRET_REDACTED]` with a sequential index: `[SECRET_REDACTED_1]`, `[SECRET_REDACTED_2]`, etc.

### 4.3 Layer 2: PII Detection

**Approach:** Hybrid regex + optional NER. The regex layer is always-on (zero external deps). NER (via Presidio or a bundled ONNX model) is optional but recommended.

**Regex patterns:**

| Category | Pattern |
|----------|---------|
| Email | `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/` |
| Phone (intl) | `/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/` |
| SSN | `/\b\d{3}-\d{2}-\d{4}\b/` |
| Credit card | `/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/` (Luhn-validated) |
| IP addresses (all) | `/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/` |

**NER integration (optional):** If configured, the layer calls a local Presidio instance (Docker sidecar or embedded Python subprocess via the existing Python SDK bridge). Entities detected: `PERSON`, `LOCATION`, `ORGANIZATION`, `PHONE_NUMBER`, `EMAIL_ADDRESS`, `CREDIT_CARD`, `US_SSN`, `IP_ADDRESS`.

**Replacement:** `[PII_TYPE]` — e.g., `[PERSON]`, `[EMAIL]`, `[PHONE]`.

**False-negative handling:** The regex layer is deliberately broad (may over-match). Over-redaction is acceptable; under-redaction is not. The NER layer adds precision on top.

### 4.4 Layer 3: URL/Path Scrubbing

**Patterns:**

| Category | Detection | Replacement |
|----------|-----------|-------------|
| Internal URLs | URL with private hostname (not in public suffix list), RFC 1918 IP, or `.local`/`.internal` TLD | `[INTERNAL_URL]` |
| File paths | Unix paths (`/home/`, `/var/`, `/etc/`, `/Users/`), Windows paths (`C:\`, `\\server\`) | `[FILE_PATH]` |
| Private IPs | `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `127.x.x.x` | `[PRIVATE_IP]` |
| Hostnames | Patterns like `*.corp.*`, `*.internal.*`, known cloud internal patterns (`*.compute.internal`) | `[INTERNAL_HOST]` |

**Public URL preservation:** URLs pointing to well-known public domains (github.com, stackoverflow.com, docs.python.org, etc.) are preserved — they carry useful context without leaking tenant info. A configurable allowlist of public domains is maintained.

### 4.5 Layer 4: Tenant De-identification

This layer uses **tenant-specific context** (loaded at pipeline initialization):

- Tenant ID, org name, project names → from config
- Agent names, agent IDs → from agents table  
- User names, user IDs → from auth/config
- Custom terms → admin-configured list of terms to always strip

**Method:** Case-insensitive string replacement with `[TENANT_ENTITY]`. Also strips UUIDs that match known tenant/agent/user ID formats.

### 4.6 Layer 5: Semantic Deny-List

**Configuration:** Admin defines patterns in `deny_list_rules` table:

```typescript
interface DenyListRule {
  id: string;
  tenantId: string;
  pattern: string;       // plain text or regex (prefixed with '/')
  isRegex: boolean;
  action: 'block';       // always block (never redact-and-continue)
  reason: string;        // e.g., "Contains Project X references"
  createdAt: string;
}
```

**Behavior:** If ANY deny-list pattern matches, the entire lesson is **blocked** from sharing (not redacted — blocked entirely). This is the "nuclear option" for content that should never leave the tenant.

### 4.7 Layer 6: Human Review Gate

**When enabled (`sharing_config.humanReviewEnabled = true`):**

1. The lesson is saved to `sharing_review_queue` table with status `pending`
2. Dashboard shows the review queue with redaction diff (original → redacted)
3. Admin approves → lesson proceeds to pool transport
4. Admin rejects → lesson is marked `rejected`, never shared
5. Lessons auto-expire from the queue after 7 days (configurable)

**When disabled (default):** This layer is a pass-through — no delay.

### 4.8 Pipeline Orchestration

```typescript
// packages/server/src/lib/redaction/pipeline.ts

export class RedactionPipeline {
  private layers: RedactionLayer[];

  constructor(
    private readonly config: RedactionConfig,
    customLayers?: RedactionLayer[],
  ) {
    this.layers = [
      new SecretDetectionLayer(),
      new PIIDetectionLayer(config.presidioEndpoint),
      new UrlPathScrubbingLayer(config.publicDomainAllowlist),
      new TenantDeidentificationLayer(),
      new SemanticDenyListLayer(),
      ...(customLayers ?? []),
      new HumanReviewLayer(config.humanReviewEnabled),
    ].sort((a, b) => a.order - b.order);
  }

  async process(raw: RawLessonContent, ctx: RedactionContext): Promise<RedactionResult> {
    let text = `${raw.title}\n---\n${raw.content}`;
    const allFindings: RedactionFinding[] = [];

    for (const layer of this.layers) {
      let result: RedactionLayerResult;
      try {
        result = await layer.process(text, ctx);
      } catch (error) {
        // FAIL-CLOSED: any layer error blocks the lesson (PR-11)
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          layer: layer.name as RedactionLayerName,
        };
      }

      if (result.blocked) {
        return {
          status: 'blocked',
          reason: result.blockReason ?? 'Blocked by redaction layer',
          layer: layer.name as RedactionLayerName,
        };
      }

      text = result.output;
      allFindings.push(...result.findings);
    }

    // Split back into title and content
    const [title, ...contentParts] = text.split('\n---\n');

    return {
      status: 'redacted',
      content: {
        __brand: 'RedactedLessonContent' as const,
        title: title ?? '',
        content: contentParts.join('\n---\n'),
        context: {},  // context is always stripped (never shared)
      },
      findings: allFindings,
    };
  }
}
```

**Key design choice:** The `context` field of lessons is **always stripped** — it contains structured data that is too varied to reliably redact. Only title and content (natural language text) pass through the pipeline.

---

## 5. Shared Knowledge Store

### 5.1 Pool Architecture

The shared pool is a **separate service** — a lightweight HTTP server backed by PostgreSQL + pgvector. It can be:

- **Self-hosted (org-internal):** Same machine or internal network. For enterprise tenants that want internal-only sharing.
- **Community-hosted (public):** Hosted by the AgentLens project or community. For open ecosystem sharing.

The pool exposes a simple REST API. It stores **zero tenant-identifying metadata**.

### 5.2 Pool Database Schema (PostgreSQL)

```sql
-- Shared lessons (anonymized)
CREATE TABLE shared_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_contributor_id UUID NOT NULL,  -- rotated per purge cycle
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,  -- matches tenant embedding dimensions
  reputation_score REAL NOT NULL DEFAULT 50.0,
  flag_count INTEGER NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_epoch INTEGER NOT NULL,  -- unix epoch (no precise timestamp — PR-43)
  quality_signals JSONB NOT NULL DEFAULT '{}'  -- {successRate, usageCount} — anonymized
);

CREATE INDEX idx_shared_lessons_category ON shared_lessons(category);
CREATE INDEX idx_shared_lessons_reputation ON shared_lessons(reputation_score);
CREATE INDEX idx_shared_lessons_contributor ON shared_lessons(anonymous_contributor_id);
CREATE INDEX idx_shared_lessons_embedding ON shared_lessons USING ivfflat (embedding vector_cosine_ops);

-- Reputation events (for gaming resistance)
CREATE TABLE reputation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES shared_lessons(id) ON DELETE CASCADE,
  voter_anonymous_id UUID NOT NULL,  -- anonymous tenant ID of voter
  delta REAL NOT NULL,                -- +/- score change
  reason TEXT NOT NULL,               -- 'implicit_success', 'implicit_failure', 'explicit_helpful', 'explicit_unhelpful'
  created_epoch INTEGER NOT NULL
);

-- Per-voter daily limit enforcement (PR-19 / FR-19)
CREATE UNIQUE INDEX idx_reputation_voter_lesson_day
  ON reputation_events(voter_anonymous_id, lesson_id, (created_epoch / 86400));

-- Moderation queue
CREATE TABLE moderation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES shared_lessons(id) ON DELETE CASCADE,
  reporter_anonymous_id UUID NOT NULL,
  reason TEXT NOT NULL,  -- 'spam', 'harmful', 'low_quality', 'sensitive_data'
  created_epoch INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_flags_reporter_lesson
  ON moderation_flags(reporter_anonymous_id, lesson_id);

-- Purge tokens (for offline kill switch — PR-37)
CREATE TABLE purge_tokens (
  anonymous_contributor_id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL,  -- bcrypt hash of the pre-shared purge token
  created_epoch INTEGER NOT NULL
);

-- Capability registry (discovery)
CREATE TABLE registered_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_agent_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  custom_type TEXT,  -- only for task_type = 'custom'
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  quality_metrics JSONB NOT NULL DEFAULT '{}',
  trust_score_percentile REAL NOT NULL DEFAULT 50.0,
  estimated_latency_ms INTEGER,
  estimated_cost_usd REAL,
  max_input_bytes INTEGER,
  scope TEXT NOT NULL DEFAULT 'internal',  -- 'internal' or 'public'
  registered_epoch INTEGER NOT NULL,
  last_seen_epoch INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_capabilities_task_type ON registered_capabilities(task_type);
CREATE INDEX idx_capabilities_active ON registered_capabilities(active) WHERE active = TRUE;
CREATE INDEX idx_capabilities_agent ON registered_capabilities(anonymous_agent_id);

-- Delegation proxy (in-flight delegations)
CREATE TABLE delegation_requests (
  id UUID PRIMARY KEY,  -- idempotency key
  requester_anonymous_id UUID NOT NULL,
  target_anonymous_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  input_encrypted BYTEA NOT NULL,  -- encrypted with target's public key
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected, completed, timeout, error
  output_encrypted BYTEA,  -- encrypted with requester's public key
  timeout_epoch INTEGER NOT NULL,
  created_epoch INTEGER NOT NULL,
  completed_epoch INTEGER
);

CREATE INDEX idx_delegations_target_status
  ON delegation_requests(target_anonymous_id, status) WHERE status = 'pending';
```

### 5.3 Tenant-Local Schema Additions (SQLite / Drizzle)

```typescript
// packages/server/src/db/schema.sqlite.ts (additions)

// ─── Sharing Configuration ────────────────────────────────
export const sharingConfig = sqliteTable('sharing_config', {
  tenantId: text('tenant_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  humanReviewEnabled: integer('human_review_enabled', { mode: 'boolean' }).notNull().default(false),
  poolEndpoint: text('pool_endpoint'),  // null = community default
  anonymousContributorId: text('anonymous_contributor_id'),  // UUID, rotated on purge
  purgeToken: text('purge_token'),  // pre-shared token for offline purge (PR-37)
  rateLimitPerHour: integer('rate_limit_per_hour').notNull().default(50),
  volumeAlertThreshold: integer('volume_alert_threshold').notNull().default(100),
  updatedAt: text('updated_at').notNull(),
});

// ─── Per-Agent Sharing Toggle ────────────────────────────
export const agentSharingConfig = sqliteTable(
  'agent_sharing_config',
  {
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    categories: text('categories').notNull().default('[]'),  // JSON array of enabled categories
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.agentId] }),
  ],
);

// ─── Deny-List Rules ────────────────────────────────────
export const denyListRules = sqliteTable('deny_list_rules', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  pattern: text('pattern').notNull(),
  isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
});

// ─── Sharing Audit Log ────────────────────────────────────
export const sharingAuditLog = sqliteTable(
  'sharing_audit_log',
  {
    id: text('id').primaryKey(),  // ULID
    tenantId: text('tenant_id').notNull(),
    eventType: text('event_type').notNull(),  // 'share', 'query', 'purge', 'rate', 'flag'
    lessonId: text('lesson_id'),  // local lesson ID (share events)
    anonymousLessonId: text('anonymous_lesson_id'),  // pool lesson ID
    lessonHash: text('lesson_hash'),  // SHA-256 of redacted content
    redactionFindings: text('redaction_findings'),  // JSON summary
    queryText: text('query_text'),  // search events
    resultIds: text('result_ids'),  // JSON array of anonymous IDs returned
    poolEndpoint: text('pool_endpoint'),
    initiatedBy: text('initiated_by'),  // 'agent:<id>' or 'admin:<id>'
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    index('idx_sharing_audit_tenant_ts').on(table.tenantId, table.timestamp),
    index('idx_sharing_audit_type').on(table.tenantId, table.eventType),
  ],
);

// ─── Human Review Queue ────────────────────────────────────
export const sharingReviewQueue = sqliteTable(
  'sharing_review_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    originalTitle: text('original_title').notNull(),
    originalContent: text('original_content').notNull(),
    redactedTitle: text('redacted_title').notNull(),
    redactedContent: text('redacted_content').notNull(),
    redactionFindings: text('redaction_findings').notNull(),  // JSON
    status: text('status').notNull().default('pending'),  // pending, approved, rejected, expired
    reviewedBy: text('reviewed_by'),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_review_queue_tenant_status').on(table.tenantId, table.status),
  ],
);

// ─── Anonymous ID Mapping ────────────────────────────────
export const anonymousIdMap = sqliteTable(
  'anonymous_id_map',
  {
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    anonymousAgentId: text('anonymous_agent_id').notNull(),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),  // 24h rotation (PR-24)
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.agentId, table.validFrom] }),
    index('idx_anon_map_anon_id').on(table.anonymousAgentId),
  ],
);

// ─── Capability Registry (local) ────────────────────────
export const capabilityRegistry = sqliteTable(
  'capability_registry',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    taskType: text('task_type').notNull(),
    customType: text('custom_type'),
    inputSchema: text('input_schema').notNull(),  // JSON
    outputSchema: text('output_schema').notNull(),  // JSON
    qualityMetrics: text('quality_metrics').notNull().default('{}'),  // JSON
    estimatedLatencyMs: integer('estimated_latency_ms'),
    estimatedCostUsd: real('estimated_cost_usd'),
    maxInputBytes: integer('max_input_bytes'),
    scope: text('scope').notNull().default('internal'),  // 'internal' or 'public'
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    acceptDelegations: integer('accept_delegations', { mode: 'boolean' }).notNull().default(false),
    inboundRateLimit: integer('inbound_rate_limit').notNull().default(10),  // per minute
    outboundRateLimit: integer('outbound_rate_limit').notNull().default(20),  // per minute
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_capability_tenant_agent').on(table.tenantId, table.agentId),
    index('idx_capability_task_type').on(table.tenantId, table.taskType),
  ],
);

// ─── Delegation Log ────────────────────────────────────
export const delegationLog = sqliteTable(
  'delegation_log',
  {
    id: text('id').primaryKey(),  // delegation request ID
    tenantId: text('tenant_id').notNull(),
    direction: text('direction').notNull(),  // 'outbound' or 'inbound'
    agentId: text('agent_id').notNull(),  // local agent
    anonymousTargetId: text('anonymous_target_id'),  // for outbound
    anonymousSourceId: text('anonymous_source_id'),  // for inbound
    taskType: text('task_type').notNull(),
    status: text('status').notNull(),  // pending, accepted, rejected, completed, timeout, error
    requestSizeBytes: integer('request_size_bytes'),
    responseSizeBytes: integer('response_size_bytes'),
    executionTimeMs: integer('execution_time_ms'),
    costUsd: real('cost_usd'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_delegation_tenant_ts').on(table.tenantId, table.createdAt),
    index('idx_delegation_agent').on(table.tenantId, table.agentId),
    index('idx_delegation_status').on(table.tenantId, table.status),
  ],
);
```

### 5.4 Data Flow: Sharing a Lesson

```
Agent calls agentlens_community({ action: 'share', lessonId: 'xxx' })
   │
   ▼
CommunityService.share()
   │
   ├─ 1. Check sharingConfig.enabled (tenant level)           → REJECT if off
   ├─ 2. Check agentSharingConfig.enabled (agent level)       → REJECT if off
   ├─ 3. Check category in agentSharingConfig.categories      → REJECT if not allowed
   ├─ 4. Check rate limit (50/hr default, PR-40)              → REJECT if exceeded
   │
   ├─ 5. Load lesson from LessonStore (tenant-local)
   │     (RawLessonContent type)
   │
   ├─ 6. Build RedactionContext:
   │     - tenantId, agentId, category
   │     - denyListPatterns from deny_list_rules table
   │     - knownTenantTerms from config + agents table
   │
   ├─ 7. Run RedactionPipeline.process(raw, ctx)
   │     Returns: RedactedLessonContent | blocked | pending_review | error
   │     - If blocked/error → REJECT, write audit log
   │     - If pending_review → save to review queue, return "pending"
   │     - If redacted → continue
   │
   ├─ 8. Generate anonymous lesson ID (UUID v4, no correlation)
   ├─ 9. Get/reuse embedding for redacted content
   ├─10. Get anonymous contributor ID (from sharingConfig)
   │
   ├─11. POST to pool: { id, contributorId, category, title, content, embedding, qualitySignals }
   │     (ONLY RedactedLessonContent fields — type system enforces this)
   │
   └─12. Write sharingAuditLog: { lessonId, anonLessonId, hash, findings, poolEndpoint }
```

### 5.5 Data Flow: Kill Switch (Purge)

```
Admin clicks "Kill Switch" or calls DELETE /api/community/purge
   │
   ▼
CommunityService.purge()
   │
   ├─ 1. Load sharingConfig for tenant
   ├─ 2. Get anonymousContributorId
   ├─ 3. DELETE to pool: /pool/purge { contributorId, purgeToken }
   │     Pool deletes ALL shared_lessons WHERE anonymous_contributor_id = :id
   │     Pool deletes purge_tokens entry
   │     Pool returns { deleted: N }
   │
   ├─ 4. Set sharingConfig.enabled = false
   ├─ 5. Retire old anonymousContributorId (PR-36)
   ├─ 6. Generate new anonymousContributorId + purgeToken for future use
   ├─ 7. Write audit log
   │
   └─ 8. Return { purged: N, verified: true }

Verification (GET /api/community/purge/verify):
   └─ Queries pool: GET /pool/count?contributorId=<old_id>
      Returns { count: 0 } (or error if ID already retired)
```

**Offline purge (PR-37):** The purge token is pre-shared with the pool at registration time. Even if the tenant instance is down, an admin can call the pool directly with the token. The pool authenticates via bcrypt comparison of the token hash.

---

## 6. Agent Discovery & Delegation

### 6.1 Capability Schema

```typescript
// packages/core/src/discovery-types.ts

export const TASK_TYPES = [
  'translation',
  'summarization',
  'code-review',
  'data-extraction',
  'classification',
  'generation',
  'analysis',
  'transformation',
  'custom',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export interface CapabilityRegistration {
  taskType: TaskType;
  customType?: string;  // max 64 chars, /^[a-z0-9-]+$/, only for taskType='custom'
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  inputMimeTypes?: string[];
  outputMimeTypes?: string[];
  qualityMetrics: {
    successRate?: number;      // 0.0–1.0
    avgLatencyMs?: number;
    avgCostUsd?: number;
    completedTasks?: number;
  };
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope: 'internal' | 'public';
}

export interface DiscoveryQuery {
  taskType: TaskType;
  customType?: string;
  inputMimeType?: string;
  outputMimeType?: string;
  minTrustScore?: number;    // 0–100 percentile
  maxCostUsd?: number;
  maxLatencyMs?: number;
  scope: 'internal' | 'public' | 'all';
  limit?: number;  // max 20
}

export interface DiscoveryResult {
  anonymousAgentId: string;
  taskType: TaskType;
  customType?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  trustScorePercentile: number;
  provisional: boolean;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  qualityMetrics: {
    successRate?: number;
    completedTasks?: number;
  };
}

export interface DelegationRequest {
  requestId: string;          // UUID, idempotency key
  targetAnonymousId: string;
  taskType: TaskType;
  input: unknown;             // validated against target's inputSchema
  timeoutMs: number;          // default 30000
  fallbackEnabled?: boolean;  // default false
  maxRetries?: number;        // default 3
}

export interface DelegationResult {
  requestId: string;
  status: 'success' | 'rejected' | 'timeout' | 'error';
  output?: unknown;
  executionTimeMs?: number;
  costIncurred?: number;
  retriesUsed?: number;
}

export type DelegationPhase = 'request' | 'accepted' | 'rejected' | 'executing' | 'completed' | 'timeout' | 'error';
```

### 6.2 Discovery Protocol

**Internal scope:** Query is handled entirely locally — scan `capability_registry` table for matching capabilities, rank by trust score, return results. No network calls.

**Public scope:** Query is sent to the pool's `/pool/discover` endpoint. The pool scans `registered_capabilities` and returns anonymized results. The tenant instance merges with local results (if `scope=all`) and returns unified ranking.

**Ranking formula (FR-48):**

```
compositeScore = 0.5 * trustScorePercentile/100
               + 0.3 * (1 - normalizedCost)
               + 0.2 * (1 - normalizedLatency)

where:
  normalizedCost = min(estimatedCostUsd / maxCostUsd, 1.0)  // relative to query constraint
  normalizedLatency = min(estimatedLatencyMs / maxLatencyMs, 1.0)
```

### 6.3 Delegation Protocol (4-phase)

```
  Requester                    Pool (Proxy)                    Target
     │                            │                              │
     │  1. POST /pool/delegate    │                              │
     │  {requestId, targetId,     │                              │
     │   taskType, input, timeout}│                              │
     │ ──────────────────────────>│                              │
     │                            │  2. Store request, notify    │
     │                            │     target via polling       │
     │                            │ ─────────────────────────── >│
     │                            │                              │
     │                            │  3. Target accepts/rejects   │
     │                            │     (within 5s)              │
     │                            │< ────────────────────────── ─│
     │                            │                              │
     │  (if rejected/timeout)     │                              │
     │< ─────────────────────────│                              │
     │                            │                              │
     │                            │  4. Target executes task     │
     │                            │     and returns result       │
     │                            │< ────────────────────────── ─│
     │                            │                              │
     │  5. Pool returns result    │                              │
     │< ─────────────────────────│                              │
     │                            │                              │
```

**Proxy enforcement (FR-60, PR-25):** The pool acts as a message broker. Requester and target never learn each other's network address. The pool stores encrypted payloads — it can route but cannot read task data.

**Encryption:** Each agent generates an ephemeral X25519 key pair when registering for delegation. The pool stores the public key. Delegation inputs are encrypted with the target's public key; outputs are encrypted with the requester's public key. The pool cannot decrypt either.

**Target notification:** Targets poll `GET /pool/delegate/inbox?agentId=<anonymousId>` every 2 seconds (configurable). Future: WebSocket upgrade for real-time notification.

**Idempotency (FR-61):** The `requestId` is a client-generated UUID. The pool deduplicates — if a request with the same ID exists, return its current status instead of creating a new one.

**Fallback (FR-62):** When enabled, the requester's instance handles fallback locally. On failure/timeout, it picks the next-ranked discovery result and sends a new delegation request (up to `maxRetries` times).

### 6.4 Anonymous ID Rotation (PR-24)

Every 24 hours, a cron job (or lazy rotation on first use after expiry) generates a new anonymous agent ID for each discoverable agent:

```typescript
function getOrRotateAnonymousId(tenantId: string, agentId: string): string {
  const now = new Date();
  const existing = db.select()
    .from(anonymousIdMap)
    .where(and(
      eq(anonymousIdMap.tenantId, tenantId),
      eq(anonymousIdMap.agentId, agentId),
      gte(anonymousIdMap.validUntil, now.toISOString()),
    ))
    .get();

  if (existing) return existing.anonymousAgentId;

  const newId = crypto.randomUUID();
  const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  db.insert(anonymousIdMap).values({
    tenantId, agentId,
    anonymousAgentId: newId,
    validFrom: now.toISOString(),
    validUntil: validUntil.toISOString(),
  }).run();

  // Update capability in pool with new anonymous ID
  poolTransport.updateAnonymousId(oldId, newId);

  return newId;
}
```

Old anonymous IDs are kept in the map for audit trail purposes but are no longer valid for discovery/delegation.

---

## 7. Trust Model

### 7.1 Trust Score Computation

```typescript
interface TrustScoreInput {
  healthScoreHistory: number[];      // rolling 30 days, daily snapshots
  delegationSuccessRate: number;     // 0.0–1.0 over last 30 days
  delegationCount: number;           // total completed delegations
  avgResponseTimeMs: number;
  flagCount: number;                 // moderation flags received
}

function computeRawTrustScore(input: TrustScoreInput): number {
  const healthAvg = mean(input.healthScoreHistory);  // 0–100

  // Weight delegation success more as count increases
  const delegationWeight = Math.min(input.delegationCount / 50, 1.0);  // ramp to full weight at 50 delegations
  const healthWeight = 1.0 - delegationWeight * 0.4;  // health always >= 60% of score

  const rawScore =
    healthWeight * healthAvg +
    delegationWeight * 0.4 * (input.delegationSuccessRate * 100) -
    input.flagCount * 5;  // penalty per flag

  return Math.max(0, Math.min(100, rawScore));
}
```

**Percentile conversion:** Raw scores are converted to percentiles relative to all agents with the same `taskType` in the pool. This is computed periodically (every hour) by the pool and stored in `registered_capabilities.trust_score_percentile`.

### 7.2 Provisional Status (FR-65)

Agents with < 10 completed delegations receive `provisional: true` in discovery results and a fixed score of 50th percentile. This prevents both unfair penalization of new agents and gaming by creating fresh identities.

### 7.3 Privilege Escalation Prevention

- Delegation requests are validated against the target's declared `inputSchema`. The pool rejects requests with input that doesn't match the schema.
- A delegated agent operates in its own security context — it cannot inherit the requester's permissions.
- The requester's AgentLens instance validates the output against `outputSchema` before passing it to the requesting agent.
- Delegation depth is limited to 1 (no transitive delegation in v0.9.0). A target agent cannot re-delegate to a third agent via the pool. This is enforced by the pool tracking a `depth` field on requests.

### 7.4 Anti-Poisoning (Shared Pool)

For **lessons:**
- Reputation scoring with per-tenant daily caps (max ±5 per day per voter per lesson)
- Auto-hide below reputation threshold (default 20)
- Community flagging → auto-hide at 3+ flags → moderator review
- `ban-source` bans the anonymous contributor ID (not the tenant)

For **capabilities:**
- Trust scores derive from actual health data — hard to fake
- Provisional status prevents sockpuppet gaming
- Pool monitors for anomalous registration patterns (e.g., 1000 capabilities from one contributor)

For **delegation results:**
- Output schema validation
- Requester agent independently evaluates quality
- Bad outcomes automatically degrade trust score

---

## 8. Data Models

### 8.1 Core TypeScript Interfaces

```typescript
// packages/core/src/community-types.ts

/** Lesson categories for sharing */
export const LESSON_SHARING_CATEGORIES = [
  'model-performance',
  'error-patterns',
  'tool-usage',
  'cost-optimization',
  'prompt-engineering',
  'general',
] as const;
export type LessonSharingCategory = typeof LESSON_SHARING_CATEGORIES[number];

/** Sharing configuration (tenant level) */
export interface SharingConfig {
  tenantId: string;
  enabled: boolean;
  humanReviewEnabled: boolean;
  poolEndpoint: string | null;
  anonymousContributorId: string | null;
  rateLimitPerHour: number;
  volumeAlertThreshold: number;
  updatedAt: string;
}

/** Per-agent sharing configuration */
export interface AgentSharingConfig {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  categories: LessonSharingCategory[];
  updatedAt: string;
}

/** Shared lesson as stored in the pool (anonymized) */
export interface SharedLesson {
  id: string;
  category: LessonSharingCategory;
  title: string;
  content: string;
  reputationScore: number;
  qualitySignals: {
    successRate?: number;
    usageCount?: number;
  };
}

/** Search result returned to querying agents */
export interface CommunitySearchResult {
  lessons: SharedLesson[];
  total: number;
  query: string;
}

/** Moderation flag reasons */
export type FlagReason = 'spam' | 'harmful' | 'low-quality' | 'sensitive-data';

/** Moderation action */
export type ModerationAction = 'approve' | 'remove' | 'ban-source';

/** Sharing audit event */
export interface SharingAuditEvent {
  id: string;
  tenantId: string;
  eventType: 'share' | 'query' | 'purge' | 'rate' | 'flag';
  lessonId?: string;
  anonymousLessonId?: string;
  lessonHash?: string;
  redactionFindings?: RedactionFinding[];
  queryText?: string;
  resultIds?: string[];
  poolEndpoint?: string;
  initiatedBy: string;
  timestamp: string;
}
```

---

## 9. API Design

### 9.1 Community Sharing REST API

All endpoints are tenant-scoped (via auth middleware, same as existing API).

#### `POST /api/community/share`

Submit a lesson for sharing. Triggers the redaction pipeline.

```typescript
// Request
interface ShareRequest {
  lessonId: string;
}

// Response (200)
interface ShareResponse {
  status: 'shared' | 'pending_review' | 'blocked';
  anonymousLessonId?: string;  // only if status=shared
  reviewId?: string;           // only if status=pending_review
  blockReason?: string;        // only if status=blocked
  redactionSummary: {
    findingsCount: number;
    layers: string[];
  };
}

// Errors: 400 (invalid lessonId), 403 (sharing disabled), 429 (rate limit)
```

#### `GET /api/community/search`

Search the shared knowledge pool.

```typescript
// Query params
interface SearchParams {
  query: string;                    // natural language query
  category?: LessonSharingCategory;
  minReputation?: number;           // default 0
  limit?: number;                   // default 10, max 50
  poolEndpoint?: string;            // override configured pool
}

// Response (200)
interface SearchResponse {
  results: SharedLesson[];
  total: number;
}
```

#### `DELETE /api/community/purge`

Kill switch — remove all tenant's shared lessons from the pool.

```typescript
// Response (200)
interface PurgeResponse {
  purged: number;
  newContributorId: string;  // rotated
}

// Error: 404 (no sharing configured), 502 (pool unreachable)
```

#### `GET /api/community/purge/verify`

Verify purge completion.

```typescript
// Response (200)
interface PurgeVerifyResponse {
  remainingCount: number;  // expected: 0
  verifiedAt: string;
}
```

#### `POST /api/community/redaction/test`

Test the redaction pipeline without sharing (PR-13).

```typescript
// Request
interface RedactionTestRequest {
  title: string;
  content: string;
}

// Response (200)
interface RedactionTestResponse {
  redactedTitle: string;
  redactedContent: string;
  findings: RedactionFinding[];
  blocked: boolean;
  blockReason?: string;
}
```

#### `GET /api/community/config`
#### `PUT /api/community/config`

Read/update sharing configuration (tenant-level and agent-level toggles).

#### `GET /api/community/audit`

Query sharing audit log (PR-30).

```typescript
interface AuditQuery {
  type?: 'share' | 'query' | 'purge' | 'rate' | 'flag';
  from?: string;  // ISO 8601
  to?: string;
  limit?: number;
  offset?: number;
}
```

#### `POST /api/community/flag`

Flag a shared lesson.

#### Moderation endpoints (pool-side, authenticated):
- `GET /api/community/moderation/queue`
- `POST /api/community/moderation/:id/action`

### 9.2 Discovery & Delegation REST API

#### `PUT /api/agents/:id/capabilities`

Register or update agent capabilities.

```typescript
// Request
interface RegisterCapabilityRequest {
  capabilities: CapabilityRegistration[];
}

// Response (200)
interface RegisterCapabilityResponse {
  registered: number;
  anonymousAgentId: string;  // current anonymous ID
}
```

#### `DELETE /api/agents/:id/capabilities/:capabilityId`

Remove a capability registration.

#### `GET /api/agents/discover`

Discover agents by capability.

```typescript
// Query params: taskType, customType, inputMimeType, outputMimeType,
//               minTrustScore, maxCostUsd, maxLatencyMs, scope, limit

// Response (200)
interface DiscoverResponse {
  results: DiscoveryResult[];
  total: number;
}
```

#### `POST /api/agents/delegate`

Delegate a task to a discovered agent.

```typescript
// Request
interface DelegateRequest {
  requestId: string;
  targetAnonymousId: string;
  taskType: TaskType;
  input: unknown;
  timeoutMs?: number;
  fallbackEnabled?: boolean;
  maxRetries?: number;
}

// Response (200) — synchronous wait up to timeoutMs
interface DelegateResponse {
  requestId: string;
  status: 'success' | 'rejected' | 'timeout' | 'error';
  output?: unknown;
  executionTimeMs?: number;
  costIncurred?: number;
  retriesUsed?: number;
}

// Errors: 403 (delegation not enabled), 429 (rate limit), 504 (timeout)
```

#### `GET /api/agents/:id/delegations`

Get delegation log for an agent.

#### `GET /api/agents/network`

Get agent network graph data for dashboard visualization.

```typescript
interface NetworkGraphResponse {
  nodes: Array<{
    agentId: string;
    agentName: string;
    taskTypes: TaskType[];
    delegationsIn: number;
    delegationsOut: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    taskType: TaskType;
    count: number;
    avgLatencyMs: number;
    successRate: number;
  }>;
}
```

---

## 10. MCP Tool Specifications

### 10.1 `agentlens_community`

```typescript
// packages/mcp/src/tools/community.ts

server.tool(
  'agentlens_community',
  `Share and search community knowledge — anonymized lessons from the AgentLens ecosystem.

**Actions:**
- share: Share a lesson with the community (triggers redaction pipeline)
- search: Search the shared knowledge pool for relevant lessons
- rate: Rate a previously retrieved lesson as helpful or not helpful

**Privacy:** All shared content passes through a 6-layer redaction pipeline. No identifying information leaves your tenant.`,
  {
    action: z.enum(['share', 'search', 'rate']),
    lessonId: z.string().optional().describe('Lesson ID to share (action=share)'),
    query: z.string().optional().describe('Search query (action=search)'),
    category: z.enum(LESSON_SHARING_CATEGORIES).optional(),
    minReputation: z.number().optional(),
    limit: z.number().optional(),
    targetLessonId: z.string().optional().describe('Anonymous lesson ID to rate (action=rate)'),
    helpful: z.boolean().optional().describe('Whether the lesson was helpful (action=rate)'),
  },
  async (params) => { /* route to CommunityService */ }
);
```

### 10.2 `agentlens_discover`

```typescript
server.tool(
  'agentlens_discover',
  `Discover agents with specific capabilities. Returns ranked results based on trust score, cost, and latency.

**Scope:** 'internal' (same tenant only), 'public' (cross-tenant), or 'all' (both).`,
  {
    taskType: z.enum(TASK_TYPES),
    customType: z.string().optional(),
    inputMimeType: z.string().optional(),
    outputMimeType: z.string().optional(),
    minTrustScore: z.number().optional(),
    maxCostUsd: z.number().optional(),
    maxLatencyMs: z.number().optional(),
    scope: z.enum(['internal', 'public', 'all']).default('internal'),
    limit: z.number().optional(),
  },
  async (params) => { /* route to DiscoveryService */ }
);
```

### 10.3 `agentlens_delegate`

```typescript
server.tool(
  'agentlens_delegate',
  `Delegate a task to a discovered agent. The target agent executes the task and returns the result.

**Protocol:** Request → Accept/Reject → Execute → Return. All communication is proxied — no direct connections.`,
  {
    targetAgentId: z.string().describe('Anonymous agent ID from discovery results'),
    taskType: z.enum(TASK_TYPES),
    input: z.unknown().describe('Task input (must match target\'s inputSchema)'),
    timeoutMs: z.number().default(30000),
    fallbackEnabled: z.boolean().default(false),
    maxRetries: z.number().default(3),
  },
  async (params) => { /* route to DiscoveryService.delegate() */ }
);
```

---

## 11. Security Analysis

### 11.1 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| **Data exfiltration via sharing** | Attacker shares many lessons rapidly to extract tenant data | Rate limiting (50/hr, PR-40), volume alerts (PR-31), redaction pipeline strips all identifying data |
| **Redaction bypass** | Crafted content that evades pattern matching | 6 layers of defense, fail-closed, entropy detection catches unknown formats, deny-list as last resort, human review gate |
| **De-anonymization via lesson content** | Correlation of writing style, domain-specific terms | Tenant de-identification layer strips known terms; shared content is typically short factual lessons, not long-form text |
| **De-anonymization via timing** | Correlate share timestamps with tenant activity | Pool stores only epoch day (not precise timestamp, PR-43), no behavioral metadata |
| **De-anonymization via anonymous ID** | Track anonymous ID across lessons | 24-hour rotation (PR-24), new ID on purge (PR-36) |
| **Pool poisoning** | Inject misleading lessons to harm agents | Reputation system, flagging, auto-hide, moderator tools, ban-source |
| **Delegation data theft** | Pool operator reads delegation payloads | End-to-end encryption (X25519) — pool routes but cannot decrypt |
| **Privilege escalation via delegation** | Delegated agent accesses resources beyond its scope | Delegation depth = 1, agents run in own security context, input/output schema validation |
| **Kill switch failure** | Purged data persists in caches/replicas | Single-writer model (PR-35), no client-side caching (PR-34), verification endpoint (PR-33) |
| **Pool unavailability** | DoS on shared pool | Tenant-local features unaffected (NFR-09), sharing fails gracefully |
| **Replay attack on delegation** | Re-submit old delegation request | Idempotency key (requestId) + timeout epoch — expired requests rejected |
| **Sybil attack on reputation** | Create many tenants to upvote own lessons | Per-voter daily cap (±5 per lesson per day, FR-19), voting requires active tenant with health data |

### 11.2 Type-Level Safety

The most important architectural safety mechanism is the **branded type boundary**:

```typescript
// This is a COMPILE-TIME guarantee. You cannot accidentally pass raw content
// to any function that sends data to the network.

function shareToPool(lesson: RedactedLessonContent): Promise<void>;
//                          ^^^^^^^^^^^^^^^^^^^^^^
// RawLessonContent is NOT assignable to RedactedLessonContent
// because the __brand literals differ.

// The only way to create a RedactedLessonContent is through RedactionPipeline.process()
// which is the single codepath that runs all 6 layers.
```

### 11.3 mTLS Configuration

All tenant-to-pool communication uses mutual TLS (PR-38):

- Tenant generates a client certificate at first pool registration
- Pool verifies client cert but does NOT store tenant identity — the cert is mapped to the anonymous contributor ID only
- Certificate rotation follows the same cycle as anonymous ID rotation (24h)

---

## 12. Privacy Requirements Traceability

Every PRD privacy requirement mapped to its architectural implementation:

| PR | Summary | Implementation |
|----|---------|---------------|
| PR-01 | All content through redaction pipeline | `CommunityService.share()` → `RedactionPipeline.process()` — only path to pool |
| PR-02 | L1 secret detection | `SecretDetectionLayer` — regex + entropy (§4.2) |
| PR-03 | L2 PII detection | `PIIDetectionLayer` — regex + optional Presidio NER (§4.3) |
| PR-04 | L3 URL/path scrubbing | `UrlPathScrubbingLayer` — pattern matching with public domain allowlist (§4.4) |
| PR-05 | L4 tenant de-identification | `TenantDeidentificationLayer` — context-aware term stripping (§4.5) |
| PR-06 | L5 semantic deny-list | `SemanticDenyListLayer` — configurable patterns, blocks entire lesson (§4.6) |
| PR-07 | L6 human review gate | `HumanReviewLayer` — optional queue with dashboard UI (§4.7) |
| PR-08 | Pipeline runs locally | Pipeline is in `packages/server/src/lib/redaction/` — runs in tenant process. `PoolTransport` only accepts `RedactedLessonContent` type |
| PR-09 | Per-layer audit logging | Each layer returns `RedactionFinding[]` → aggregated into `sharingAuditLog` |
| PR-10 | Pluggable layers | `RedactionLayer` interface + `customLayers` param in pipeline constructor (§4.8) |
| PR-11 | Fail-closed mode | Try/catch per layer in pipeline — any error → `{ status: 'error' }` → lesson NOT shared (§4.8) |
| PR-12 | 200+ pattern test suite | `packages/server/src/lib/redaction/__tests__/adversarial-patterns.test.ts` — CI gate |
| PR-13 | Redaction test endpoint | `POST /api/community/redaction/test` — runs pipeline, returns result without sharing (§9.1) |
| PR-14 | Opt-in defaults OFF | `sharingConfig.enabled` defaults `false`, `agentSharingConfig.enabled` defaults `false`, categories default `[]` |
| PR-15 | Tenant master toggle | `sharingConfig.enabled` — checked first in `CommunityService.share()` |
| PR-16 | Agent-level toggle | `agentSharingConfig.enabled` — checked second |
| PR-17 | Category-level toggle | `agentSharingConfig.categories` — checked third |
| PR-18 | Deny-list overrides all | L5 runs after all other layers — match → block regardless of toggles |
| PR-19 | Toggle-off within 1s | Toggle update is synchronous DB write; `share()` reads toggle at call time — no queue |
| PR-20 | UI sharing status panel | Dashboard "Sharing Controls" page shows all levels (§FR-25) |
| PR-21 | Structured taskType only | `CapabilityRegistration.taskType` is enum, no free-text description field |
| PR-22 | Discovery result restrictions | `DiscoveryResult` type explicitly lists allowed fields — no names, IDs, prompts |
| PR-23 | Percentile health scores | `TrustScorePercentile` — pool computes hourly percentile ranking |
| PR-24 | Rotating anonymous IDs | `anonymousIdMap` table with 24h `validUntil`, lazy rotation (§6.4) |
| PR-25 | Delegation via proxy | Pool's `delegation_requests` table — no direct network connections |
| PR-26 | Share event audit | `sharingAuditLog` with all required fields (§5.3 tenant-local schema) |
| PR-27 | Query event audit | `sharingAuditLog` with `eventType='query'`, query text, result IDs |
| PR-28 | Delegation event audit | `delegationLog` table — both inbound and outbound (§5.3) |
| PR-29 | 90-day retention | Configurable via `retention.auditDays` in server config (existing retention engine) |
| PR-30 | JSON export | `GET /api/audit/export?type=sharing&from=&to=` → streams JSON |
| PR-31 | Volume alerts | `CommunityService` checks count against `volumeAlertThreshold` hourly → alert engine |
| PR-32 | 60-second purge | Pool uses `DELETE FROM shared_lessons WHERE anonymous_contributor_id = $1` — indexed, fast |
| PR-33 | Purge verification | `GET /api/community/purge/verify` → `GET /pool/count?contributorId=` |
| PR-34 | No client-side caching | `PoolTransport` sets `Cache-Control: no-store`, tenant never caches pool responses |
| PR-35 | Single-writer model | Pool partitions by `anonymous_contributor_id` — one tenant writes to one partition |
| PR-36 | Retire ID on purge | `CommunityService.purge()` generates new `anonymousContributorId` (§5.5) |
| PR-37 | Offline kill switch | `purge_tokens` table in pool — pre-shared bcrypt token enables direct pool purge |
| PR-38 | mTLS | All `PoolTransport` connections use mutual TLS (§11.3) |
| PR-39 | Zero identifying metadata in pool | Pool schema has no tenant fields — only `anonymous_contributor_id` |
| PR-40 | Rate limiting | `sharingConfig.rateLimitPerHour` checked in `CommunityService.share()` via sliding window counter |
| PR-41 | Data residency | `sharingConfig.poolEndpoint` — configurable per tenant (EU, US, self-hosted) |
| PR-42 | Right-to-deletion | `DELETE /api/community/purge` + verification = complete deletion proof |
| PR-43 | Data minimization | Pool stores only: content, category, embedding, reputation. No timestamps, no usage metadata |
| PR-44 | Auditable pipeline | Entire pipeline is open-source in `packages/server/src/lib/redaction/` |

---

## 13. Migration Strategy

### 13.1 Database Migrations

Phase 4 adds **8 new tables** to tenant-local SQLite and does not modify existing tables:

1. `sharing_config`
2. `agent_sharing_config`
3. `deny_list_rules`
4. `sharing_audit_log`
5. `sharing_review_queue`
6. `anonymous_id_map`
7. `capability_registry`
8. `delegation_log`

Migration is handled by the existing Drizzle migration system (`packages/server/src/db/migrate.ts`).

### 13.2 Pool Deployment

The shared pool is a **new, separate service**. No migration needed — it starts empty. Schema is created via standard PostgreSQL migrations.

**Pool server package:** `packages/pool-server/` (new package — lightweight Express/Fastify server with PostgreSQL client). This is the only new top-level package.

### 13.3 Feature Flags

All Phase 4 features are behind configuration:
- Sharing: `sharingConfig.enabled` (default: false)
- Discovery: `capabilityRegistry` entries (opt-in per agent)
- Delegation: `capabilityRegistry.acceptDelegations` (default: false)

Upgrading to v0.9.0 with zero configuration changes = zero behavioral change.

### 13.4 Rollback

- Tenant-local: new tables can be dropped without affecting existing functionality
- Pool: independent service — can be shut down without affecting core AgentLens
- MCP tools: new tools register alongside existing ones — removing them is a code change but doesn't break existing tool calls

---

## 14. Testing Strategy

### 14.1 Redaction Pipeline Testing

**Adversarial test suite (PR-12):** `packages/server/src/lib/redaction/__tests__/adversarial-patterns.test.ts`

200+ test cases organized by category:

| Category | Examples | Count |
|----------|---------|-------|
| API keys | OpenAI, GitHub, AWS, Slack, Stripe, Twilio, SendGrid, etc. | 40+ |
| PII | Emails, phones, SSNs, credit cards, names, addresses | 40+ |
| URLs/paths | Internal URLs, file paths, private IPs, hostnames | 30+ |
| Secrets | Bearer tokens, Basic auth, connection strings, private keys, high-entropy | 30+ |
| Tenant terms | Org names, project names, agent names embedded in text | 20+ |
| Evasion attempts | Base64-encoded secrets, URL-encoded PII, split-across-lines, unicode confusables | 40+ |

**Every test case asserts:**
1. The sensitive content is redacted (not present in output)
2. The finding is logged with correct category and layer
3. The surrounding context is preserved (not over-redacted beyond the sensitive span)

**CI gate:** 100% detection rate required. Any new pattern that bypasses the pipeline = CI failure.

### 14.2 Integration Tests

| Test Suite | Coverage |
|------------|----------|
| Share → Query cycle | Tenant A shares → Tenant B searches → lesson found, no identifying data |
| Kill switch | Share 100 lessons → purge → verify → 0 remaining (< 60s) |
| Human review | Share with review enabled → lesson held → approve → appears in pool |
| Deny-list | Configure deny pattern → share matching lesson → blocked |
| Toggle controls | Enable/disable at each level → verify immediate effect |
| Register → Discover | Register capability → discover by taskType → found |
| Delegate cycle | Register → discover → delegate → accept → execute → return |
| Delegation timeout | Register → delegate with 1s timeout → target sleeps → timeout error |
| Delegation fallback | Register 3 agents → first 2 fail → third succeeds |
| Rate limiting | Exceed share rate → 429 error |
| Anonymous ID rotation | Rotate ID → old ID not found in discovery |

### 14.3 Red-Team Tests

`packages/server/src/lib/redaction/__tests__/red-team.test.ts`

Automated de-anonymization attempts:
1. Share 50 lessons from "Tenant A" → analyze pool for patterns identifying Tenant A
2. Correlate timing of shares with tenant activity patterns
3. Attempt to extract tenant terms from redacted content via semantic analysis
4. Cross-reference multiple shared lessons to reconstruct tenant identity
5. Attempt discovery metadata correlation across ID rotations

**Target:** 0% success rate.

### 14.4 Performance Benchmarks

| Benchmark | Target | Method |
|-----------|--------|--------|
| Redaction pipeline latency | < 500ms p95 | Benchmark 1000 lessons of varying length |
| Pool search latency (1M lessons) | < 200ms p95 | Load test with pgvector HNSW index |
| Discovery query (10K capabilities) | < 100ms p95 | Load test |
| Delegation overhead | < 200ms p95 | Measure proxy routing time (exclude task execution) |
| Kill switch (100K lessons) | < 60s | Delete + verify |

### 14.5 Coverage Targets

| Module | Target |
|--------|--------|
| Redaction pipeline | ≥ 95% line coverage |
| Community service | ≥ 90% |
| Discovery service | ≥ 90% |
| Pool server | ≥ 85% |
| Overall Phase 4 | ≥ 85% |

---

## 15. Open Decisions

| # | Decision | Options | Recommendation | Impact |
|---|----------|---------|----------------|--------|
| OD-1 | Pool hosting for community | (a) AgentLens project hosts, (b) Community-run, (c) Multiple pools | (a) for bootstrap, protocol supports (c) for future | Adoption |
| OD-2 | NER dependency | (a) Presidio Docker sidecar, (b) Bundled ONNX model, (c) Regex-only default | (c) as default, (a) as optional enhancement | Accuracy vs. simplicity |
| OD-3 | Delegation transport | (a) Polling (simple), (b) WebSocket (real-time), (c) Both | (a) for MVP, (c) for v1.0 | Latency |
| OD-4 | Pool server package location | (a) New `packages/pool-server/`, (b) Separate repo | (a) — keeps monorepo, pool is small | Repo structure |
| OD-5 | Cross-language delegation | (a) Same-language only (v0.9.0), (b) JSON-over-HTTP (language-agnostic) | (a) — delegation proxy is already JSON/HTTP, cross-language works implicitly | Scope |
| OD-6 | Lesson TTL | (a) No expiry, (b) Configurable TTL (e.g., 90 days) | (b) with default 180 days — model-specific lessons go stale | Data quality |
| OD-7 | GuardRails integration | (a) Auto-block delegation below trust threshold, (b) Manual only | (a) — natural extension of guardrail conditions | Safety |

---

*End of Architecture Document. 8 new tenant-local tables, 5 pool tables, 3 new MCP tools, 6 redaction layers, 44 privacy requirements traced.*

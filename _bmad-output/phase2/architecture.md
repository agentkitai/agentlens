# AgentLens v0.7.0 — Architecture Document

## Session Replay Debugger & Agent Benchmarking / A/B Testing

**Date:** 2026-02-08
**Version:** 1.0

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Models](#2-data-models)
3. [Database Schema](#3-database-schema)
4. [API Design](#4-api-design)
5. [MCP Tools Design](#5-mcp-tools-design)
6. [Dashboard Components](#6-dashboard-components)
7. [Integration with Existing Systems](#7-integration-with-existing-systems)
8. [Performance Considerations](#8-performance-considerations)
9. [Statistical Engine Design](#9-statistical-engine-design)

---

## 1. System Overview

### 1.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Dashboard (React)                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ SessionReplay │  │ BenchmarkList    │  │ BenchmarkDetail   │  │
│  │ Page          │  │ Page             │  │ Page              │  │
│  │               │  │                  │  │                   │  │
│  │ ┌───────────┐│  │                  │  │ ┌──────────────┐  │  │
│  │ │ReplayCtrl ││  │                  │  │ │CompareTable  │  │  │
│  │ │Timeline   ││  │                  │  │ │DistCharts    │  │  │
│  │ │ContextPane││  │                  │  │ │Summary       │  │  │
│  │ └───────────┘│  │                  │  │ └──────────────┘  │  │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬──────────┘  │
└─────────┼──────────────────┼──────────────────────┼─────────────┘
          │ HTTP             │ HTTP                  │ HTTP
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Server (Hono)                              │
│                                                                  │
│  ┌────────────────────┐   ┌──────────────────────────────────┐  │
│  │ Replay Routes      │   │ Benchmark Routes                 │  │
│  │ GET /sessions/:id/ │   │ POST   /api/benchmarks           │  │
│  │     replay         │   │ GET    /api/benchmarks            │  │
│  └────────┬───────────┘   │ GET    /api/benchmarks/:id        │  │
│           │               │ PUT    /api/benchmarks/:id/status │  │
│           ▼               │ GET    /api/benchmarks/:id/results│  │
│  ┌────────────────────┐   │ DELETE /api/benchmarks/:id        │  │
│  │ ReplayBuilder      │   └──────────────┬───────────────────┘  │
│  │ (server-side       │                  │                      │
│  │  context compute)  │                  ▼                      │
│  └────────┬───────────┘   ┌──────────────────────────────────┐  │
│           │               │ BenchmarkEngine                   │  │
│           │               │ ├─ MetricAggregator               │  │
│           │               │ ├─ StatisticalComparator          │  │
│           │               │ └─ ResultFormatter                │  │
│           │               └──────────────┬───────────────────┘  │
│           │                              │                      │
│           ▼                              ▼                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Existing Infrastructure                     │    │
│  │  IEventStore │ Sessions │ HealthComputer │ Optimization │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│                    ┌──────────────────┐                          │
│                    │ SQLite (Drizzle) │                          │
│                    │ + new tables:    │                          │
│                    │   benchmarks     │                          │
│                    │   benchmark_     │                          │
│                    │     variants     │                          │
│                    │   benchmark_     │                          │
│                    │     results      │                          │
│                    └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       MCP Package                                │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ agentlens_replay    │  │ agentlens_benchmark              │  │
│  │ tool                │  │ tool                             │  │
│  └────────┬────────────┘  └──────────────┬───────────────────┘  │
│           │ HTTP (AgentLensTransport)     │ HTTP                 │
│           └──────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Design Principles

1. **Read-only replay:** Session replay reads from the existing event store. No writes, no new event types, no mutations.
2. **Server-side computation:** Cumulative context for replay and statistical analysis for benchmarking are computed server-side.
3. **Existing patterns:** Follow Hono route registration, `getTenantStore()`, Drizzle schema, McpServer.tool(), useApi hooks.
4. **Immutable results:** Completed benchmark results are frozen and cached in the database.

---

## 2. Data Models

### 2.1 Replay Data Models (computed, not stored)

Replay state is **computed on-the-fly** from existing event data. No new database tables needed for replay.

```typescript
/**
 * A single step in a replay — one event with its accumulated context.
 */
interface ReplayStep {
  /** 0-based index in the replay */
  index: number;

  /** The event at this step */
  event: AgentLensEvent;

  /** If this event has a paired event (e.g., tool_call → tool_response) */
  pairedEvent?: AgentLensEvent;

  /** Duration between paired events (ms), if applicable */
  pairDurationMs?: number;

  /** Cumulative context at this point in the session */
  context: ReplayContext;
}

/**
 * Cumulative context at a specific point in the replay.
 */
interface ReplayContext {
  /** Total events processed so far (including current) */
  eventIndex: number;
  totalEvents: number;

  /** Cumulative cost in USD */
  cumulativeCostUsd: number;

  /** Elapsed time from session start (ms) */
  elapsedMs: number;

  /** Counts by event type up to this point */
  eventCounts: Record<string, number>;

  /** LLM conversation history up to this point */
  llmHistory: Array<{
    callId: string;
    provider: string;
    model: string;
    messages: LlmMessage[];
    response?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    costUsd: number;
    latencyMs: number;
  }>;

  /** Tool call results available at this point */
  toolResults: Array<{
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
    completed: boolean;
  }>;

  /** Pending approvals at this point */
  pendingApprovals: Array<{
    requestId: string;
    action: string;
    status: 'pending' | 'granted' | 'denied' | 'expired';
  }>;

  /** Error count so far */
  errorCount: number;

  /** Warnings at this point (e.g., high cost, slow tool) */
  warnings: string[];
}

/**
 * Full replay state for a session.
 */
interface ReplayState {
  /** Session metadata */
  session: Session;

  /** Chain validity of the event sequence */
  chainValid: boolean;

  /** Total steps in the replay */
  totalSteps: number;

  /** Ordered replay steps (may be paginated) */
  steps: ReplayStep[];

  /** Pagination info */
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };

  /** Session-level summary */
  summary: {
    totalCost: number;
    totalDurationMs: number;
    totalLlmCalls: number;
    totalToolCalls: number;
    totalErrors: number;
    models: string[];
    tools: string[];
  };
}
```

### 2.2 Benchmark Data Models (stored in DB)

```typescript
/**
 * Benchmark status lifecycle.
 */
type BenchmarkStatus = 'draft' | 'running' | 'completed' | 'cancelled';

/**
 * A benchmark configuration — the parent entity.
 */
interface Benchmark {
  id: string;               // ULID
  tenantId: string;
  name: string;
  description?: string;
  status: BenchmarkStatus;
  /** Agent ID if scoped to one agent (optional, can compare across agents) */
  agentId?: string;
  /** Which metrics to compare */
  metrics: BenchmarkMetric[];
  /** Minimum sessions per variant for completion */
  minSessionsPerVariant: number;
  /** Time range filter for sessions (optional) */
  timeRange?: { from: string; to: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * A variant within a benchmark.
 */
interface BenchmarkVariant {
  id: string;               // ULID
  benchmarkId: string;
  tenantId: string;
  name: string;
  description?: string;
  /** Tag used to identify sessions belonging to this variant */
  tag: string;
  /** Optional: filter to a specific agent */
  agentId?: string;
  /** Order for display */
  sortOrder: number;
}

/**
 * Available metrics for benchmark comparison.
 */
type BenchmarkMetric =
  | 'health_score'
  | 'error_rate'
  | 'avg_cost'
  | 'avg_latency'
  | 'tool_success_rate'
  | 'completion_rate'
  | 'avg_tokens'
  | 'avg_duration';

/**
 * Aggregated metrics for a single variant.
 */
interface VariantMetrics {
  variantId: string;
  variantName: string;
  sessionCount: number;
  metrics: Record<BenchmarkMetric, MetricStats>;
}

/**
 * Statistical summary for a single metric.
 */
interface MetricStats {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  count: number;
  /** Raw values array (for distribution charts) — only included when requested */
  values?: number[];
}

/**
 * Pairwise comparison result between two variants for one metric.
 */
interface MetricComparison {
  metric: BenchmarkMetric;
  variantA: { id: string; name: string; stats: MetricStats };
  variantB: { id: string; name: string; stats: MetricStats };
  /** Absolute difference (B.mean - A.mean) */
  absoluteDiff: number;
  /** Percentage difference ((B.mean - A.mean) / A.mean * 100) */
  percentDiff: number;
  /** Statistical test used */
  testType: 'welch_t' | 'chi_squared';
  /** Test statistic value */
  testStatistic: number;
  /** p-value */
  pValue: number;
  /** 95% confidence interval for the difference */
  confidenceInterval: { lower: number; upper: number };
  /** Effect size (Cohen's d or phi coefficient) */
  effectSize: number;
  /** Is the result statistically significant at p < 0.05? */
  significant: boolean;
  /** Which variant is better for this metric (lower is better for cost/latency/errors, higher for success/completion/health) */
  winner?: string;
  /** Confidence stars: ★★★ p<0.01, ★★ p<0.05, ★ p<0.1, — ns */
  confidence: '★★★' | '★★' | '★' | '—';
}

/**
 * Cached results for a completed benchmark.
 */
interface BenchmarkResults {
  benchmarkId: string;
  tenantId: string;
  /** Per-variant metric summaries */
  variants: VariantMetrics[];
  /** Pairwise comparisons */
  comparisons: MetricComparison[];
  /** Human-readable summary */
  summary: string;
  /** When results were computed */
  computedAt: string;
}
```

---

## 3. Database Schema

### 3.1 New Tables (Drizzle ORM)

```typescript
// ─── Benchmarks Table ──────────────────────────────────────
export const benchmarks = sqliteTable(
  'benchmarks',
  {
    id: text('id').primaryKey(),            // ULID
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', {
      enum: ['draft', 'running', 'completed', 'cancelled'],
    }).notNull().default('draft'),
    agentId: text('agent_id'),              // optional scope
    metrics: text('metrics').notNull(),     // JSON array of BenchmarkMetric
    minSessionsPerVariant: integer('min_sessions_per_variant').notNull().default(30),
    timeRangeFrom: text('time_range_from'), // optional ISO 8601
    timeRangeTo: text('time_range_to'),     // optional ISO 8601
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_benchmarks_tenant').on(table.tenantId),
    index('idx_benchmarks_tenant_status').on(table.tenantId, table.status),
    index('idx_benchmarks_tenant_agent').on(table.tenantId, table.agentId),
  ],
);

// ─── Benchmark Variants Table ──────────────────────────────
export const benchmarkVariants = sqliteTable(
  'benchmark_variants',
  {
    id: text('id').primaryKey(),            // ULID
    benchmarkId: text('benchmark_id').notNull()
      .references(() => benchmarks.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    tag: text('tag').notNull(),             // session tag to match
    agentId: text('agent_id'),             // optional per-variant agent filter
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('idx_bv_benchmark').on(table.benchmarkId),
    index('idx_bv_tenant').on(table.tenantId),
    index('idx_bv_tag').on(table.tenantId, table.tag),
  ],
);

// ─── Benchmark Results (cached, for completed benchmarks) ──
export const benchmarkResults = sqliteTable(
  'benchmark_results',
  {
    id: text('id').primaryKey(),            // ULID
    benchmarkId: text('benchmark_id').notNull()
      .references(() => benchmarks.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    variantMetrics: text('variant_metrics').notNull(),   // JSON: VariantMetrics[]
    comparisons: text('comparisons').notNull(),          // JSON: MetricComparison[]
    summary: text('summary').notNull(),                  // Human-readable text
    computedAt: text('computed_at').notNull(),
  },
  (table) => [
    index('idx_br_benchmark').on(table.benchmarkId),
    index('idx_br_tenant').on(table.tenantId),
  ],
);
```

### 3.2 Migration Plan

- New tables are additive — no existing tables modified
- Migration file: `packages/server/src/db/migrations/0003_benchmarks.ts`
- Create tables `benchmarks`, `benchmark_variants`, `benchmark_results`
- No data migration needed — replay uses existing event/session tables

---

## 4. API Design

### 4.1 Session Replay Endpoints

#### `GET /api/sessions/:id/replay`

Retrieve replay state for a session. Computes cumulative context server-side.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | integer | 0 | Starting event index (0-based) |
| `limit` | integer | 1000 | Max events to return (1-5000) |
| `eventTypes` | string | all | Comma-separated event type filter |
| `includeContext` | boolean | true | Include cumulative context per step |

**Response (200):**

```json
{
  "session": { /* Session object */ },
  "chainValid": true,
  "totalSteps": 847,
  "steps": [
    {
      "index": 0,
      "event": { /* AgentLensEvent */ },
      "pairedEvent": null,
      "pairDurationMs": null,
      "context": {
        "eventIndex": 0,
        "totalEvents": 847,
        "cumulativeCostUsd": 0,
        "elapsedMs": 0,
        "eventCounts": { "session_started": 1 },
        "llmHistory": [],
        "toolResults": [],
        "pendingApprovals": [],
        "errorCount": 0,
        "warnings": []
      }
    }
    // ...more steps
  ],
  "pagination": {
    "offset": 0,
    "limit": 1000,
    "hasMore": false
  },
  "summary": {
    "totalCost": 0.0342,
    "totalDurationMs": 45200,
    "totalLlmCalls": 8,
    "totalToolCalls": 12,
    "totalErrors": 1,
    "models": ["claude-sonnet-4-20250514", "gpt-4o"],
    "tools": ["web_search", "file_read", "calculator"]
  }
}
```

**Error responses:**
- `404` — Session not found (within tenant)
- `400` — Invalid parameters
- `401` — Unauthenticated
- `403` — Session belongs to different tenant

**Implementation pattern** (follows existing route pattern):

```typescript
// packages/server/src/routes/replay.ts
export function replayRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get('/:id/replay', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const sessionId = c.req.param('id');
    // ... parameter validation ...
    const builder = new ReplayBuilder(tenantStore);
    const replayState = await builder.build(sessionId, { offset, limit, eventTypes, includeContext });
    return c.json(replayState);
  });

  return app;
}
```

### 4.2 Benchmark Endpoints

#### `POST /api/benchmarks`

Create a new benchmark.

**Request body:**

```json
{
  "name": "GPT-4o vs Claude Sonnet for RAG",
  "description": "Compare cost and quality between models for RAG pipeline",
  "agentId": "rag-agent",
  "variants": [
    {
      "name": "GPT-4o Baseline",
      "description": "Current production config",
      "tag": "config:gpt4o-baseline",
      "agentId": "rag-agent"
    },
    {
      "name": "Claude Sonnet Challenger",
      "description": "New config with claude-sonnet-4-20250514",
      "tag": "config:claude-sonnet",
      "agentId": "rag-agent"
    }
  ],
  "metrics": ["health_score", "avg_cost", "avg_latency", "error_rate", "completion_rate"],
  "minSessionsPerVariant": 50,
  "timeRange": {
    "from": "2026-02-01T00:00:00Z",
    "to": "2026-02-28T23:59:59Z"
  }
}
```

**Response (201):**

```json
{
  "id": "01HXYZ...",
  "status": "draft",
  "name": "GPT-4o vs Claude Sonnet for RAG",
  "variants": [
    { "id": "01HXYZ1...", "name": "GPT-4o Baseline", "tag": "config:gpt4o-baseline" },
    { "id": "01HXYZ2...", "name": "Claude Sonnet Challenger", "tag": "config:claude-sonnet" }
  ],
  "createdAt": "2026-02-08T17:00:00Z"
}
```

#### `GET /api/benchmarks`

List benchmarks.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | all | Filter by status (comma-separated) |
| `agentId` | string | — | Filter by agent |
| `limit` | integer | 20 | Page size (1-100) |
| `offset` | integer | 0 | Pagination offset |

**Response (200):**

```json
{
  "benchmarks": [ /* Benchmark objects with variant counts */ ],
  "total": 12,
  "hasMore": false
}
```

#### `GET /api/benchmarks/:id`

Get benchmark detail including variants and current session counts.

**Response (200):**

```json
{
  "id": "01HXYZ...",
  "name": "GPT-4o vs Claude Sonnet for RAG",
  "status": "running",
  "variants": [
    {
      "id": "01HXYZ1...",
      "name": "GPT-4o Baseline",
      "tag": "config:gpt4o-baseline",
      "sessionCount": 42
    },
    {
      "id": "01HXYZ2...",
      "name": "Claude Sonnet Challenger",
      "tag": "config:claude-sonnet",
      "sessionCount": 38
    }
  ],
  "metrics": ["health_score", "avg_cost", "avg_latency", "error_rate", "completion_rate"],
  "minSessionsPerVariant": 50,
  "createdAt": "2026-02-08T17:00:00Z",
  "updatedAt": "2026-02-08T17:00:00Z"
}
```

#### `PUT /api/benchmarks/:id/status`

Update benchmark status.

**Request body:**

```json
{
  "status": "running"  // or "completed" or "cancelled"
}
```

**Transitions:**
- `draft` → `running`: Start benchmark. Validates ≥1 session per variant.
- `running` → `completed`: Complete benchmark. Computes and caches results.
- `running` → `cancelled`: Cancel benchmark.
- `draft` → `cancelled`: Cancel draft.

**Response (200):**

```json
{
  "id": "01HXYZ...",
  "status": "running",
  "updatedAt": "2026-02-08T18:00:00Z"
}
```

#### `GET /api/benchmarks/:id/results`

Get comparison results. For completed benchmarks, returns cached results. For running benchmarks, computes on-the-fly.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeDistributions` | boolean | false | Include raw values array for distribution charts |

**Response (200):**

```json
{
  "benchmarkId": "01HXYZ...",
  "status": "completed",
  "variants": [
    {
      "variantId": "01HXYZ1...",
      "variantName": "GPT-4o Baseline",
      "sessionCount": 52,
      "metrics": {
        "avg_cost": { "mean": 0.045, "median": 0.038, "stddev": 0.012, "min": 0.01, "max": 0.12, "count": 52 },
        "error_rate": { "mean": 0.08, "median": 0.05, "stddev": 0.06, "min": 0, "max": 0.25, "count": 52 }
      }
    },
    {
      "variantId": "01HXYZ2...",
      "variantName": "Claude Sonnet Challenger",
      "sessionCount": 48,
      "metrics": {
        "avg_cost": { "mean": 0.032, "median": 0.028, "stddev": 0.009, "min": 0.008, "max": 0.09, "count": 48 },
        "error_rate": { "mean": 0.06, "median": 0.04, "stddev": 0.05, "min": 0, "max": 0.20, "count": 48 }
      }
    }
  ],
  "comparisons": [
    {
      "metric": "avg_cost",
      "variantA": { "id": "01HXYZ1...", "name": "GPT-4o Baseline", "stats": { "mean": 0.045 } },
      "variantB": { "id": "01HXYZ2...", "name": "Claude Sonnet Challenger", "stats": { "mean": 0.032 } },
      "absoluteDiff": -0.013,
      "percentDiff": -28.9,
      "testType": "welch_t",
      "testStatistic": 3.42,
      "pValue": 0.0008,
      "confidenceInterval": { "lower": -0.019, "upper": -0.007 },
      "effectSize": 1.12,
      "significant": true,
      "winner": "01HXYZ2...",
      "confidence": "★★★"
    }
  ],
  "summary": "Claude Sonnet Challenger outperforms GPT-4o Baseline on cost (-29%, p<0.001, ★★★) and error rate (-25%, p=0.04, ★★). No significant difference on latency or completion rate.",
  "computedAt": "2026-02-08T20:00:00Z"
}
```

#### `DELETE /api/benchmarks/:id`

Delete a draft or cancelled benchmark. Returns 409 if running or completed.

**Response:** `204 No Content`

### 4.3 Route Registration

Following the existing pattern in the server's index.ts:

```typescript
// New imports
import { replayRoutes } from './routes/replay.js';
import { benchmarkRoutes } from './routes/benchmarks.js';

// Registration (alongside existing routes)
app.route('/api/sessions', sessionsRoutes(store));           // existing
app.route('/api/sessions', replayRoutes(store));             // NEW — adds /:id/replay
app.route('/api/benchmarks', benchmarkRoutes(store, db));    // NEW
```

---

## 5. MCP Tools Design

### 5.1 `agentlens_replay` Tool

```typescript
// packages/mcp/src/tools/replay.ts

export function registerReplayTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_replay',
    `Replay a past agent session step-by-step, showing the full decision context at each point.

**When to use:** To understand what happened during a past session — what tools were called, what the LLM saw and responded, what errors occurred, and in what order. Useful for debugging failures, reviewing decision quality, or understanding agent behavior.

**What it returns:** An ordered list of replay steps, each containing the event details and the cumulative context at that point (LLM conversation history, tool results, cost, elapsed time, error count).

**Example:** agentlens_replay({ sessionId: "sess_abc123" }) → returns full replay with context at each step.
agentlens_replay({ sessionId: "sess_abc123", fromStep: 10, toStep: 20 }) → returns steps 10-20 only.`,
    {
      sessionId: z.string().describe('Session ID to replay'),
      fromStep: z.number().optional().describe('Starting step index (0-based, default: 0)'),
      toStep: z.number().optional().describe('Ending step index (inclusive, default: last step)'),
      eventTypes: z.string().optional().describe('Comma-separated event types to include (default: all)'),
      summaryOnly: z.boolean().optional().describe('If true, return only session summary without step details (faster for large sessions)'),
    },
    async ({ sessionId, fromStep, toStep, eventTypes, summaryOnly }) => {
      // Implementation calls transport.replay(sessionId, options)
      // Formats output as readable text with step numbers, timestamps, event summaries
    }
  );
}
```

**Output format for MCP** (human-readable text):

```
Session Replay: sess_abc123
Agent: rag-agent | Status: completed | Duration: 45.2s | Cost: $0.034
Events: 47 total (8 LLM calls, 12 tool calls, 1 error)
Chain: ✓ Valid

Step 0 [00:00.000] ▶️ session_started
  Agent: rag-agent v2.1 | Tags: config:claude-sonnet

Step 1 [00:00.012] 🤖 llm_call → claude-sonnet-4-20250514
  Messages: 1 system + 1 user (342 tokens)
  Tools available: web_search, file_read, calculator

Step 2 [00:01.845] 🤖 llm_response ← claude-sonnet-4-20250514
  Latency: 1833ms | Cost: $0.004 | Tokens: 342→156
  Response: "I'll search for the latest..."
  Tool calls requested: web_search("latest AI news 2026")

Step 3 [00:01.850] 🔧 tool_call → web_search
  Arguments: { "query": "latest AI news 2026" }

Step 4 [00:03.200] 🔧 tool_response ← web_search (1350ms)
  Result: [3 search results...]

...

⚠️ Step 23 [00:15.400] ❌ tool_error — calculator
  Error: "Division by zero"
  Context: 7 LLM calls, 10 tool calls completed, $0.028 spent
```

### 5.2 `agentlens_benchmark` Tool

```typescript
// packages/mcp/src/tools/benchmark.ts

export function registerBenchmarkTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_benchmark',
    `Create and manage A/B test benchmarks to compare agent configurations with statistical rigor.

**When to use:** To compare two or more agent configurations (different models, prompts, temperatures, etc.) and determine which performs better based on real session data. Use this to validate changes before committing to them.

**Workflow:**
1. Create: Define a benchmark with variants and the tags used to identify each variant's sessions
2. Run sessions: Ensure sessions are tagged (e.g., tag sessions with "config:variant-a")
3. Check results: Get statistical comparison once enough sessions are collected

**Actions:**
- create: Create a new benchmark
- list: List existing benchmarks
- status: Check benchmark status and session counts
- results: Get statistical comparison results
- start: Start a draft benchmark (begin collecting data)
- complete: Complete a running benchmark (freeze results)

**Example:** agentlens_benchmark({ action: "create", name: "GPT-4o vs Sonnet", variants: [{ name: "GPT-4o", tag: "config:gpt4o" }, { name: "Sonnet", tag: "config:sonnet" }] })`,
    {
      action: z.enum(['create', 'list', 'status', 'results', 'start', 'complete'])
        .describe('Benchmark action to perform'),
      // For create:
      name: z.string().optional().describe('Benchmark name (required for create)'),
      description: z.string().optional().describe('Benchmark description'),
      variants: z.array(z.object({
        name: z.string(),
        tag: z.string(),
        description: z.string().optional(),
      })).optional().describe('Variant definitions (required for create, 2-10 variants)'),
      metrics: z.array(z.string()).optional()
        .describe('Metrics to compare (default: all). Options: health_score, error_rate, avg_cost, avg_latency, tool_success_rate, completion_rate, avg_tokens, avg_duration'),
      minSessions: z.number().optional()
        .describe('Minimum sessions per variant (default: 30)'),
      agentId: z.string().optional().describe('Scope to a specific agent'),
      // For status/results/start/complete:
      benchmarkId: z.string().optional().describe('Benchmark ID (required for status/results/start/complete)'),
      // For list:
      status: z.string().optional().describe('Filter by status for list action'),
    },
    async (params) => {
      // Route to appropriate action
      // Format results as readable text with tables
    }
  );
}
```

**Output format for MCP** (results action):

```
Benchmark Results: GPT-4o vs Claude Sonnet for RAG
Status: completed | Created: 2026-02-08

Variant Summary:
  A) GPT-4o Baseline:       52 sessions
  B) Claude Sonnet Challenger: 48 sessions

Metric Comparison:
┌──────────────────┬──────────┬──────────┬──────────┬─────────┬────────────┐
│ Metric           │ GPT-4o   │ Sonnet   │ Diff     │ p-value │ Confidence │
├──────────────────┼──────────┼──────────┼──────────┼─────────┼────────────┤
│ Avg Cost         │ $0.045   │ $0.032   │ -28.9%   │ 0.0008  │ ★★★        │
│ Error Rate       │ 8.0%     │ 6.0%     │ -25.0%   │ 0.041   │ ★★         │
│ Avg Latency      │ 2.1s     │ 1.8s     │ -14.3%   │ 0.12    │ —          │
│ Health Score     │ 72       │ 78       │ +8.3%    │ 0.03    │ ★★         │
│ Completion Rate  │ 94%      │ 96%      │ +2.1%    │ 0.38    │ —          │
└──────────────────┴──────────┴──────────┴──────────┴─────────┴────────────┘

Winner: Claude Sonnet Challenger
  ✓ Significantly better on: Cost (★★★), Error Rate (★★), Health Score (★★)
  — No significant difference on: Latency, Completion Rate

Summary: Claude Sonnet Challenger outperforms GPT-4o Baseline on cost (-29%),
error rate (-25%), and health score (+8%). Recommend switching to Claude Sonnet.
```

### 5.3 Transport Extensions

Add new methods to `AgentLensTransport`:

```typescript
// In packages/mcp/src/transport.ts

/** Fetch replay state for a session */
async replay(sessionId: string, options?: {
  offset?: number;
  limit?: number;
  eventTypes?: string;
  includeContext?: boolean;
}): Promise<ReplayState> {
  const qs = new URLSearchParams();
  if (options?.offset) qs.set('offset', String(options.offset));
  if (options?.limit) qs.set('limit', String(options.limit));
  if (options?.eventTypes) qs.set('eventTypes', options.eventTypes);
  if (options?.includeContext !== undefined) qs.set('includeContext', String(options.includeContext));
  return this.get(`/api/sessions/${sessionId}/replay?${qs}`);
}

/** Create a benchmark */
async createBenchmark(data: CreateBenchmarkInput): Promise<Benchmark> {
  return this.post('/api/benchmarks', data);
}

/** List benchmarks */
async listBenchmarks(filters?: { status?: string; agentId?: string }): Promise<BenchmarkListResult> {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set('status', filters.status);
  if (filters?.agentId) qs.set('agentId', filters.agentId);
  return this.get(`/api/benchmarks?${qs}`);
}

/** Get benchmark detail */
async getBenchmark(id: string): Promise<BenchmarkDetail> {
  return this.get(`/api/benchmarks/${id}`);
}

/** Update benchmark status */
async updateBenchmarkStatus(id: string, status: string): Promise<Benchmark> {
  return this.put(`/api/benchmarks/${id}/status`, { status });
}

/** Get benchmark results */
async getBenchmarkResults(id: string): Promise<BenchmarkResults> {
  return this.get(`/api/benchmarks/${id}/results`);
}
```

---

## 6. Dashboard Components

### 6.1 Session Replay Page

**Route:** `/replay/:sessionId`

**Component tree:**

```
SessionReplayPage
├── ReplayHeader
│   ├── Back button (← Sessions)
│   ├── Session info (agent, status, duration, cost)
│   └── Share button (copy deep link)
├── ReplayControls
│   ├── PlayPauseButton
│   ├── StepBackButton
│   ├── StepForwardButton
│   ├── SpeedSelector (1x, 2x, 5x, 10x)
│   ├── StepCounter ("Step 23 of 847")
│   └── JumpToInput (search/dropdown)
├── TimelineScrubber
│   ├── ScrubberBar (full session width, markers per event)
│   ├── EventTypeMarkers (color-coded dots)
│   ├── PlayheadIndicator (current position)
│   └── ErrorMarkers (red markers for error events)
├── MainContent (resizable split pane)
│   ├── ReplayTimeline (left, 60%)
│   │   ├── ReplayEventCard (for current + surrounding events)
│   │   │   ├── EventTypeIcon
│   │   │   ├── EventTimestamp
│   │   │   ├── EventSummary
│   │   │   ├── EventPayloadDetail (expandable)
│   │   │   └── PairedEventIndicator (if paired)
│   │   └── (virtual scrolling via @tanstack/react-virtual)
│   └── ContextPanel (right, 40%)
│       ├── ContextTabs
│       │   ├── "Summary" tab (event counts, cost, elapsed, errors)
│       │   ├── "LLM History" tab (conversation thread)
│       │   ├── "Tool Results" tab (accumulated tool outputs)
│       │   └── "Approvals" tab (pending/resolved approvals)
│       └── ContextContent (per active tab)
└── ReplayFooter
    └── EventTypeFilter (toggles to show/hide event types)
```

**Key component details:**

- `ReplayControls`: Uses `useCallback` + `setInterval` for auto-play. Keyboard shortcuts via `useEffect` global keydown listener.
- `TimelineScrubber`: Renders as a horizontal bar with event markers. Uses canvas rendering for performance with 10,000+ events. Click handler converts x-position to step index.
- `ReplayEventCard`: Extends existing `EventDetailPanel` with replay-specific features (current step highlight, step number). Reuses `EVENT_STYLES` from existing Timeline component.
- `ContextPanel`: Updates on each step. LLM History tab shows chronological conversation, similar to a chat interface. Tool Results tab shows table of completed tool calls.

**State management:**

```typescript
interface ReplayPageState {
  // Data
  replayState: ReplayState | null;
  loading: boolean;
  error: string | null;

  // Playback
  currentStep: number;
  isPlaying: boolean;
  playbackSpeed: 1 | 2 | 5 | 10;

  // Filters
  activeEventTypes: Set<EventType>;

  // UI
  contextPanelTab: 'summary' | 'llm' | 'tools' | 'approvals';
  contextPanelWidth: number; // percentage
}
```

### 6.2 Benchmark Pages

#### Benchmark List Page

**Route:** `/benchmarks`

```
BenchmarkListPage
├── PageHeader ("Benchmarks" + "New Benchmark" button)
├── FilterBar
│   ├── StatusFilter (All, Draft, Running, Completed, Cancelled)
│   └── AgentFilter (dropdown)
└── BenchmarkTable
    ├── BenchmarkRow
    │   ├── Name
    │   ├── StatusBadge (color-coded)
    │   ├── VariantCount
    │   ├── SessionCounts (per variant)
    │   ├── CreatedAt
    │   └── Actions (View, Start, Cancel, Delete)
    └── Pagination
```

#### New Benchmark Page

**Route:** `/benchmarks/new`

```
NewBenchmarkPage
├── PageHeader ("Create Benchmark")
├── BenchmarkForm
│   ├── NameInput
│   ├── DescriptionInput
│   ├── AgentSelector (optional)
│   ├── VariantEditor
│   │   ├── VariantRow (name, tag, description) × N
│   │   └── AddVariantButton
│   ├── MetricSelector (checkboxes)
│   ├── MinSessionsInput
│   ├── TimeRangeSelector (optional date range)
│   └── CreateButton
└── HelpPanel
    └── "How benchmarking works" guide text
```

#### Benchmark Detail Page

**Route:** `/benchmarks/:id`

```
BenchmarkDetailPage
├── BenchmarkHeader
│   ├── Name + StatusBadge
│   ├── Description
│   ├── ActionButtons (Start/Complete/Cancel based on status)
│   └── Back button
├── VariantCards (horizontal row)
│   └── VariantCard ×N
│       ├── Variant name
│       ├── Tag badge
│       ├── Session count (with progress bar if running)
│       └── Min sessions indicator
├── ComparisonTable (when results available)
│   ├── MetricRow ×N
│   │   ├── Metric name
│   │   ├── Variant A value
│   │   ├── Variant B value
│   │   ├── Diff (percentage, colored green/red)
│   │   ├── p-value
│   │   └── Confidence stars
│   └── WinnerRow (summary)
├── DistributionCharts (expandable section)
│   └── BoxPlot per metric (using recharts or lightweight chart lib)
└── SummaryCard
    └── Plain-language summary text
```

**Styling:** Follow existing patterns:
- Tailwind utility classes
- `bg-white rounded-lg shadow-sm border` for cards
- `text-green-600` / `text-red-600` / `text-gray-500` for status colors
- Same heading sizes, spacing, and responsive breakpoints as existing pages

### 6.3 Navigation Updates

Add to existing `Layout.tsx` sidebar:

```typescript
// New nav items
{ path: '/replay', label: 'Replay', icon: '⏪' },        // Under Sessions group
{ path: '/benchmarks', label: 'Benchmarks', icon: '📊' }, // New section
```

The Replay page is also accessible from the Session Detail page via a "Replay" button.

### 6.4 API Client Extensions

Add to `packages/dashboard/src/api/client.ts`:

```typescript
// ─── Replay ─────────────────────────────────────────────

export interface ReplayOptions {
  offset?: number;
  limit?: number;
  eventTypes?: string[];
  includeContext?: boolean;
}

export async function getSessionReplay(
  sessionId: string,
  options?: ReplayOptions,
): Promise<ReplayState> {
  const qs = toQueryString({
    offset: options?.offset,
    limit: options?.limit,
    eventTypes: options?.eventTypes,
    includeContext: options?.includeContext,
  });
  return request<ReplayState>(`/api/sessions/${sessionId}/replay${qs}`);
}

// ─── Benchmarks ─────────────────────────────────────────

export async function createBenchmark(data: CreateBenchmarkInput): Promise<Benchmark> {
  return request<Benchmark>('/api/benchmarks', { method: 'POST', body: JSON.stringify(data) });
}

export async function getBenchmarks(filters?: BenchmarkFilters): Promise<BenchmarkListResult> {
  const qs = toQueryString({ ...filters });
  return request<BenchmarkListResult>(`/api/benchmarks${qs}`);
}

export async function getBenchmark(id: string): Promise<BenchmarkDetail> {
  return request<BenchmarkDetail>(`/api/benchmarks/${id}`);
}

export async function updateBenchmarkStatus(id: string, status: string): Promise<Benchmark> {
  return request<Benchmark>(`/api/benchmarks/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function getBenchmarkResults(
  id: string,
  options?: { includeDistributions?: boolean },
): Promise<BenchmarkResults> {
  const qs = toQueryString({ includeDistributions: options?.includeDistributions });
  return request<BenchmarkResults>(`/api/benchmarks/${id}/results${qs}`);
}

export async function deleteBenchmark(id: string): Promise<void> {
  await request(`/api/benchmarks/${id}`, { method: 'DELETE' });
}
```

---

## 7. Integration with Existing Systems

### 7.1 Event Store Integration

**Replay** queries the existing event store using `IEventStore.queryEvents()`:

```typescript
// Fetch all events for a session in ascending order
const { events } = await store.queryEvents({
  sessionId,
  order: 'asc',
  limit: 50000,  // cap at max session size
});
```

The `ReplayBuilder` then iterates through events, building cumulative context at each step. This is a **read-only** operation — no writes to the event store.

**Benchmarking** queries sessions using `IEventStore.querySessions()` with tag filters:

```typescript
// Fetch sessions matching a variant's tag
const { sessions } = await store.querySessions({
  tags: [variant.tag],
  agentId: variant.agentId,
  from: benchmark.timeRangeFrom,
  to: benchmark.timeRangeTo,
  limit: 10000,
});
```

### 7.2 Health Score Integration

Benchmarking uses the existing `HealthComputer` to compute per-session health scores:

```typescript
const computer = new HealthComputer(weights);

for (const session of variantSessions) {
  // Compute health score for the session's agent within the session's time range
  const health = await computer.compute(store, session.agentId, windowDays);
  if (health) {
    variantHealthScores.push(health.overallScore);
  }
}
```

For efficiency, the `MetricAggregator` can compute most metrics directly from session materialized data (already stored in the `sessions` table: `totalCostUsd`, `errorCount`, `toolCallCount`, `llmCallCount`, `totalInputTokens`, `totalOutputTokens`, event counts). Health scores require the `HealthComputer` which reads from events.

### 7.3 Cost Optimization Integration

Benchmark cost metrics leverage existing session-level cost data:

```typescript
// Session already has totalCostUsd materialized
const costValues = variantSessions.map(s => s.totalCostUsd);
const costStats = computeStats(costValues);
```

For deeper cost analysis (per-model breakdown), the `MetricAggregator` can query `cost_tracked` events.

### 7.4 Session Timeline Integration

The existing session detail page already has a "Timeline" view. Replay extends this with:
1. A "Replay" button on the session detail page that navigates to `/replay/:sessionId`
2. The replay page reuses `EventDetailPanel` for rendering individual event details
3. The replay timeline builds on the same `EVENT_STYLES` and pairing logic from the existing `Timeline` component

### 7.5 SSE / Real-time Integration

For v0.7.0, replay is **static** (completed sessions only). However, the architecture is designed for future live replay:

```typescript
// Future v0.8.0: subscribe to session events via SSE
const eventSource = new EventSource(`/api/stream?sessionId=${id}&token=${apiKey}`);
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  appendReplayStep(event);
};
```

---

## 8. Performance Considerations

### 8.1 Replay Performance

**Problem:** A session with 10,000 events could produce a ~50MB replay payload with full context at each step.

**Solutions:**

1. **Pagination:** Default page size of 1,000 events. Client requests pages as user navigates.

2. **Incremental context:** Instead of including full context at every step, include:
   - Full context at page boundaries (every 1,000th step)
   - Delta context for intermediate steps (only what changed)
   - Client reconstructs full context by applying deltas from last boundary

3. **Lazy payload loading:** Initial replay load includes event headers only. Full payloads (LLM messages, tool results) loaded on-demand when user expands a step.

4. **Payload truncation:** LLM messages truncated to first 500 chars in the replay list view, full content available on expand. Uses existing `truncatePayload()` from core.

5. **Server-side computation caching:** For the same session, replay state doesn't change. Cache the computed replay for 10 minutes (LRU cache, max 100 sessions).

**Benchmarks (performance targets):**

| Session Size | Load Time Target | Payload Size |
|-------------|-----------------|--------------|
| 100 events | < 200ms | < 500KB |
| 1,000 events | < 1s | < 2MB |
| 5,000 events | < 3s | < 5MB (paginated) |
| 10,000+ events | < 5s (first page) | < 5MB per page |

### 8.2 Benchmark Computation Performance

**Problem:** Computing statistics across thousands of sessions with multiple metrics.

**Solutions:**

1. **Session-level aggregation:** Most metrics are pre-computed in the `sessions` table (cost, duration, event counts, error counts, token counts). Only health scores require fresh computation.

2. **Efficient health score computation:** For benchmarking, compute a simplified health score per session (skip the 30-day baseline comparison, use absolute scoring).

3. **Result caching:** Completed benchmark results are stored in `benchmark_results` table. Only computed once.

4. **Running benchmark optimization:** For running benchmarks, cap computation at 10,000 sessions per variant. Use streaming aggregation (single pass, O(n) memory).

5. **Statistical computation:** Welch's t-test and chi-squared are O(n) operations. Even with 10,000 sessions, computation takes < 100ms.

**Performance targets:**

| Operation | Sessions | Target Time |
|-----------|----------|-------------|
| Metric aggregation (2 variants) | 100 | < 500ms |
| Metric aggregation (2 variants) | 1,000 | < 2s |
| Metric aggregation (2 variants) | 10,000 | < 5s |
| Statistical comparison (8 metrics, 2 variants) | any | < 200ms |
| Result caching (write) | any | < 100ms |
| Result retrieval (cached) | any | < 50ms |

### 8.3 Dashboard Performance

1. **Virtual scrolling:** Replay timeline uses `@tanstack/react-virtual` (existing pattern). Only ~30 DOM nodes rendered regardless of event count.

2. **Canvas-rendered scrubber:** The timeline scrubber uses HTML Canvas to draw event markers, avoiding 10,000+ DOM elements.

3. **Debounced controls:** Auto-play uses `requestAnimationFrame` with speed multiplier. Step changes debounced at 16ms.

4. **Lazy chart rendering:** Distribution charts in benchmark results rendered only when the user expands the "Distributions" section.

---

## 9. Statistical Engine Design

### 9.1 Module: `packages/server/src/lib/benchmark/`

```
benchmark/
├── index.ts              — BenchmarkEngine: orchestrates the workflow
├── metric-aggregator.ts  — MetricAggregator: computes per-variant stats
├── statistical.ts        — StatisticalComparator: t-tests, chi-squared
├── formatter.ts          — ResultFormatter: generates summaries
└── __tests__/
    ├── metric-aggregator.test.ts
    ├── statistical.test.ts
    └── formatter.test.ts
```

### 9.2 `MetricAggregator`

Computes `MetricStats` for each metric across a variant's sessions.

```typescript
class MetricAggregator {
  /**
   * Extract metric values from sessions.
   * Maps BenchmarkMetric → session field.
   */
  private extractMetric(sessions: Session[], metric: BenchmarkMetric): number[] {
    switch (metric) {
      case 'avg_cost':       return sessions.map(s => s.totalCostUsd);
      case 'avg_duration':   return sessions.filter(s => s.endedAt)
                                .map(s => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());
      case 'error_rate':     return sessions.map(s => s.eventCount > 0 ? s.errorCount / s.eventCount : 0);
      case 'completion_rate':return sessions.map(s => s.status === 'completed' ? 1 : 0);
      case 'tool_success_rate': return sessions.map(s => s.toolCallCount > 0
                                   ? (s.toolCallCount - s.errorCount) / s.toolCallCount : 1);
      case 'avg_latency':    // Requires event-level query (llm_response.latencyMs avg)
      case 'avg_tokens':     return sessions.map(s => s.totalInputTokens + s.totalOutputTokens);
      case 'health_score':   // Requires HealthComputer
      default:               return [];
    }
  }

  /**
   * Compute descriptive statistics for an array of values.
   */
  computeStats(values: number[]): MetricStats {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
    const stddev = Math.sqrt(variance);

    return { mean, median, stddev, min: sorted[0], max: sorted[n - 1], count: n };
  }
}
```

### 9.3 `StatisticalComparator`

Implements Welch's t-test and chi-squared test.

```typescript
class StatisticalComparator {
  /**
   * Welch's t-test for continuous metrics.
   * Does NOT assume equal variances.
   */
  welchTTest(a: MetricStats, b: MetricStats): {
    tStatistic: number;
    degreesOfFreedom: number;
    pValue: number;
    confidenceInterval: { lower: number; upper: number };
    effectSize: number; // Cohen's d
  } {
    const meanDiff = b.mean - a.mean;
    const seA = (a.stddev ** 2) / a.count;
    const seB = (b.stddev ** 2) / b.count;
    const se = Math.sqrt(seA + seB);
    const t = meanDiff / se;

    // Welch-Satterthwaite degrees of freedom
    const df = (seA + seB) ** 2 / (
      (seA ** 2) / (a.count - 1) + (seB ** 2) / (b.count - 1)
    );

    // p-value from t-distribution (two-tailed)
    const pValue = tDistributionPValue(t, df);

    // 95% confidence interval
    const tCritical = tDistributionCritical(0.025, df);
    const ci = {
      lower: meanDiff - tCritical * se,
      upper: meanDiff + tCritical * se,
    };

    // Cohen's d effect size
    const pooledStd = Math.sqrt(
      ((a.count - 1) * a.stddev ** 2 + (b.count - 1) * b.stddev ** 2) /
      (a.count + b.count - 2)
    );
    const effectSize = pooledStd > 0 ? Math.abs(meanDiff) / pooledStd : 0;

    return { tStatistic: t, degreesOfFreedom: df, pValue, confidenceInterval: ci, effectSize };
  }

  /**
   * Chi-squared test for proportion metrics.
   * Used for: error_rate, completion_rate, tool_success_rate
   */
  chiSquaredTest(
    aSuccesses: number, aTotal: number,
    bSuccesses: number, bTotal: number,
  ): {
    chiSquared: number;
    pValue: number;
    effectSize: number; // phi coefficient
  } {
    // 2×2 contingency table
    // Implementation uses standard chi-squared formula
    // with Yates' continuity correction for small samples
  }

  /**
   * Determine metric direction: for some metrics, lower is better.
   */
  private metricDirection(metric: BenchmarkMetric): 'lower_is_better' | 'higher_is_better' {
    switch (metric) {
      case 'avg_cost':
      case 'avg_latency':
      case 'error_rate':
      case 'avg_duration':
        return 'lower_is_better';
      case 'health_score':
      case 'completion_rate':
      case 'tool_success_rate':
      case 'avg_tokens': // neutral, but treat as information
        return 'higher_is_better';
      default:
        return 'higher_is_better';
    }
  }
}
```

### 9.4 t-Distribution Implementation

Since we're in a Node.js/TypeScript environment without scipy, we need a t-distribution implementation. Options:

1. **`jstat` npm package** — lightweight statistics library with t-distribution CDF
2. **Approximation** — use the regularized incomplete beta function
3. **Lookup table** — pre-computed critical values for common df ranges

**Recommendation:** Use `jstat` (6KB gzipped, well-tested) for t-distribution CDF and chi-squared CDF. Import only the needed functions.

```typescript
import { ttest } from 'jstat'; // or implement Welch's directly with jstat.studentt.cdf
```

### 9.5 `ResultFormatter`

Generates human-readable summaries:

```typescript
class ResultFormatter {
  formatSummary(comparisons: MetricComparison[], variants: VariantMetrics[]): string {
    const significant = comparisons.filter(c => c.significant);
    const notSignificant = comparisons.filter(c => !c.significant);

    if (significant.length === 0) {
      return `No statistically significant differences found between variants. Consider collecting more data (current: ${variants.map(v => `${v.variantName}: ${v.sessionCount} sessions`).join(', ')}).`;
    }

    // Group wins by variant
    const winsByVariant = new Map<string, MetricComparison[]>();
    for (const comp of significant) {
      if (!comp.winner) continue;
      const wins = winsByVariant.get(comp.winner) ?? [];
      wins.push(comp);
      winsByVariant.set(comp.winner, wins);
    }

    // ... build summary text ...
  }
}
```

---

## 10. File Structure Summary

### New files by package:

```
packages/core/src/
  types.ts                          # ADD: BenchmarkMetric, BenchmarkStatus types
                                    #      ReplayStep, ReplayContext, ReplayState types

packages/server/src/
  routes/
    replay.ts                       # NEW: Session replay endpoint
    benchmarks.ts                   # NEW: Benchmark CRUD + results endpoints
  lib/
    replay/
      builder.ts                    # NEW: ReplayBuilder — computes replay state
      __tests__/
        builder.test.ts
    benchmark/
      index.ts                      # NEW: BenchmarkEngine orchestrator
      metric-aggregator.ts          # NEW: Per-variant metric computation
      statistical.ts                # NEW: Welch's t-test, chi-squared
      formatter.ts                  # NEW: Human-readable result summaries
      __tests__/
        metric-aggregator.test.ts
        statistical.test.ts
        formatter.test.ts
  db/
    schema.sqlite.ts               # MODIFY: Add benchmarks, benchmark_variants, benchmark_results
    benchmark-store.ts             # NEW: CRUD for benchmark tables
    migrations/
      0003_benchmarks.ts           # NEW: Create benchmark tables

packages/mcp/src/
  tools/
    replay.ts                      # NEW: agentlens_replay MCP tool
    benchmark.ts                   # NEW: agentlens_benchmark MCP tool
  transport.ts                     # MODIFY: Add replay(), benchmark API methods

packages/dashboard/src/
  pages/
    SessionReplay.tsx              # NEW: Replay page
    Benchmarks.tsx                 # NEW: Benchmark list page
    BenchmarkNew.tsx               # NEW: Create benchmark page
    BenchmarkDetail.tsx            # NEW: Benchmark detail + results page
  components/
    ReplayControls.tsx             # NEW: Play/pause/step/speed controls
    ReplayTimeline.tsx             # NEW: Replay event list with virtual scroll
    ReplayScrubber.tsx             # NEW: Timeline scrubber bar (canvas)
    ContextPanel.tsx               # NEW: Cumulative context display
    ComparisonTable.tsx            # NEW: Metric comparison table
    VariantCard.tsx                # NEW: Variant summary card
    DistributionChart.tsx          # NEW: Box plot / histogram
  api/
    client.ts                      # MODIFY: Add replay + benchmark API functions
  App.tsx                          # MODIFY: Add new routes
  components/
    Layout.tsx                     # MODIFY: Add nav items
```

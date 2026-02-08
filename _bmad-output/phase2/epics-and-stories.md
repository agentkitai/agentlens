# AgentLens v0.7.0 — Epics & Stories

## Session Replay Debugger & Agent Benchmarking / A/B Testing

**Date:** 2026-02-08
**Version:** 1.0

---

## Overview

6 epics, 24 stories. Organized by feature layer (bottom-up: types → server → MCP → dashboard).

### Epic Map

| # | Epic | Feature | Stories | Est. Tests |
|---|------|---------|---------|------------|
| E1 | Core Types & Data Models | Both | 3 | 18 |
| E2 | Replay Server Engine | Replay | 4 | 32 |
| E3 | Benchmark Server Engine | Benchmarking | 5 | 40 |
| E4 | MCP Tools | Both | 3 | 18 |
| E5 | Replay Dashboard | Replay | 5 | 25 |
| E6 | Benchmark Dashboard | Benchmarking | 4 | 20 |
| **Total** | | | **24** | **~153** |

### Dependency Graph

```
E1 (Types & Models)
├──→ E2 (Replay Server)
│    ├──→ E4.1 (Replay MCP tool)
│    └──→ E5 (Replay Dashboard)
├──→ E3 (Benchmark Server)
│    ├──→ E4.2-4.3 (Benchmark MCP tool)
│    └──→ E6 (Benchmark Dashboard)
```

---

## Epic 1: Core Types & Data Models

> Add TypeScript types for replay state and benchmark entities. Add benchmark DB schema + migration. Foundation for all other epics.

---

### Story 1.1 — Replay Types in Core Package

**As a** developer building the replay feature,
**I want** typed interfaces for `ReplayStep`, `ReplayContext`, and `ReplayState` in `@agentlensai/core`,
**So that** server, MCP, and dashboard code share a single type definition.

**Acceptance Criteria:**

- [ ] `ReplayStep` interface defined with: `index`, `event` (AgentLensEvent), `pairedEvent?`, `pairDurationMs?`, `context` (ReplayContext)
- [ ] `ReplayContext` interface defined with: `eventIndex`, `totalEvents`, `cumulativeCostUsd`, `elapsedMs`, `eventCounts`, `llmHistory[]`, `toolResults[]`, `pendingApprovals[]`, `errorCount`, `warnings[]`
- [ ] `ReplayState` interface defined with: `session`, `chainValid`, `totalSteps`, `steps[]`, `pagination`, `summary`
- [ ] `ReplaySummary` interface defined with: `totalCost`, `totalDurationMs`, `totalLlmCalls`, `totalToolCalls`, `totalErrors`, `models[]`, `tools[]`
- [ ] All interfaces exported from core package barrel
- [ ] Package builds without errors

**Dependencies:** None
**Est. Tests:** 4 (type compilation tests, export verification)

---

### Story 1.2 — Benchmark Types in Core Package

**As a** developer building the benchmarking feature,
**I want** typed interfaces for benchmarks, variants, metrics, comparisons, and results in `@agentlensai/core`,
**So that** all packages share consistent benchmark types.

**Acceptance Criteria:**

- [ ] `BenchmarkStatus` type: `'draft' | 'running' | 'completed' | 'cancelled'`
- [ ] `BenchmarkMetric` type: `'health_score' | 'error_rate' | 'avg_cost' | 'avg_latency' | 'tool_success_rate' | 'completion_rate' | 'avg_tokens' | 'avg_duration'`
- [ ] `Benchmark` interface with: id, tenantId, name, description?, status, agentId?, metrics[], minSessionsPerVariant, timeRange?, createdAt, updatedAt, completedAt?
- [ ] `BenchmarkVariant` interface with: id, benchmarkId, tenantId, name, description?, tag, agentId?, sortOrder
- [ ] `MetricStats` interface with: mean, median, stddev, min, max, count, values?[]
- [ ] `MetricComparison` interface with: metric, variantA, variantB, absoluteDiff, percentDiff, testType, testStatistic, pValue, confidenceInterval, effectSize, significant, winner?, confidence
- [ ] `VariantMetrics` interface with: variantId, variantName, sessionCount, metrics record
- [ ] `BenchmarkResults` interface with: benchmarkId, tenantId, variants[], comparisons[], summary, computedAt
- [ ] `BENCHMARK_METRICS` const array for iteration/validation
- [ ] All interfaces exported from core package barrel
- [ ] Package builds without errors

**Dependencies:** None
**Est. Tests:** 4 (type compilation, const array content, export verification)

---

### Story 1.3 — Benchmark Database Schema & Migration

**As a** developer,
**I want** Drizzle ORM table definitions and a migration for benchmarks, benchmark_variants, and benchmark_results,
**So that** benchmark data can be persisted in SQLite with proper indexes and tenant isolation.

**Acceptance Criteria:**

- [ ] `benchmarks` table in `schema.sqlite.ts` with columns: id (PK), tenant_id, name, description, status (enum), agent_id, metrics (JSON), min_sessions_per_variant, time_range_from, time_range_to, created_at, updated_at, completed_at
- [ ] `benchmark_variants` table with columns: id (PK), benchmark_id (FK → benchmarks.id, cascade delete), tenant_id, name, description, tag, agent_id, sort_order
- [ ] `benchmark_results` table with columns: id (PK), benchmark_id (FK → benchmarks.id, cascade delete), tenant_id, variant_metrics (JSON), comparisons (JSON), summary, computed_at
- [ ] Indexes: tenant_id on all tables; (tenant_id, status) on benchmarks; (benchmark_id) on variants and results; (tenant_id, tag) on variants
- [ ] Migration file `0003_benchmarks.ts` creates all three tables
- [ ] Migration runs cleanly on fresh and existing databases
- [ ] Existing tables unaffected (no modifications)

**Dependencies:** Story 1.2 (types referenced in schema comments)
**Est. Tests:** 10 (migration up, migration idempotent, table creation verification ×3, index verification ×3, cascade delete test, schema compilation)

---

## Epic 2: Replay Server Engine

> Server-side logic to build replay state from existing events. REST endpoint for replay data retrieval.

---

### Story 2.1 — ReplayBuilder: Core Replay Logic

**As a** developer,
**I want** a `ReplayBuilder` class that takes a session ID, queries events from the event store, and constructs a `ReplayState` with cumulative context at each step,
**So that** the replay API and MCP tool can serve structured replay data.

**Acceptance Criteria:**

- [ ] `ReplayBuilder` class in `packages/server/src/lib/replay/builder.ts`
- [ ] Constructor takes `IEventStore` (tenant-scoped)
- [ ] `build(sessionId, options)` method queries events in ascending order and constructs `ReplayState`
- [ ] Each `ReplayStep` contains the event and cumulative `ReplayContext`
- [ ] Event pairing logic: `tool_call` ↔ `tool_response`/`tool_error` (by `callId`), `llm_call` ↔ `llm_response` (by `callId`), `approval_requested` ↔ `approval_granted`/`denied`/`expired` (by `requestId`), `form_submitted` ↔ `form_completed`/`form_expired` (by `submissionId`)
- [ ] Cumulative context tracks: running cost from `cost_tracked` and `llm_response` events, elapsed time from session_started timestamp, event counts by type, LLM conversation history from `llm_call`/`llm_response` payloads, tool results from `tool_response`/`tool_error` payloads, pending approvals
- [ ] Summary computed: total cost, duration, LLM calls, tool calls, errors, unique models, unique tools
- [ ] Chain validity verified using existing `verifyChain()` function
- [ ] Supports `offset` and `limit` for pagination
- [ ] Supports `eventTypes` filter (only include specified types)
- [ ] Supports `includeContext: false` to skip context computation (faster for summary-only requests)
- [ ] Returns 404-equivalent (null) for non-existent session

**Dependencies:** Story 1.1
**Est. Tests:** 14 (basic replay build, event pairing for each type ×4, cumulative cost tracking, elapsed time, LLM history accumulation, tool results accumulation, pagination, event type filtering, include-context=false, empty session, chain validity pass/fail)

---

### Story 2.2 — Replay REST Endpoint

**As a** dashboard or API consumer,
**I want** a `GET /api/sessions/:id/replay` endpoint that returns the replay state for a session,
**So that** I can build replay UIs or programmatically inspect session flow.

**Acceptance Criteria:**

- [ ] Endpoint registered at `GET /api/sessions/:id/replay` in Hono router
- [ ] Authenticated via existing auth middleware (bearer token)
- [ ] Tenant isolation via `getTenantStore()`
- [ ] Query parameters: `offset` (int, default 0), `limit` (int, default 1000, max 5000), `eventTypes` (comma-separated), `includeContext` (boolean, default true)
- [ ] Validates `offset` ≥ 0, `limit` 1-5000, `eventTypes` against `EVENT_TYPES` constant
- [ ] Returns 200 with `ReplayState` JSON on success
- [ ] Returns 404 when session not found (within tenant)
- [ ] Returns 400 for invalid parameters with descriptive error
- [ ] Returns 401/403 for auth failures
- [ ] Response includes `pagination` object with `offset`, `limit`, `hasMore`

**Dependencies:** Story 2.1
**Est. Tests:** 8 (success response, 404, 400 invalid params, pagination, event type filter, auth required, tenant isolation, large session pagination)

---

### Story 2.3 — Replay Performance: Pagination & Caching

**As a** user replaying a large session (10,000+ events),
**I want** the replay endpoint to respond within 5 seconds for the first page,
**So that** replay is usable even for very long sessions.

**Acceptance Criteria:**

- [ ] Server-side LRU cache for computed replay states: max 100 sessions, 10-minute TTL
- [ ] Cache keyed by `(tenantId, sessionId)` — invalidated when new events arrive for the session (via event bus listener)
- [ ] For sessions > 5,000 events: pagination enforced, context computed incrementally
- [ ] Summary always included (computed from full event list, even when paginating steps)
- [ ] Performance test: 1,000-event session < 1s, 10,000-event session first page < 5s
- [ ] Memory guard: cap context accumulation (LLM history stores last 50 entries by default, older entries summarized)

**Dependencies:** Story 2.1, Story 2.2
**Est. Tests:** 6 (cache hit, cache miss, cache invalidation, pagination correctness, memory cap, performance benchmark)

---

### Story 2.4 — Replay: Redaction Support

**As a** privacy-conscious user,
**I want** the replay to respect the `redacted` flag on LLM call/response events,
**So that** sensitive prompt/completion content is not exposed in replay views.

**Acceptance Criteria:**

- [ ] When `LlmCallPayload.redacted === true`: messages content replaced with `"[REDACTED]"` in replay step and context
- [ ] When `LlmResponsePayload.redacted === true`: completion content replaced with `"[REDACTED]"` in replay step and context
- [ ] Redacted events still shown in timeline with metadata (model, tokens, cost, latency) — only content hidden
- [ ] Context panel LLM history marks redacted entries visually

**Dependencies:** Story 2.1
**Est. Tests:** 4 (redacted llm_call, redacted llm_response, non-redacted passes through, mixed session)

---

## Epic 3: Benchmark Server Engine

> Server-side benchmark CRUD, metric aggregation, statistical comparison, and result caching.

---

### Story 3.1 — BenchmarkStore: CRUD Operations

**As a** developer,
**I want** a `BenchmarkStore` class for creating, reading, updating, and deleting benchmarks and their variants,
**So that** the API and MCP tool have a clean data access layer.

**Acceptance Criteria:**

- [ ] `BenchmarkStore` class in `packages/server/src/db/benchmark-store.ts`
- [ ] Constructor takes `SqliteDb` (Drizzle instance)
- [ ] `create(tenantId, input)` — creates benchmark + variants in a transaction, returns `Benchmark` with variants. Generates ULIDs.
- [ ] `getById(tenantId, id)` — returns benchmark with variants or null
- [ ] `list(tenantId, filters)` — returns paginated list with filters: status, agentId, limit, offset
- [ ] `updateStatus(tenantId, id, newStatus)` — validates transition (draft→running, running→completed/cancelled, draft→cancelled), updates `updatedAt` and `completedAt` (if completing)
- [ ] `delete(tenantId, id)` — deletes draft/cancelled benchmarks, returns false for running/completed
- [ ] `saveResults(tenantId, benchmarkId, results)` — upserts benchmark results
- [ ] `getResults(tenantId, benchmarkId)` — returns cached results or null
- [ ] All operations scoped by `tenantId` (never cross-tenant)

**Dependencies:** Story 1.3
**Est. Tests:** 12 (create happy path, create validates 2-10 variants, getById found/not found, list with filters, list pagination, status transitions valid/invalid ×3, delete draft/running, saveResults, getResults, tenant isolation)

---

### Story 3.2 — MetricAggregator: Per-Variant Statistics

**As a** developer,
**I want** a `MetricAggregator` that computes descriptive statistics (mean, median, stddev, min, max) for each benchmark metric across a variant's sessions,
**So that** the statistical comparator has clean inputs.

**Acceptance Criteria:**

- [ ] `MetricAggregator` class in `packages/server/src/lib/benchmark/metric-aggregator.ts`
- [ ] `aggregate(store, variant, metrics, timeRange?)` — queries sessions matching variant's tag, extracts metric values, computes stats
- [ ] Session matching: queries sessions with matching tag in `tags[]` array, scoped to variant's agentId (if set) and benchmark's time range
- [ ] Metric extraction from `Session` fields: `avg_cost` → `totalCostUsd`, `error_rate` → `errorCount / eventCount`, `completion_rate` → `status === 'completed' ? 1 : 0`, `tool_success_rate` → `(toolCallCount - errorCount) / toolCallCount`, `avg_tokens` → `totalInputTokens + totalOutputTokens`, `avg_duration` → `endedAt - startedAt`
- [ ] `avg_latency` requires event-level query: average `llm_response.latencyMs` for the variant's sessions
- [ ] `health_score` computed via `HealthComputer` for each session's agent in the session's time window (simplified: per-session, not per-agent)
- [ ] `computeStats(values[])` helper: returns `MetricStats` with mean, median, stddev, min, max, count
- [ ] Handles edge cases: empty sessions (skip), zero denominators (default to 0 or 1), single-session variance (stddev = 0)

**Dependencies:** Story 1.2, Story 3.1 (for variant definition)
**Est. Tests:** 10 (computeStats correctness, each metric extraction ×8, empty sessions, single session)

---

### Story 3.3 — StatisticalComparator: Hypothesis Testing

**As a** developer,
**I want** a `StatisticalComparator` that performs Welch's t-test and chi-squared tests to compare two variants,
**So that** benchmark results include statistically rigorous conclusions.

**Acceptance Criteria:**

- [ ] `StatisticalComparator` class in `packages/server/src/lib/benchmark/statistical.ts`
- [ ] `welchTTest(statsA, statsB)` — computes t-statistic, Welch-Satterthwaite degrees of freedom, two-tailed p-value, 95% CI for difference of means, Cohen's d effect size
- [ ] `chiSquaredTest(successesA, totalA, successesB, totalB)` — computes chi-squared statistic with Yates' correction, p-value, phi coefficient
- [ ] `compare(variantA, variantB, metric)` — selects appropriate test (t-test for continuous metrics, chi-squared for proportion metrics) and returns `MetricComparison`
- [ ] Metric classification: continuous = avg_cost, avg_latency, avg_tokens, avg_duration, health_score; proportion = error_rate, completion_rate, tool_success_rate
- [ ] Winner determination respects metric direction: lower-is-better for cost/latency/error_rate/duration; higher-is-better for health_score/completion_rate/tool_success_rate
- [ ] Confidence stars: `★★★` (p < 0.01), `★★` (p < 0.05), `★` (p < 0.1), `—` (p ≥ 0.1)
- [ ] `significant` flag: true when p < 0.05
- [ ] p-value computation uses `jstat` library (or equivalent) for t-distribution and chi-squared distribution CDFs
- [ ] Handles edge cases: zero variance (return p=1, not significant), n < 2 (return warning, skip test)

**Dependencies:** Story 1.2
**Est. Tests:** 10 (welch t-test known dataset, chi-squared known dataset, p-value correctness against reference, CI correctness, Cohen's d, phi coefficient, metric direction ×2, zero variance, small sample warning)

---

### Story 3.4 — BenchmarkEngine: Orchestrator + Result Formatter

**As a** developer,
**I want** a `BenchmarkEngine` that orchestrates metric aggregation and statistical comparison for a benchmark, formats results, and caches them,
**So that** the API endpoint can serve benchmark results efficiently.

**Acceptance Criteria:**

- [ ] `BenchmarkEngine` class in `packages/server/src/lib/benchmark/index.ts`
- [ ] `computeResults(benchmark, variants, store)` — calls MetricAggregator for each variant, then StatisticalComparator for each pair, returns `BenchmarkResults`
- [ ] For >2 variants: computes all pairwise comparisons (n*(n-1)/2 pairs)
- [ ] `formatSummary(comparisons, variants)` — generates human-readable summary text (plain language, e.g., "Variant B outperforms A on cost (-29%, ★★★) and error rate (-25%, ★★). No significant difference on latency.")
- [ ] Warnings included in summary: "Insufficient data" when any variant has < 30 sessions, "No significant differences found" when no p < 0.05
- [ ] For completed benchmarks: results cached via `BenchmarkStore.saveResults()`, subsequent calls return cached
- [ ] For running benchmarks: results computed on-the-fly (not cached)
- [ ] Session count per variant included in results (for dashboard progress bars)

**Dependencies:** Story 3.1, Story 3.2, Story 3.3
**Est. Tests:** 6 (end-to-end 2-variant, end-to-end 3-variant, summary formatting, insufficient data warning, cached results, running benchmark on-the-fly)

---

### Story 3.5 — Benchmark REST Endpoints

**As a** dashboard or API consumer,
**I want** REST endpoints for full benchmark CRUD and results retrieval,
**So that** I can manage benchmarks and view comparison results.

**Acceptance Criteria:**

- [ ] `POST /api/benchmarks` — creates benchmark. Validates: name required, 2-10 variants, valid metrics, minSessions ≥ 1. Returns 201 + created benchmark.
- [ ] `GET /api/benchmarks` — lists benchmarks. Query params: status, agentId, limit (1-100, default 20), offset. Returns paginated list with variant counts.
- [ ] `GET /api/benchmarks/:id` — returns benchmark detail with variants and current session counts per variant. 404 if not found.
- [ ] `PUT /api/benchmarks/:id/status` — transitions status. Body: `{ status: "running" | "completed" | "cancelled" }`. Validates transitions. Returns 409 for invalid transitions. When transitioning to "running": validates ≥1 session per variant. When transitioning to "completed": triggers result computation and caching.
- [ ] `GET /api/benchmarks/:id/results` — returns results. Query param: `includeDistributions` (boolean). For completed: returns cached. For running: computes on-the-fly. For draft: returns 400.
- [ ] `DELETE /api/benchmarks/:id` — deletes draft/cancelled. Returns 204. Returns 409 for running/completed.
- [ ] All endpoints authenticated and tenant-isolated
- [ ] Error responses follow existing pattern: `{ error: string, status: number }`
- [ ] Route registered via `benchmarkRoutes(store, db)` in server index

**Dependencies:** Story 3.1, Story 3.4
**Est. Tests:** 14 (create valid, create invalid variants count, list with filters, list pagination, get by ID found/404, status transition valid ×3, status transition invalid, results completed/running/draft, delete draft/running, auth required, tenant isolation)

---

## Epic 4: MCP Tools

> Register `agentlens_replay` and `agentlens_benchmark` as MCP tools for agent self-service.

---

### Story 4.1 — `agentlens_replay` MCP Tool

**As an** AI agent using AgentLens via MCP,
**I want** an `agentlens_replay` tool that returns a structured, human-readable replay of a past session,
**So that** I can review what happened in a previous session to understand failures or decision patterns.

**Acceptance Criteria:**

- [ ] Tool registered as `agentlens_replay` on the MCP server
- [ ] Parameters: `sessionId` (required), `fromStep` (optional int), `toStep` (optional int), `eventTypes` (optional comma-separated string), `summaryOnly` (optional boolean)
- [ ] Tool description clearly explains when to use it, what it returns, and includes an example invocation
- [ ] Output formatted as human-readable text (not raw JSON):
  - Header: session ID, agent, status, duration, cost, event counts
  - Steps: numbered, timestamped, with event type icons and summaries
  - Paired events shown together with duration
  - Errors highlighted with ⚠️ prefix
  - Context annotations: cost-so-far, error count at key points
- [ ] `summaryOnly=true` returns only the summary header (no steps) — fast for large sessions
- [ ] `fromStep`/`toStep` translated to offset/limit for the replay API
- [ ] Error handling: returns MCP error content for invalid session ID, auth failure, etc.
- [ ] Transport method `replay()` added to `AgentLensTransport`

**Dependencies:** Story 2.2 (replay API endpoint)
**Est. Tests:** 6 (basic replay, summary only, step range, event type filter, invalid session, error handling)

---

### Story 4.2 — `agentlens_benchmark` MCP Tool: Create & List

**As an** AI agent,
**I want** to create benchmarks and list existing ones via the `agentlens_benchmark` MCP tool,
**So that** I can set up A/B tests for my own configurations.

**Acceptance Criteria:**

- [ ] Tool registered as `agentlens_benchmark` on the MCP server
- [ ] Action `create`: accepts name, description?, variants[] (name + tag + description?), metrics[]?, minSessions?, agentId?. Returns created benchmark details.
- [ ] Action `list`: accepts status? filter, returns formatted list of benchmarks with status, variants, session counts
- [ ] Tool description explains the full benchmarking workflow: create → tag sessions → start → collect data → check results
- [ ] Validation: minimum 2 variants for create, valid metric names
- [ ] Transport methods `createBenchmark()`, `listBenchmarks()` added to `AgentLensTransport`
- [ ] Output formatted as readable text (not JSON)

**Dependencies:** Story 3.5 (benchmark API endpoints)
**Est. Tests:** 6 (create success, create validation, list all, list filtered, error handling, output formatting)

---

### Story 4.3 — `agentlens_benchmark` MCP Tool: Status, Results & Lifecycle

**As an** AI agent,
**I want** to check benchmark status, get statistical results, and manage benchmark lifecycle via MCP,
**So that** I can self-service my entire benchmarking workflow.

**Acceptance Criteria:**

- [ ] Action `status`: accepts benchmarkId, returns benchmark details with per-variant session counts and progress toward minimum
- [ ] Action `results`: accepts benchmarkId, returns formatted comparison table with metrics, differences, p-values, confidence stars, and plain-language summary
- [ ] Action `start`: accepts benchmarkId, transitions benchmark to running, returns confirmation
- [ ] Action `complete`: accepts benchmarkId, transitions to completed, returns confirmation with results
- [ ] Results output formatted as an ASCII table (metric × variant) with clear winner indication
- [ ] Transport methods `getBenchmark()`, `getBenchmarkResults()`, `updateBenchmarkStatus()` added to `AgentLensTransport`

**Dependencies:** Story 3.5 (benchmark API), Story 4.2 (tool registration)
**Est. Tests:** 6 (status check, results display, start action, complete action, results formatting, error on invalid benchmark)

---

## Epic 5: Replay Dashboard

> React pages and components for the session replay debugger.

---

### Story 5.1 — SessionReplay Page: Layout & Data Loading

**As a** developer using the dashboard,
**I want** a `/replay/:sessionId` page that loads replay data and displays the session header,
**So that** I can see the session overview before stepping through events.

**Acceptance Criteria:**

- [ ] New page `SessionReplay.tsx` at route `/replay/:sessionId`
- [ ] Route registered in `App.tsx` router
- [ ] Uses `useApi` hook to fetch `GET /api/sessions/:id/replay`
- [ ] Loading state with spinner
- [ ] Error state with message (404: "Session not found", network errors)
- [ ] Header displays: agent name, session status badge (reuse existing styling), duration, total cost, event/error/LLM/tool counts
- [ ] Back button navigates to session detail (`/sessions/:id`)
- [ ] URL query param `?step=N` sets initial step index
- [ ] API client function `getSessionReplay()` added to `client.ts`

**Dependencies:** Story 2.2
**Est. Tests:** 5 (renders with data, loading state, error state, URL step param, back navigation)

---

### Story 5.2 — ReplayControls & Keyboard Navigation

**As a** developer debugging a session,
**I want** play/pause, step forward/backward, and speed controls,
**So that** I can navigate through the session at my own pace.

**Acceptance Criteria:**

- [ ] `ReplayControls.tsx` component with: play/pause button, step back (←), step forward (→), speed selector (1x, 2x, 5x, 10x), step counter ("Step 23 of 847")
- [ ] Play mode: auto-advances steps at selected speed using `setInterval`
- [ ] Play pauses at end of session
- [ ] Step forward/backward respects event type filters (skips hidden events)
- [ ] Keyboard shortcuts: Space = play/pause, ArrowRight = step forward, ArrowLeft = step back, Home = first step, End = last step
- [ ] Keyboard shortcuts registered via `useEffect` global keydown, cleaned up on unmount
- [ ] Controls disabled during loading state
- [ ] Current step updates the URL query param `?step=N` (pushState, not navigation)

**Dependencies:** Story 5.1
**Est. Tests:** 6 (step forward, step backward, play/pause, speed change, keyboard shortcuts, URL update)

---

### Story 5.3 — TimelineScrubber: Visual Navigation Bar

**As a** developer,
**I want** a horizontal timeline scrubber bar showing all events with colored markers,
**So that** I can see the session shape at a glance and click to jump to any point.

**Acceptance Criteria:**

- [ ] `ReplayScrubber.tsx` component rendered as a horizontal bar (full page width)
- [ ] Each event represented as a colored dot/tick on the bar, positioned proportionally by timestamp
- [ ] Color coding per event type (reuse `EVENT_STYLES` from existing Timeline component)
- [ ] Error events rendered as taller red markers for visibility
- [ ] Current step indicated by a playhead marker (vertical line or highlighted dot)
- [ ] Click on the bar → jumps to the nearest event at that position
- [ ] Uses HTML Canvas rendering for performance (handles 10,000+ events without DOM overhead)
- [ ] Responsive: resizes with window
- [ ] Hover shows tooltip with event type and timestamp

**Dependencies:** Story 5.1
**Est. Tests:** 4 (renders events, click-to-jump, playhead position, responsive resize)

---

### Story 5.4 — ReplayTimeline: Step-by-Step Event View

**As a** developer,
**I want** a vertical event list showing the current step and surrounding events with full payload details,
**So that** I can see exactly what happened at each point in the session.

**Acceptance Criteria:**

- [ ] `ReplayTimeline.tsx` component: vertical list of `ReplayEventCard` components
- [ ] Current step highlighted with a distinct background color and border
- [ ] Virtual scrolling via `@tanstack/react-virtual` (only ~30 DOM nodes regardless of event count)
- [ ] Auto-scrolls to keep current step visible (centered when possible)
- [ ] Each `ReplayEventCard` shows: step number, timestamp (relative to session start), event type icon + label, event summary (tool name, LLM model, error message, etc.), expandable payload detail (full arguments, messages, results)
- [ ] Paired events: response shown inline below the call with duration badge
- [ ] Event type filter toggles in a toolbar: checkboxes for LLM, Tools, Errors, Approvals, Forms, Lifecycle, Cost. Filtered events hidden from list and step navigation.
- [ ] Click on any event card → sets it as current step
- [ ] Reuses `EventDetailPanel` rendering logic where applicable

**Dependencies:** Story 5.1, Story 5.2
**Est. Tests:** 6 (renders events, current step highlight, virtual scrolling, auto-scroll, event type filter, click to select)

---

### Story 5.5 — ContextPanel: Cumulative State Display

**As a** developer debugging a session,
**I want** a side panel showing the cumulative context at the current step (LLM history, tool results, running cost),
**So that** I can understand what the agent "knew" at each decision point.

**Acceptance Criteria:**

- [ ] `ContextPanel.tsx` component: resizable right panel (default 40% width, drag to resize)
- [ ] Tabbed interface with 4 tabs: **Summary**, **LLM History**, **Tool Results**, **Approvals**
- [ ] **Summary tab**: event counts by type, cumulative cost, elapsed time, error count, warnings list
- [ ] **LLM History tab**: chronological list of LLM interactions up to current step. Each entry: model, token counts, cost, latency. Expandable to show full messages with role-based coloring (system=gray, user=blue, assistant=green, tool=purple). Redacted entries show `[REDACTED]` with visual indicator.
- [ ] **Tool Results tab**: table of tool calls completed up to current step. Columns: tool name, arguments summary, result/error, duration. Expandable for full detail.
- [ ] **Approvals tab**: list of approval requests with status (pending/granted/denied/expired) at current step
- [ ] Panel collapses to a thin bar with expand button
- [ ] Panel updates immediately when step changes (no loading delay — data is already in ReplayState)

**Dependencies:** Story 5.1, Story 5.4
**Est. Tests:** 4 (summary tab, LLM history tab, tool results tab, resize/collapse)

---

## Epic 6: Benchmark Dashboard

> React pages for benchmark management, creation, and results visualization.

---

### Story 6.1 — Benchmark List Page

**As a** user,
**I want** a `/benchmarks` page showing all my benchmarks with status, variants, and actions,
**So that** I can manage my A/B tests.

**Acceptance Criteria:**

- [ ] New page `Benchmarks.tsx` at route `/benchmarks`
- [ ] Route registered in `App.tsx`, nav item added to `Layout.tsx` sidebar
- [ ] Fetches benchmark list via `getBenchmarks()` API client function
- [ ] Table columns: Name, Status (badge: green=completed, blue=running, gray=draft, red=cancelled), Variants (count), Sessions (total across variants), Created, Actions
- [ ] Status filter tabs: All, Draft, Running, Completed, Cancelled
- [ ] "New Benchmark" button → navigates to `/benchmarks/new`
- [ ] Row click → navigates to `/benchmarks/:id`
- [ ] Actions dropdown per row: View, Start (if draft), Cancel (if running), Delete (if draft/cancelled)
- [ ] Loading and empty states
- [ ] Pagination controls

**Dependencies:** Story 3.5
**Est. Tests:** 5 (renders list, status filter, actions, empty state, pagination)

---

### Story 6.2 — Create Benchmark Page

**As a** user,
**I want** a `/benchmarks/new` form to define a new benchmark with variants and metrics,
**So that** I can set up an A/B test.

**Acceptance Criteria:**

- [ ] New page `BenchmarkNew.tsx` at route `/benchmarks/new`
- [ ] Form fields: Name (required), Description, Agent (optional dropdown from agents list), Minimum sessions per variant (number, default 30)
- [ ] Variant editor: starts with 2 variant rows, "Add Variant" button (max 10). Each row: Name, Tag (with `config:` prefix hint), Description. Remove button (min 2 variants).
- [ ] Metric selector: checkboxes for all 8 metrics, all checked by default
- [ ] Time range selector: optional start/end date pickers
- [ ] Validation: name required, at least 2 variants, each variant has name and tag, at least 1 metric selected
- [ ] Submit calls `createBenchmark()`, on success navigates to `/benchmarks/:id`
- [ ] Help panel: explains tagging workflow ("Tag your sessions with the variant's tag using session metadata or MCP tool")
- [ ] Error display for API validation failures

**Dependencies:** Story 3.5, Story 6.1
**Est. Tests:** 5 (form renders, validation, add/remove variants, submit success, submit error)

---

### Story 6.3 — Benchmark Detail & Results Page

**As a** user,
**I want** a `/benchmarks/:id` page showing benchmark details, variant progress, and statistical comparison results,
**So that** I can track my A/B test and see which config wins.

**Acceptance Criteria:**

- [ ] New page `BenchmarkDetail.tsx` at route `/benchmarks/:id`
- [ ] Header: benchmark name, status badge, description, action buttons (Start/Complete/Cancel based on status)
- [ ] Variant cards (horizontal): each shows name, tag (as badge), session count, progress bar toward minimum sessions
- [ ] **Comparison table** (`ComparisonTable.tsx`): rows = metrics, columns = variants + diff + p-value + confidence. Metric values color-coded: green for winner, red for loser, gray for not significant. Confidence shown as stars (★★★/★★/★/—).
- [ ] **Summary card**: plain-language text summarizing results ("Variant B outperforms A on cost and health score. No significant difference on latency.")
- [ ] Warning banner when any variant has < 30 sessions: "Results may be unreliable — insufficient sample size"
- [ ] Auto-refresh every 30s for running benchmarks (to show updated session counts)
- [ ] Confirmation dialog for Start/Complete/Cancel actions
- [ ] 404 page for invalid benchmark ID

**Dependencies:** Story 3.5, Story 6.1
**Est. Tests:** 6 (renders detail, variant cards, comparison table, summary card, status actions, insufficient data warning)

---

### Story 6.4 — Distribution Charts for Benchmark Metrics

**As a** user viewing benchmark results,
**I want** box plot or histogram charts showing the distribution of each metric per variant,
**So that** I can visually compare variants beyond just mean values.

**Acceptance Criteria:**

- [ ] `DistributionChart.tsx` component: renders a box plot or histogram for a single metric across variants
- [ ] Expandable section on `BenchmarkDetail` page: "Show Distributions" toggle
- [ ] When expanded, requests results with `includeDistributions=true` (raw values arrays)
- [ ] One chart per metric, side-by-side variant distributions
- [ ] Box plot shows: median (line), Q1-Q3 (box), whiskers (1.5×IQR), outliers (dots)
- [ ] Variant colors consistent with comparison table
- [ ] Uses lightweight charting: recharts (already available) or custom SVG
- [ ] Lazy-loaded: chart data fetched only when section expanded
- [ ] Handles edge cases: single data point, identical values

**Dependencies:** Story 6.3
**Est. Tests:** 4 (renders box plots, multiple metrics, edge cases, lazy loading)

---

## Story Dependency Map (Full)

```
Story 1.1 (Replay Types)
  └──→ Story 2.1 (ReplayBuilder)
       ├──→ Story 2.2 (Replay REST)
       │    ├──→ Story 2.3 (Performance/Cache)
       │    ├──→ Story 4.1 (Replay MCP)
       │    └──→ Story 5.1 (Replay Page)
       │         ├──→ Story 5.2 (Controls)
       │         ├──→ Story 5.3 (Scrubber)
       │         ├──→ Story 5.4 (Timeline)
       │         │    └──→ Story 5.5 (Context Panel)
       │         └──→ Story 5.5 (Context Panel)
       └──→ Story 2.4 (Redaction)

Story 1.2 (Benchmark Types)
  ├──→ Story 1.3 (DB Schema)
  │    └──→ Story 3.1 (BenchmarkStore)
  │         ├──→ Story 3.2 (MetricAggregator)
  │         │    └──→ Story 3.4 (Engine)
  │         │         └──→ Story 3.5 (REST Endpoints)
  │         │              ├──→ Story 4.2 (Benchmark MCP: Create/List)
  │         │              │    └──→ Story 4.3 (Benchmark MCP: Status/Results)
  │         │              ├──→ Story 6.1 (Benchmark List Page)
  │         │              │    ├──→ Story 6.2 (Create Page)
  │         │              │    └──→ Story 6.3 (Detail/Results Page)
  │         │              │         └──→ Story 6.4 (Distribution Charts)
  │         │              └──→ Story 6.3 (Detail/Results Page)
  │         └──→ Story 3.4 (Engine)
  └──→ Story 3.3 (StatisticalComparator)
       └──→ Story 3.4 (Engine)
```

---

## Test Count Summary

| Story | Description | Est. Tests |
|-------|-------------|-----------|
| 1.1 | Replay Types | 4 |
| 1.2 | Benchmark Types | 4 |
| 1.3 | DB Schema & Migration | 10 |
| 2.1 | ReplayBuilder | 14 |
| 2.2 | Replay REST Endpoint | 8 |
| 2.3 | Replay Performance | 6 |
| 2.4 | Replay Redaction | 4 |
| 3.1 | BenchmarkStore CRUD | 12 |
| 3.2 | MetricAggregator | 10 |
| 3.3 | StatisticalComparator | 10 |
| 3.4 | BenchmarkEngine | 6 |
| 3.5 | Benchmark REST Endpoints | 14 |
| 4.1 | Replay MCP Tool | 6 |
| 4.2 | Benchmark MCP: Create/List | 6 |
| 4.3 | Benchmark MCP: Status/Results | 6 |
| 5.1 | Replay Page Layout | 5 |
| 5.2 | Replay Controls | 6 |
| 5.3 | Timeline Scrubber | 4 |
| 5.4 | Replay Timeline | 6 |
| 5.5 | Context Panel | 4 |
| 6.1 | Benchmark List Page | 5 |
| 6.2 | Create Benchmark Page | 5 |
| 6.3 | Benchmark Detail Page | 6 |
| 6.4 | Distribution Charts | 4 |
| **TOTAL** | | **~153** |

# v0.7.0 Code Review — Session Replay Debugger + Agent Benchmarking/A/B Testing

**Reviewer:** Senior TypeScript Code Reviewer (AI-assisted)  
**Date:** 2026-02-08  
**Scope:** 6 epics, 24 stories — ~15,700 lines added across 53 files  
**Test Suite:** 2235 tests — all passing (169 new tests added)

---

## Overall Assessment

**Verdict: APPROVE with findings — no blockers, 2 HIGH issues to address before production use with large datasets.**

The v0.7.0 changeset is well-structured, thoroughly tested, and follows the project's architectural conventions. Tenant isolation is consistently enforced across all new DB operations. The statistical implementations (Welch's t-test, chi-squared with Yates' correction) are mathematically correct and use solid numerical methods (Abramowitz-Stegun erf, Lentz continued fraction for regularized beta). The ReplayBuilder is correctly read-only with no mutation side effects.

The code is production-ready for typical usage patterns. Two HIGH-severity issues affect correctness at scale (>500 sessions per variant) and for one specific metric (`tool_success_rate`).

---

## Findings by Severity

### 🔴 CRITICAL — None Found

Tenant isolation is enforced on every DB query in `BenchmarkStore` (all WHERE clauses include `tenant_id = ${tenantId}`). SQL is parameterized via Drizzle's `sql` template tags — no injection vectors. The `ReplayBuilder` reads through `IEventStore` which is tenant-scoped via `getTenantStore()`. MCP tools go through transport HTTP calls with auth headers — no direct DB access. No data leaks identified.

---

### 🟠 HIGH

#### H1: MetricAggregator silently truncated at 500 sessions

**File:** `packages/server/src/lib/benchmark/metric-aggregator.ts`, line 36  
**Description:** `aggregate()` calls `store.querySessions({ limit: 10000 })`, but the underlying `SqliteEventStore.querySessions()` enforces `Math.min(query.limit ?? 50, 500)`. The requested limit of 10,000 is silently capped to 500. For benchmarks with >500 sessions per variant, metric aggregation will compute statistics on only the first 500 sessions (ordered by `started_at DESC`), producing incorrect results with no warning.

**Impact:** Incorrect statistical conclusions for high-volume benchmarks. Users would not know their results are based on a subset.

**Suggested Fix:**
```typescript
// Option A: Paginate through all sessions in metric-aggregator.ts
let allSessions: Session[] = [];
let offset = 0;
const pageSize = 500;
while (true) {
  const { sessions } = await store.querySessions({
    tenantId: variant.tenantId,
    agentId: variant.agentId,
    tags: [variant.tag],
    from: timeRange?.from,
    to: timeRange?.to,
    limit: pageSize,
    offset,
  });
  allSessions.push(...sessions);
  if (sessions.length < pageSize) break;
  offset += pageSize;
}

// Option B: Add a querySessions variant without limit cap for internal use
```

#### H2: `tool_success_rate` uses session-level `errorCount` instead of tool-specific errors

**File:** `packages/server/src/lib/benchmark/metric-aggregator.ts`, line 96  
**Description:** The formula `(toolCallCount - errorCount) / toolCallCount` uses `session.errorCount` which counts ALL errors (LLM errors, system errors, etc.), not just tool errors. A session with 10 tool calls, 0 tool errors, but 5 LLM errors would report a tool success rate of 50% instead of 100%.

**Impact:** Inflated failure rates for `tool_success_rate` metric. Statistical comparisons on this metric may produce false conclusions.

**Suggested Fix:**
```typescript
case 'tool_success_rate':
  // Need tool-specific error count. Session doesn't track this separately.
  // Option A: Use a conservative proxy — min(errorCount, toolCallCount)
  if (session.toolCallCount === 0) return null;
  const toolErrors = Math.min(session.errorCount, session.toolCallCount);
  return Math.max(0, (session.toolCallCount - toolErrors) / session.toolCallCount);
  
  // Option B (better): Add toolErrorCount to Session type and track it during ingestion
```

---

### 🟡 MEDIUM

#### M1: Benchmark GET /:id always returns 0 session counts for variants

**File:** `packages/server/src/routes/benchmarks.ts`, lines 194–207  
**Description:** The variant enrichment calls `querySessions({ limit: 0 })` and uses `sessions.length` to get the count. Since `limit: 0` → `Math.min(0, 500) = 0`, no sessions are returned, so `sessions.length` is always 0. The code should use the `total` property returned by `querySessions` instead.

**Suggested Fix:**
```typescript
const { total } = await tenantStore.querySessions({
  tenantId: v.tenantId,
  agentId: v.agentId,
  tags: [v.tag],
  from: benchmark.timeRange?.from,
  to: benchmark.timeRange?.to,
  limit: 1, // Minimal fetch — we only need the count
});
return { ...v, sessionCount: total };
```

#### M2: Replay cache stores capped state, but comment says uncapped

**File:** `packages/server/src/routes/replay.ts`, lines 155–161  
**Description:** The code calls `capLlmHistory(state)` which mutates `state.steps[].context.llmHistory` in-place, then caches the now-capped state. The comment says "Cache the full (uncapped) state" but the state has already been mutated. Subsequent cache hits will return the capped state.

**Suggested Fix:** Either cache before capping (clone the state), or update the comment. Since capping is a memory guard, caching the capped version is arguably correct — but the misleading comment should be fixed:
```typescript
// Cache the state (note: LLM history has been capped for memory efficiency)
putCache(tenantId, sessionId, state);
```

#### M3: `health_score` metric always returns null in MetricAggregator

**File:** `packages/server/src/lib/benchmark/metric-aggregator.ts`, line 114  
**Description:** The `health_score` case always returns `null`, with a comment saying it needs the HealthComputer. This means benchmarks configured with `health_score` as a metric will produce empty stats (count: 0, mean: 0) and comparisons will not be meaningful. No warning is given to the user.

**Suggested Fix:** Either integrate with HealthComputer or throw a descriptive error when `health_score` is requested:
```typescript
case 'health_score':
  // Not yet supported at session level — require pre-computed health snapshots
  console.warn('health_score metric requires pre-computed snapshots; returning null');
  return null;
```
Better: validate at benchmark creation time and reject `health_score` until supported.

#### M4: In-memory replay cache has no tenant isolation in eviction

**File:** `packages/server/src/routes/replay.ts`, lines 40–60  
**Description:** The global LRU cache is shared across all tenants. A high-traffic tenant could evict all cache entries for other tenants. Cache keys do include `tenantId:sessionId` so there's no data leak, but fairness isn't guaranteed. For a single-tenant deployment this is fine; for multi-tenant it could be a performance concern.

**Impact:** Low for current deployment, but worth noting for future multi-tenant scaling.

#### M5: `benchmarks` table uses single-column PK, not composite (id, tenant_id)

**File:** `packages/server/src/db/migrate.ts`, line 423  
**Description:** The `benchmarks` table uses `id TEXT PRIMARY KEY` (single column), while other data tables (sessions, agents, lessons) use composite `PRIMARY KEY (id, tenant_id)`. The `benchmark_variants` and `benchmark_results` tables also use single-column PKs. Since IDs are UUIDs this isn't a correctness issue, but it breaks the pattern established for tenant isolation and could cause confusion in future migrations.

**Suggested Fix:** Use `PRIMARY KEY (id, tenant_id)` for consistency with the rest of the schema. This would require updating FK references and the `ON DELETE CASCADE` declarations.

#### M6: No pagination/limit in `BenchmarkEngine` for pairwise comparisons

**File:** `packages/server/src/lib/benchmark/engine.ts`, lines 71–85  
**Description:** Pairwise comparisons are O(V² × M) where V is variant count and M is metric count. With 10 variants and 8 metrics, that's 360 comparisons. This is acceptable for the current 2–10 variant limit, but the lack of any safeguard means future limit increases could cause performance issues.

**Impact:** Low given the 10-variant cap, but worth a defensive check.

---

### 🟢 LOW

#### L1: Unused `_allEvents` parameter in `updateContext`

**File:** `packages/server/src/lib/replay/builder.ts`, line 306  
**Description:** The `_allEvents` parameter is passed to `updateContext()` but never used (prefixed with `_` indicating intentional). Likely reserved for future use (e.g., lookahead for warnings). Clean but could be removed.

#### L2: `confidenceStars` thresholds differ between StatisticalComparator and MCP benchmark tool

**File:** `packages/server/src/lib/benchmark/statistical.ts`, line 331 vs `packages/mcp/src/tools/benchmark.ts`, line 101  
**Description:**
- `StatisticalComparator`: ★★★ at p<0.01, ★★ at p<0.05, ★ at p<0.1
- MCP tool formatter: ★★★ at p<0.001, ★★ at p<0.01, ★ at p<0.05

These are inconsistent. The MCP tool applies stricter thresholds. Since the REST API returns the server-computed stars, the MCP formatter's stars are only used for display and may not match.

**Suggested Fix:** Remove the MCP-side `confidenceStars` function and use the `confidence` field from the API response directly.

#### L3: `BenchmarkStore.delete` doesn't explicitly delete variants and results

**File:** `packages/server/src/db/benchmark-store.ts`, line 324  
**Description:** The DELETE only targets the `benchmarks` table, relying on `ON DELETE CASCADE` for variants and results. This is correct since `foreign_keys = ON` is enforced. However, it's implicit — an explicit multi-table delete in a transaction would be more defensive.

#### L4: Inconsistent error response format

**File:** `packages/server/src/routes/benchmarks.ts`, various  
**Description:** Error responses include a `status` field in the JSON body (`{ error: "...", status: 400 }`), which duplicates the HTTP status code. This is consistent with other AgentLens routes but could confuse API consumers. Consider documenting this convention.

#### L5: `avg_latency` metric approximation is coarse

**File:** `packages/server/src/lib/benchmark/metric-aggregator.ts`, line 105  
**Description:** `avg_latency` is computed as `totalDuration / llmCallCount`, which is total session time divided by LLM call count — a very rough proxy. Non-LLM time (tool execution, user wait) inflates this. The comment acknowledges this.

**Impact:** Comparative benchmarks are still valid (same bias applied to both variants), but absolute values are misleading.

#### L6: `metricSummaries` computed but unused in `formatSummary`

**File:** `packages/server/src/lib/benchmark/engine.ts`, line 128  
**Description:** The `metricSummaries` variable in the first loop is computed but the code uses a second `metricTexts` variable in the inner loop (grouped by loser). The first `metricSummaries` is dead code.

**Suggested Fix:** Remove the unused first mapping to reduce cognitive overhead.

---

## Architecture Compliance Checklist

| Constraint | Status | Notes |
|---|---|---|
| All DB access tenant-scoped | ✅ PASS | Every BenchmarkStore method takes tenantId; all SQL includes tenant_id filter |
| ReplayBuilder read-only | ✅ PASS | No mutations — pure computation from IEventStore reads |
| Statistical tests mathematically correct | ✅ PASS | Welch's t-test, chi-squared with Yates', erf/beta implementations verified |
| Winner direction correct | ✅ PASS | LOWER_IS_BETTER set for cost/latency/error_rate/duration; others higher-is-better |
| Status transitions enforced | ✅ PASS | VALID_TRANSITIONS map; tested in store and route layers |
| MCP tools use transport (no direct DB) | ✅ PASS | All tool handlers call `transport.*` methods which make HTTP requests |
| 2235 tests passing | ✅ PASS | Full suite confirmed — 0 failures |

---

## Test Coverage Assessment

| Component | Test File | Tests | Coverage |
|---|---|---|---|
| Core types | `benchmark-types.test.ts`, `replay-types.test.ts` | 27 | Type validation, BENCHMARK_METRICS const |
| ReplayBuilder | `builder.test.ts` | 23 | Pagination, pairing, context, redaction, chain validation |
| BenchmarkStore | `benchmark-store.test.ts`, `benchmark-schema.test.ts` | 38 | CRUD, status transitions, tenant isolation, FK cascades |
| Statistical | `statistical.test.ts` | 20 | t-test, chi-squared, edge cases, known values |
| MetricAggregator | `metric-aggregator.test.ts` | 11 | All metrics, empty data, stats computation |
| BenchmarkEngine | `engine.test.ts` | 14 | End-to-end, caching, summary generation |
| REST routes | `replay.test.ts`, `benchmarks.test.ts` | 32 | Validation, auth, status codes, edge cases |
| MCP tools | `replay.test.ts`, `benchmark.test.ts` | 33 | Formatting, error handling, tool registration |

**Test gap:** No test verifies behavior when `querySessions` silently truncates (H1). No test for `health_score` metric returning null (M3). No integration test for >500 sessions per variant.

---

## Summary of Required Actions

| ID | Severity | Action | Effort |
|---|---|---|---|
| H1 | HIGH | Fix MetricAggregator pagination (500-session cap) | 1h |
| H2 | HIGH | Fix tool_success_rate to use tool-specific error count | 1-2h |
| M1 | MEDIUM | Fix variant session count (use `total` not `sessions.length`) | 15m |
| M2 | MEDIUM | Fix misleading cache comment | 5m |
| M3 | MEDIUM | Warn or reject `health_score` metric until supported | 30m |

# Code Review — v0.6.0 Batch 4 (Epics 1+2: Health Scores + Cost Optimization)

**Reviewer:** AI Code Reviewer (Senior TypeScript)
**Date:** 2026-02-08
**Diff:** `git diff 00d4c21..af79328` (32 files, ~5,427 lines)

---

## Summary Statistics

| Metric | Value |
|---|---|
| Files changed | 32 |
| Lines added | ~5,418 |
| Lines removed | ~9 |
| New production files | 12 |
| New test files | 10 |
| Modified existing files | 10 |
| Test coverage (new) | All new modules have dedicated test files |
| Estimated test count added | ~110+ new test cases |

### Files by Category

**Epic 1 — Health Score System:**
- `packages/core/src/types.ts` — HealthDimension, HealthScore, HealthWeights, HealthSnapshot types
- `packages/core/src/schemas.ts` — Zod schemas for all health types
- `packages/core/src/constants.ts` — DEFAULT_HEALTH_WEIGHTS, DEFAULT_MODEL_COSTS
- `packages/server/src/lib/health/computer.ts` — HealthComputer (5-dimension scoring engine)
- `packages/server/src/db/health-snapshot-store.ts` — HealthSnapshotStore (CRUD, tenant-scoped)
- `packages/server/src/db/migrate.ts` + `migrate.js` — health_snapshots table DDL
- `packages/server/src/routes/health.ts` — REST endpoints (5 routes)
- `packages/mcp/src/tools/health.ts` — agentlens_health MCP tool
- `packages/mcp/src/transport.ts` — getHealth(), getFirstActiveAgent()

**Epic 2 — Cost Optimization Engine:**
- `packages/core/src/types.ts` — CostRecommendation, OptimizationResult, ModelCosts types
- `packages/core/src/schemas.ts` — Zod schemas for optimization types
- `packages/server/src/lib/optimization/classifier.ts` — ComplexityClassifier (simple/moderate/complex)
- `packages/server/src/lib/optimization/engine.ts` — OptimizationEngine (recommendation generator)
- `packages/server/src/lib/optimization/index.ts` — Barrel exports
- `packages/server/src/routes/optimize.ts` — REST endpoint (GET /api/optimize/recommendations)
- `packages/mcp/src/tools/optimize.ts` — agentlens_optimize MCP tool
- `packages/mcp/src/transport.ts` — getOptimizationRecommendations()

---

## Findings

### 🔴 CRITICAL (0)

No critical security issues found. Tenant isolation is properly enforced:
- Health routes use `getTenantStore()` correctly (health.ts:57, optimize.ts:20)
- HealthSnapshotStore scopes all operations by `tenantId` parameter
- Auth middleware applied to all new endpoints via wildcards (`/api/agents/*`, `/api/config/*`) and explicit registrations (`/api/optimize/*`, `/api/health/overview`, `/api/health/history`)
- No direct DB access from MCP tools — all go through transport → REST → tenant-scoped store

---

### 🟠 HIGH (3)

#### H1: HealthComputer ignores `tool_error` events — undercounts tool failures
**File:** `packages/server/src/lib/health/computer.ts`, lines 72-73, 180-200
**Description:** The `computeToolSuccess()` method only queries `['tool_call', 'tool_response']` events and counts failures by checking `isError === true` on `tool_response` payloads. However, the codebase has a separate `tool_error` event type (used in `error-patterns.ts`, `tool-sequences.ts`, `summarizer.ts`) that represents tool failures as a distinct event. When a tool call fails catastrophically (throws), the system emits a `tool_error` event rather than a `tool_response` with `isError: true`. These are completely missed.

**Impact:** Tool success scores may be inflated for agents that experience tool crashes — a tool_call without a matching tool_response (because a tool_error was emitted instead) is silently ignored, making the denominator (total calls) higher than it should be relative to counted failures.

**Suggested fix:**
```typescript
// In compute():
const { events: toolEvents } = await store.queryEvents({
  agentId,
  from: windowFrom,
  to: windowTo,
  eventType: ['tool_call', 'tool_response', 'tool_error'],  // Add tool_error
  limit: 10000,
});

// In computeToolSuccess():
const toolErrors = toolEvents.filter((e) => e.eventType === 'tool_error');
const failedCalls = toolResponses.filter((e) => {
  const payload = e.payload as Record<string, unknown>;
  return payload.isError === true;
}).length + toolErrors.length;
```

---

#### H2: OptimizationEngine counts unmatched calls as implicit failures
**File:** `packages/server/src/lib/optimization/engine.ts`, lines 128-134
**Description:** When a `llm_call` event has no matching `llm_response` (e.g., call in progress, timeout, crash, or out-of-window response), `callCount` increments but `successCount` does not. This silently treats orphaned/in-progress calls as failures, potentially skewing success rates downward and causing the engine to reject valid model recommendations.

**Impact:** During high traffic or at window boundaries, a small number of unmatched calls could push a model's success rate below 95%, blocking legitimate cost-saving recommendations.

**Suggested fix:**
```typescript
// Option A: Only count calls that have a response (skip unmatched):
if (!responseEvent) continue; // or group separately

// Option B (preferred): Track matched vs unmatched explicitly:
if (responseEvent) {
  group.matchedCallCount++;
  const isError = responsePayload?.finishReason === 'error';
  if (!isError) group.successCount++;
}
// Use matchedCallCount for success rate calculation
```

---

#### H3: Committed build artifact `migrate.js` in source directory
**File:** `packages/server/src/db/migrate.js` (393 lines)
**Description:** A compiled JavaScript file is committed to `packages/server/src/db/` despite `.gitignore` containing `packages/*/src/**/*.js`. This was force-added (`git add -f`). The file is a transpiled copy of `migrate.ts` and will drift out of sync with the TypeScript source on future edits, causing subtle bugs where the JS and TS versions differ.

**Impact:** If the project's build or test tooling loads the `.js` file instead of compiling the `.ts` file (which happens in some configurations), stale migration code could run, potentially missing new columns/tables.

**Suggested fix:**
```bash
git rm --cached packages/server/src/db/migrate.js
# The .gitignore already excludes it; removing from tracking is sufficient
```

---

### 🟡 MEDIUM (7)

#### M1: Test descriptions say "10 tools" but assertions check for 11
**Files:** 
- `packages/mcp/src/__tests__/learn.test.ts:71` — `'registers 10 tools total'` → `toHaveLength(11)`
- `packages/mcp/src/__tests__/llm-call.test.ts:80` — `'now registers 10 tools total'` → `toHaveLength(11)`
- `packages/mcp/src/__tests__/recall.test.ts:64` — `'registers 10 tools total'` → `toHaveLength(11)`
- `packages/mcp/src/__tests__/optimize.test.ts:69` — `'registers 10 tools total (9 existing + optimize)'` → `toHaveLength(11)`
- `packages/mcp/src/__tests__/health.test.ts:88` — `'total tool count is 10'` → `toHaveLength(11)`

**Description:** The test descriptions claim 9 or 10 tools, but the assertions correctly expect 11. The description strings were not updated to match reality. The actual tool count is 11 (5 in `tools.ts` + 6 in `tools/*.ts`).

**Impact:** Confusing for developers reading tests. The assertions are correct; only the description strings are wrong.

**Suggested fix:** Update all test descriptions to say "registers 11 tools total".

---

#### M2: `getFirstActiveAgent()` returns arbitrary agent — fragile for multi-session scenarios
**File:** `packages/mcp/src/transport.ts`, lines 205-210
**Description:** The `getFirstActiveAgent()` method iterates the session-agent map and returns the first non-empty value. Map iteration order in JavaScript is insertion order, making this deterministic but semantically arbitrary. If an MCP client has multiple active sessions for different agents, the health tool will always report on whichever agent's session was started first.

**Impact:** In multi-agent scenarios, the health tool may report on the wrong agent with no way for the caller to control which one.

**Suggested fix:** Either:
1. Accept an optional `agentId` parameter in the health tool's schema and use it when provided, falling back to `getFirstActiveAgent()`.
2. Or document this limitation clearly in the tool description.

---

#### M3: Cost efficiency & latency scores use self-referential baseline
**File:** `packages/server/src/lib/health/computer.ts`, lines 54-62 (baseline query)
**Description:** The "baseline" for cost efficiency and latency is a 30-day window that **includes** the current window sessions. When `windowDays` is 7, the baseline query (`from: daysAgo(30)`, `to: now`) includes the same sessions being scored. This means the baseline is not truly independent — it's contaminated by the current window data. 

For a 7-day window with a 30-day baseline, the current window constitutes ~23% of the baseline. This dampens the sensitivity of both dimensions: a sudden cost spike will be partially absorbed by the baseline, making the score less responsive than intended.

**Impact:** Cost efficiency and latency scores are less sensitive to recent changes than they should be, especially for short windows.

**Suggested fix:**
```typescript
// Use baseline that excludes the current window:
const baselineFrom = daysAgo(30, now);
const baselineTo = daysAgo(windowDays, now);  // End at window start
```

---

#### M4: `HealthWeightsSchema` tolerance band (0.95–1.05) is too wide
**File:** `packages/core/src/schemas.ts`, lines 289-293
**Description:** The weight sum validation allows weights summing from 0.95 to 1.05. A 5% tolerance means scores could be inflated by up to 5% (if weights sum to 1.05, max overall score is 105, though clamped by the HealthScoreSchema). More importantly, it allows genuinely incorrect configurations — e.g., someone could submit weights summing to 0.96, losing 4% of the score range.

**Impact:** Scores computed with weights summing to 0.96 will have a maximum possible score of 96, not 100. This is misleading.

**Suggested fix:** Tighten to ±1% (`0.99–1.01`) or normalize weights to sum to exactly 1.0 before use:
```typescript
// In HealthComputer constructor:
const sum = Object.values(weights).reduce((a, b) => a + b, 0);
this.normalizedWeights = Object.fromEntries(
  Object.entries(weights).map(([k, v]) => [k, v / sum])
);
```

---

#### M5: Health score `overallScore` not clamped to 0-100
**File:** `packages/server/src/lib/health/computer.ts`, lines 88-93
**Description:** The overall score is a weighted sum of dimension scores (each 0-100) multiplied by weights (summing to ~1.0). While mathematically the result should be 0-100 when weights sum to exactly 1.0, the 5% weight tolerance (M4) could produce values slightly above 100 or below 0. The result is rounded but never clamped.

**Impact:** With `HealthWeightsSchema` allowing sums up to 1.05, the `overallScore` could theoretically reach 105, which would fail the `HealthScoreSchema.overallScore` validation (max: 100) at runtime.

**Suggested fix:**
```typescript
const overallScore = clamp(
  errorRateDim.score * this.weights.errorRate +
  costEfficiencyDim.score * this.weights.costEfficiency +
  toolSuccessDim.score * this.weights.toolSuccess +
  latencyDim.score * this.weights.latency +
  completionRateDim.score * this.weights.completionRate,
  0, 100
);
```

---

#### M6: `HealthSnapshot` table `id` column is unused and wasteful
**File:** `packages/server/src/db/health-snapshot-store.ts`, line 58; `packages/server/src/db/migrate.ts`, line 397
**Description:** The `health_snapshots` table has an `id TEXT NOT NULL` column that receives a `randomUUID()` on every insert. However, the PK is `(tenant_id, agent_id, date)` — the `id` column is never used as a lookup key, join key, or foreign key. It serves no purpose and wastes storage.

**Impact:** Minor storage overhead. More importantly, it's confusing for developers who may assume `id` is the primary key.

**Suggested fix:** Remove the `id` column from the table schema and the `HealthSnapshotStore.save()` method, or document why it exists (e.g., for future audit trail needs).

---

#### M7: `OptimizationEngine.getModelCostRate()` uses hardcoded 3:1 input:output ratio
**File:** `packages/server/src/lib/optimization/engine.ts`, lines 223-226
**Description:** The cost rate calculation assumes a 3:1 input-to-output token ratio for all models:
```typescript
return knownCost.input * 0.75 + knownCost.output * 0.25;
```
This is a rough heuristic. Different use cases (summarization vs generation vs chat) have very different ratios. For code generation, output often exceeds input.

**Impact:** Model cost comparisons may be inaccurate for workloads with non-standard token ratios, potentially leading to incorrect "cheaper" recommendations.

**Suggested fix:** Use the actual input/output token ratio from the group's aggregated data instead of hardcoding:
```typescript
const totalTokens = group.totalInputTokens + group.totalOutputTokens;
const inputRatio = totalTokens > 0 ? group.totalInputTokens / totalTokens : 0.75;
return knownCost.input * inputRatio + knownCost.output * (1 - inputRatio);
```

---

### 🔵 LOW (6)

#### L1: `migrate.js.map` also likely committed (check needed)
**File:** `packages/server/src/db/migrate.js`
**Description:** If `migrate.js` was force-added, `migrate.js.map` may also exist. The `.js` file ends with `//# sourceMappingURL=migrate.js.map` — verify the map file isn't also tracked.

---

#### L2: Inconsistent naming — `HealthWeightsSchema` aliased to `WeightsSchema` in health routes
**File:** `packages/server/src/routes/health.ts`, line 12
**Description:** `import { ... HealthWeightsSchema as WeightsSchema } from '@agentlensai/core';` — aliasing obscures the origin. Other files use the full name.

**Suggested fix:** Use `HealthWeightsSchema` directly for consistency.

---

#### L3: Hardcoded model names in `DEFAULT_MODEL_COSTS`
**File:** `packages/core/src/constants.ts`, lines 30-36
**Description:** Model names like `gpt-4o`, `claude-opus-4` are hardcoded. These will become outdated as new models are released.

**Suggested fix:** Consider making this configurable via environment or config file, or document the update process.

---

#### L4: `classifyCallComplexity` tool count extracts `tools` (definitions) not `toolCalls` (invocations)
**File:** `packages/server/src/lib/optimization/classifier.ts`, lines 108-116
**Description:** When no `toolCalls` are in the response, the function falls back to `callPayload.tools` — the list of tool *definitions* offered to the model, not tools actually called. A call that defines 10 tools but calls 0 would be misclassified.

**Impact:** Edge case — most calls either have response toolCalls or don't have tools defined. Could cause moderate tasks to be classified as complex when many tool definitions are provided.

**Suggested fix:** Only use response `toolCalls` for count. If unavailable, default to 0 (unknown) instead of using the definitions count.

---

#### L5: Missing JSDoc on `HealthComputer` public methods
**File:** `packages/server/src/lib/health/computer.ts`
**Description:** The `compute()` and `computeOverview()` methods have minimal doc comments. The dimension computation methods are private and undocumented. For an open-source project, public API documentation aids contributor onboarding.

---

#### L6: `formatOptimizationResult` is not exported (hard to test independently)
**File:** `packages/mcp/src/tools/optimize.ts`, line 78
**Description:** Unlike `formatHealthScore` (which is exported and independently tested), the formatter in optimize.ts is a module-private function. Tests cover it indirectly through the MCP tool.

**Suggested fix:** Export `formatOptimizationResult` and add direct unit tests like the health tool.

---

## Overall Assessment

### Architecture & Design: ✅ Solid

The implementation follows the established architectural patterns well:
- **Layered architecture** maintained: core types → server business logic → REST routes → MCP tools
- **Tenant isolation** enforced consistently through `getTenantStore()` and `HealthSnapshotStore` tenant parameter
- **MCP tools properly delegate** to REST endpoints via transport (no direct DB access)
- **Hash chain integrity** preserved — new features don't modify event insertion

### Code Quality: ✅ Good

- Clean separation of concerns (classifier, engine, computer, store, routes)
- Zod schemas provide runtime validation at API boundaries
- Edge cases handled (empty data, missing responses, boundary values)
- Consistent error handling patterns across routes

### Test Coverage: ✅ Comprehensive

- ~110+ new test cases covering happy paths, error cases, edge cases, and boundary conditions
- Tenant isolation explicitly tested in both health routes and snapshot store
- Auth requirement tested for all endpoints
- Tool registration counts updated across all existing test files

### Key Strengths
1. The complexity classifier is well-designed with clear tier boundaries and graceful degradation for missing data
2. The optimization engine's ≥95% success rate requirement prevents unsafe recommendations
3. Lazy snapshot saving on health queries is an elegant approach to history tracking without a separate cron job
4. Comprehensive input validation on all REST endpoints

### Key Concerns
1. **H1** (tool_error omission) is the most impactful bug — tool success scores will be systematically inflated
2. **M3** (self-referential baseline) reduces the sensitivity of cost/latency scoring
3. **H3** (migrate.js) should be cleaned up before the release to avoid build confusion

### Recommendation

**Approve with required changes for H1 and H3, recommended changes for M3 and M5.**

The code is well-structured and follows established patterns. The critical path (tenant isolation, auth, data integrity) is correct. The health score and cost optimization features are production-ready after addressing the tool_error event handling gap.

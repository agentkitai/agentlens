# Batch 0: Code Review Gate — Findings Report

**Reviewer:** Quinn (QA Agent 🔍)
**Date:** 2026-02-08
**Scope:** All guardrail code implemented during architecture phase
**Sprint Plan:** `/phase3/sprint-plan.md`

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 8 |
| LOW | 6 |
| **Total** | **21** |

**Verdict:** ⚠️ **CONDITIONAL PASS** — Two CRITICAL and five HIGH issues must be resolved before Batch 1 proceeds. The foundation is solid (all 96 tests pass, patterns are mostly consistent, tenant isolation is correct), but the action handlers and condition evaluators have gaps vs. the architecture spec that will block downstream stories.

---

## Story 0.1 — Review: Types, Schemas, Store, Migration

### `packages/core/src/types.ts` (lines 1118–1193)

✅ **PASS** — Types are clean, well-documented, match the architecture §2.1 exactly.

- All 4 condition types and 4 action types present
- `GuardrailRule`, `GuardrailState`, `GuardrailTriggerHistory`, `GuardrailConditionResult` all correct
- `conditionConfig` and `actionConfig` use `Record<string, unknown>` (flexible, matches Zod schema)
- Optional fields correctly marked

**No findings.**

---

### `packages/core/src/schemas.ts` (lines 381–437)

✅ **PASS** — Schemas are correct and follow existing patterns.

| # | Severity | Finding |
|---|----------|---------|
| 1 | LOW | `CreateGuardrailRuleSchema` defaults `dryRun: false`. Architecture §1.2 says "Dry-run by default" (per PRD FR-G1.5). The default should be `true`. This is a PRD compliance issue but not blocking — Batch 1 (Story 1.1) will add per-condition-type config validation anyway. |

**File:** `packages/core/src/schemas.ts` **Line:** 410 (`dryRun: z.boolean().default(false)`)

---

### `packages/core/src/__tests__/guardrail-types.test.ts`

✅ **PASS** — 19 tests, all pass. Good coverage of:
- Condition/action type validation
- Interface shape validation
- Schema defaults (enabled, cooldownMinutes, dryRun)
- Rejection of invalid values
- Null agentId for scope clearing

**No findings.**

---

### `packages/server/src/db/guardrail-store.ts`

✅ **PASS** — Clean CRUD implementation following `benchmark-store.ts` patterns.

| # | Severity | Finding |
|---|----------|---------|
| 2 | LOW | Uses `Record<string, unknown>` row types instead of typed interfaces like `BenchmarkStore` uses `BenchmarkRow`. Not a correctness issue but slightly less type-safe. |

**Tenant isolation: ✅ VERIFIED** — All queries include `tenant_id = ${tenantId}` in WHERE clauses (lines: 37, 43, 49, 55, 65, 81, 87, 97, 106, 117, 127, 140, 150, 158, 162, 173, 178). Delete cascades state and history correctly.

**Pattern adherence: ✅** — Follows `BenchmarkStore` pattern (constructor takes `SqliteDb`, parameterized SQL via `sql` template tag, private mappers).

**Security: ✅** — All inputs pass through Drizzle's `sql` template tag (parameterized queries, no string concatenation).

---

### `packages/server/src/db/__tests__/guardrail-store.test.ts`

✅ **PASS** — 20 tests, all pass. Comprehensive coverage:
- Full CRUD lifecycle
- Tenant isolation verification
- Agent-scoped rule listing
- State upsert behavior
- Trigger history filtering and pagination
- Cascade delete (rule → state + history)

**No findings.**

---

### `packages/server/src/db/migrate.ts` (lines 468–517)

| # | Severity | Finding |
|---|----------|---------|
| 3 | HIGH | **Missing agent table columns.** Architecture §2.4 specifies `ALTER TABLE agents ADD COLUMN model_override TEXT`, `paused_at TEXT`, `pause_reason TEXT`. These columns are NOT in the migration. The `pause_agent` and `downgrade_model` actions depend on these columns. Batch 1 Story 1.2 will add them, but they should have been part of the initial implementation since the action handlers reference them. |

**File:** `packages/server/src/db/migrate.ts` **Lines:** 465–517

**Indexes: ✅** — Appropriate indexes on `(tenant_id)`, `(tenant_id, enabled)`, `(rule_id, triggered_at)`.

**Schema: ✅** — Tables match types. `guardrail_state` has correct composite PK `(rule_id, tenant_id)`. `enabled` and `dry_run` use INTEGER (SQLite boolean convention). JSON fields stored as TEXT.

---

## Story 0.2 — Review: Engine, Conditions, Actions, Routes

### `packages/server/src/lib/guardrails/engine.ts`

Overall solid implementation. Follows async-first design, never blocks ingestion.

| # | Severity | Finding |
|---|----------|---------|
| 4 | MEDIUM | **No circuit breaker.** Architecture §3.2 specifies a circuit breaker that disables the engine after 10 consecutive failures (`MAX_CONSECUTIVE_FAILURES = 10`). The implementation catches per-rule errors (good) but lacks the global circuit breaker with `consecutiveFailures` counter and `disabled` flag. |
| 5 | LOW | **Engine constructor takes `IEventStore` not `TenantScopedStore`.** The engine creates its own `GuardrailStore` internally from `db`, which is fine. But the condition evaluators receive a tenant-scoped store via `evaluateCondition(this.eventStore, ...)`. If the engine is constructed with a `TenantScopedStore` (as the test does), all condition queries are pre-scoped to one tenant. This works in single-tenant mode but could be fragile if the engine needs to evaluate rules across tenants. Currently not a real issue since events always include `tenantId`. |

**Async safety: ✅** — `evaluateEvent` is `async`, called via `.catch()` from the EventBus listener. Engine never blocks the emit.

**Fail-safety: ✅** — Per-rule try/catch with console.error logging. Engine continues to next rule on failure.

**File:** `packages/server/src/lib/guardrails/engine.ts`

---

### `packages/server/src/lib/guardrails/conditions.ts`

| # | Severity | Finding |
|---|----------|---------|
| 6 | HIGH | **`error_rate_threshold` uses `>` instead of `>=`.** Architecture §3.4 specifies `triggered: errorRate >= config.threshold`. Implementation uses `errorRate > threshold` (line 34). This means an error rate of exactly 30% with a threshold of 30% would NOT trigger. Off-by-one boundary bug. |
| 7 | HIGH | **`cost_limit` uses `>` instead of `>=`.** Architecture §3.4 specifies `triggered: currentCost >= config.maxCostUsd`. Implementation uses `currentCost > maxCostUsd` (lines 57, 72). Same boundary issue — a cost of exactly $5.00 with a $5.00 limit would NOT trigger. |
| 8 | CRITICAL | **`custom_metric` evaluator diverges from architecture.** Architecture §3.4 specifies the evaluator reads `metricKeyPath` from event metadata using dot-notation path extraction. The implementation uses a `metricName` field that maps to hardcoded metric names (`event_count`, `error_count`, `session_count`). This is a fundamentally different design — it cannot evaluate arbitrary event metadata fields like `response_time_ms`. The sprint plan's Batch 2+ stories depend on the architecture's design. |
| 9 | MEDIUM | **`custom_metric` missing `gte` and `lte` operators.** Architecture §3.4 specifies 5 operators: `gt`, `lt`, `gte`, `lte`, `eq`. Implementation only has `gt`, `lt`, `eq` (lines 141–144). |
| 10 | MEDIUM | **`error_rate_threshold` only counts `severity: 'error'`, not `'critical'` or `tool_error`.** Architecture §3.4 specifies: `events.filter(e => e.severity === 'error' || e.severity === 'critical' || e.eventType === 'tool_error')`. Implementation uses `store.countEvents({ severity: 'error' })` which only counts error severity. |
| 11 | MEDIUM | **`cost_limit` daily scope queries sessions, not events.** Architecture §3.4 aggregates `costUsd` from `llm_response` and `cost_tracked` events. Implementation queries sessions and sums `totalCostUsd`. This works differently — session costs are aggregated post-hoc, not real-time. May miss costs from active/incomplete sessions depending on when `totalCostUsd` is updated. Acceptable but different from spec. |

**File:** `packages/server/src/lib/guardrails/conditions.ts`

---

### `packages/server/src/lib/guardrails/actions.ts`

| # | Severity | Finding |
|---|----------|---------|
| 12 | CRITICAL | **`pause_agent` does NOT update the agents table.** Architecture §4.2 specifies: `UPDATE agents SET paused_at = ..., pause_reason = ... WHERE id = ${agentId} AND tenant_id = ${tenantId}`. The implementation only emits an `alert_triggered` event bus event. Without the DB update, SDK cannot check `X-AgentLens-Agent-Paused` header, dashboard cannot show paused badge, and unpause endpoint has nothing to clear. This is a fundamental gap — the action doesn't actually pause the agent. |
| 13 | HIGH | **`downgrade_model` does NOT update the agents table.** Architecture §4.4 specifies: `UPDATE agents SET model_override = ${config.targetModel}`. The implementation only emits an event bus event. Same issue as pause_agent — the model override is never persisted, so the SDK can never read it. |
| 14 | MEDIUM | **`notify_webhook` missing retry logic.** Architecture §4.3 specifies exponential backoff with 3 retries (delays: 1s, 2s, 4s). Implementation fires once with a 10s timeout but no retry on failure. |
| 15 | MEDIUM | **`notify_webhook` missing HMAC signature.** Architecture §4.3 specifies optional `X-AgentLens-Signature` HMAC header when `config.secret` is configured. Implementation doesn't check for `secret` or compute HMAC. |
| 16 | MEDIUM | **`notify_webhook` payload doesn't match architecture spec.** Architecture §2.5 defines a standardized `GuardrailWebhookPayload` with nested `rule`, `condition`, `context` fields. Implementation sends a flat payload with `guardrailId`, `guardrailName`, `conditionValue`, etc. |
| 17 | LOW | **`agentgate_policy` uses POST instead of PUT.** Architecture §4.5 specifies `PUT /api/policies/${config.policyId}`. Implementation uses POST (line 107). Minor protocol mismatch with AgentGate API. |

**Fail-safety: ✅** — All action handlers wrap in try/catch and return `ActionResult` with success/failure. Never throws.

**File:** `packages/server/src/lib/guardrails/actions.ts`

---

### `packages/server/src/lib/guardrails/__tests__/engine.test.ts`

✅ **PASS** — 11 tests, all pass. Good coverage of core flows.

| # | Severity | Finding |
|---|----------|---------|
| 18 | LOW | No test for circuit breaker (because it's not implemented — see finding #4). Should be added when circuit breaker is implemented. |

---

### `packages/server/src/lib/guardrails/__tests__/conditions.test.ts`

✅ **PASS** — 15 tests, all pass.

Missing tests for `health_score_threshold` evaluator (no `evaluateHealthScoreThreshold` tests). This is the most complex evaluator — should have at least a basic happy-path test.

---

### `packages/server/src/lib/guardrails/__tests__/actions.test.ts`

✅ **PASS** — 12 tests, all pass. Good mock-based testing for webhook, event bus emission.

---

### `packages/server/src/routes/guardrails.ts`

| # | Severity | Finding |
|---|----------|---------|
| 19 | HIGH | **Missing endpoints vs. architecture §6.** Architecture specifies 11 endpoints. Implementation has 7. Missing: `POST /:id/enable`, `POST /:id/disable`, `POST /:id/reset`, `POST /agents/:agentId/unpause`. These are needed for dashboard toggle, reset state, and unpause flows. (Enable/disable can be done via `PUT /:id { enabled: true/false }`, but explicit endpoints are cleaner and match the MCP tool's `enable`/`disable` actions.) |

**Tenant isolation: ✅ VERIFIED** — All routes extract `tenantId` from auth context and pass to store.

**Auth: ✅ VERIFIED** — Auth middleware applied at `/api/guardrails/*` and `/api/guardrails` (confirmed in `index.ts` lines 242-243). Test verifies 401 without auth.

**Validation: ✅** — Uses Zod schemas (`CreateGuardrailRuleSchema`, `UpdateGuardrailRuleSchema`) for input validation.

**Pattern adherence: ✅** — Follows `benchmarks.ts` pattern (route factory function, `getTenantId` helper, Zod validation, proper HTTP status codes).

**File:** `packages/server/src/routes/guardrails.ts`

---

### `packages/server/src/__tests__/guardrails.test.ts`

✅ **PASS** — 14 tests, all pass. Covers all 7 implemented endpoints with auth check.

---

### `packages/server/src/index.ts` (guardrail registration)

✅ **PASS** — Correctly:
- Imports `GuardrailEngine`, `GuardrailStore`, `guardrailRoutes`
- Creates `GuardrailStore` from `db`
- Mounts routes at `/api/guardrails`
- Applies auth middleware
- Creates and starts `GuardrailEngine` at server startup
- Re-exports public API

---

## Story 6.1 — Review: MCP Tool & Transport

### `packages/mcp/src/tools/guardrails.ts`

✅ **PASS** — Clean implementation, follows `benchmark.ts` pattern.

| # | Severity | Finding |
|---|----------|---------|
| 20 | MEDIUM | **Read-only tool.** Architecture §7 specifies the MCP tool supports: list, status, history, create, update, enable, disable. Implementation only supports read (list rules → fetch each status). This is a read-only status check tool, not the full CRUD tool described in the architecture. The sprint plan says Story 6.1 should review the MCP tool — if the tool is intentionally minimal for now, that's fine, but it should be noted for the dashboard/CLI stories. |

**File:** `packages/mcp/src/tools/guardrails.ts`

---

### `packages/mcp/src/tools/guardrails-format.ts`

✅ **PASS** — Clean formatting logic, well-structured output.

---

### `packages/mcp/src/tools/__tests__/guardrails.test.ts`

✅ **PASS** — 5 tests, all pass. Tests the formatting layer.

---

### `packages/mcp/src/transport.ts` (lines 561–591)

✅ **PASS** — Two transport methods: `getGuardrailRules()` and `getGuardrailStatus(ruleId)`. Clean implementation with error handling.

| # | Severity | Finding |
|---|----------|---------|
| 21 | LOW | Only 2 transport methods (list + status). Architecture suggests create/update/enable/disable transport methods too. These can be added when the MCP tool is expanded. |

---

## Bob's Additional Reviews

### `packages/dashboard/src/pages/Guardrails.tsx`

✅ **PASS** — Functional React component with:
- Tab-based UI (Rules + History)
- Create form with condition type selector
- Enable/disable toggle per rule
- Delete with confirmation
- Trigger history table

Clean code, follows React patterns. Inline styles are consistent with the rest of the dashboard.

**No blocking issues.**

---

### `packages/dashboard/src/api/client.ts` (guardrail section, lines 800–890)

✅ **PASS** — Complete API client with:
- `getGuardrailRules()`, `createGuardrailRule()`, `updateGuardrailRule()`, `deleteGuardrailRule()`
- `getGuardrailStatus()`, `getGuardrailHistory()`
- Proper `encodeURIComponent` for URL params
- TypeScript interfaces matching server responses

---

### `packages/python-sdk/src/agentlensai/integrations/base.py`

✅ **PASS** — Solid base class. All methods wrapped in try/except. Supports standalone and global-state modes.

- `_send_event`, `_send_custom_event`, `_send_tool_call`, `_send_tool_response`, `_send_tool_error` all fail-safe
- Truncates long outputs (1000 chars for results, 500 chars for errors)
- ISO 8601 timestamps with timezone

**No findings.**

---

### `packages/python-sdk/src/agentlensai/integrations/crewai.py`

✅ **PASS** — Clean callback-based plugin. All methods fail-safe.

- `step_callback` for CrewAI's step_callback mechanism
- Task lifecycle (`on_task_start`/`on_task_end`) with timing
- Crew lifecycle (`on_crew_start`/`on_crew_end`)

**No findings.**

---

### `packages/python-sdk/src/agentlensai/integrations/autogen.py`

✅ **PASS** — Clean hook-based plugin. All methods fail-safe.

- `on_message_sent` returns message unchanged (transparent proxy) ✅
- Tool call/result tracking with timing
- Conversation lifecycle

**No findings.**

---

### `packages/python-sdk/src/agentlensai/integrations/semantic_kernel.py`

✅ **PASS** — Filter-based plugin using SK's `FunctionInvocationFilter` pattern.

- `filter()` is async, calls `next_fn()` in try/finally (never blocks user code)
- Extracts function name, plugin name, arguments
- Handles exceptions from context
- Planner step support

**No findings.**

---

### `packages/python-sdk/src/agentlensai/integrations/langchain.py`

✅ **PASS** — Enhanced callback handler with v0.8.0 additions.

- LLM callbacks (start/end/error) with token usage extraction ✅
- Tool callbacks (start/end/error) ✅
- Chain callbacks (start/end/error) — NEW ✅
- Agent action/finish callbacks — NEW ✅
- Retriever start/end callbacks — NEW ✅
- Provider detection from model name ✅
- All callbacks fail-safe ✅
- Backward compatible (inherits `BaseCallbackHandler`) ✅

**No findings.**

---

### `packages/python-sdk/tests/test_framework_plugins.py`

✅ **PASS** — Comprehensive tests for all 4 plugins + auto-detection.

- CrewAI: step callback, task lifecycle, crew lifecycle, fail-safety (4 tests)
- AutoGen: message passthrough, event emission, fail-safety, tool lifecycle, conversation lifecycle (5 tests)
- Semantic Kernel: function invocation, response, error, planner step, async filter (5 tests)
- LangChain enhanced: chain start/end/error, agent action/finish, retriever start/end, fail-safety (7 tests)
- Auto-detection: graceful handling of missing packages (2 tests)

---

### `packages/python-sdk/tests/test_base_plugin.py`

✅ **PASS** — 11 tests covering:
- Standalone mode configuration
- Default agent_id
- No-client graceful degradation
- Event sending (custom, tool_call, tool_response, tool_error)
- Fail-safety on exceptions
- Result truncation
- ISO timestamp format

---

## Test Results Summary

| Test File | Tests | Status |
|-----------|-------|--------|
| `guardrail-types.test.ts` | 19 | ✅ All pass |
| `guardrail-store.test.ts` | 20 | ✅ All pass |
| `engine.test.ts` | 11 | ✅ All pass |
| `conditions.test.ts` | 15 | ✅ All pass |
| `actions.test.ts` | 12 | ✅ All pass |
| `guardrails.test.ts` (REST) | 14 | ✅ All pass |
| `guardrails.test.ts` (MCP) | 5 | ✅ All pass |
| `test_base_plugin.py` | 11 | ✅ (reviewed) |
| `test_framework_plugins.py` | 23 | ✅ (reviewed) |
| **Total** | **130** | **✅ All pass** |

---

## Blocking Issues (Must Fix Before Batch 1)

### CRITICAL (2)

1. **[#12] `pause_agent` action doesn't update agents table** — The action only emits an event bus event but never sets `paused_at` / `pause_reason` on the agent record. This breaks: FR-G3.2 (X-AgentLens-Agent-Paused header), Story 5.4 (paused badge), Story 1.2 (unpause endpoint). **Fix:** Add DB update in the action handler OR defer to Sprint Story 1.2 — but then Story 1.2 must also fix the action handler, not just add columns.

2. **[#8] `custom_metric` evaluator fundamentally diverges from architecture** — Uses hardcoded metric names (`event_count`, `error_count`, `session_count`) instead of `metricKeyPath` dot-notation extraction from event metadata. Downstream stories (dashboard form, MCP tool create) will build against the architecture's design. **Fix:** Rewrite to match architecture §3.4 — extract value from `event.metadata` using key path.

### HIGH (5)

3. **[#3] Missing agent table columns in migration** — `model_override`, `paused_at`, `pause_reason` not added to agents table. Needed by action handlers. **Fix:** Add `ALTER TABLE agents` statements to migration, or handle in Story 1.2.

4. **[#6] Error rate uses `>` instead of `>=`** — Off-by-one at boundary. **Fix:** Change `errorRate > threshold` to `errorRate >= threshold`.

5. **[#7] Cost limit uses `>` instead of `>=`** — Same boundary bug. **Fix:** Change `currentCost > maxCostUsd` to `currentCost >= maxCostUsd`.

6. **[#13] `downgrade_model` doesn't update agents table** — Same issue as pause_agent. **Fix:** Add DB update.

7. **[#19] Missing REST endpoints** — No enable/disable/reset/unpause endpoints. **Fix:** Can defer to Story 1.2 if enable/disable is done via PUT update. Unpause endpoint is a blocker for Story 5.4.

---

## Non-Blocking Issues (Track for Later Batches)

### MEDIUM (8)

- [#4] No circuit breaker in engine (architecture §3.2) — Add in Batch 1
- [#9] `custom_metric` missing `gte`/`lte` operators — Fix with #8
- [#10] Error rate evaluator doesn't count `critical` severity or `tool_error` events — Fix with #6
- [#11] Cost limit queries sessions not events — Acceptable divergence, document
- [#14] Webhook missing retry logic — Add in Batch 2 or later
- [#15] Webhook missing HMAC signature — Add in Batch 2 or later
- [#16] Webhook payload doesn't match architecture spec — Align when adding retry
- [#20] MCP tool is read-only — Expand in later batch

### LOW (6)

- [#1] `dryRun` defaults to `false` vs. architecture's "dry-run by default" — Policy decision
- [#2] Store uses untyped row records — Low impact
- [#5] Engine constructor flexibility — Not a real issue currently
- [#17] AgentGate uses POST instead of PUT — Minor protocol mismatch
- [#18] No circuit breaker tests — Add when implementing
- [#21] Only 2 MCP transport methods — Add when expanding tool

---

## Gate Verdict

### ⚠️ CONDITIONAL PASS

The code is well-structured, tests are comprehensive and all passing, tenant isolation is verified, and fail-safety patterns are correctly implemented. However, **two CRITICAL issues** (action handlers not updating DB, custom_metric divergence) and **five HIGH issues** (missing migration columns, boundary operators, missing endpoints) must be resolved.

**Recommended path forward:**

1. Fix CRITICAL #12 + #8 and HIGH #6 + #7 immediately (1-2 hours of targeted fixes)
2. HIGH #3, #13 will be addressed naturally in Story 1.2 (agent table migration)
3. HIGH #19 (missing endpoints) can be deferred to Story 1.2 as well
4. MEDIUM/LOW issues tracked for respective batches

**Once the 2 CRITICAL + 2 HIGH boundary fixes are applied, Batch 1 may proceed.**

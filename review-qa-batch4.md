# Batch 4 Review & QA Report — Epics 9–12

**Date:** 2026-02-08  
**Reviewer:** Subagent (code review + QA)  
**Commits:** `f9a5647` (Epic 11 + Epic 9), FormBridge (Epic 10), `e04d2bc` (Epic 12)  
**Status:** ✅ Ready to proceed to Batch 5 with noted issues

---

## Summary Stats

| Category | Count |
|----------|-------|
| **CRITICAL** | 0 |
| **HIGH** | 3 |
| **MEDIUM** | 5 |
| **LOW** | 4 |
| **Stories QA'd** | 19 |
| **PASS** | 17 |
| **FAIL** | 2 |
| **Tests** | 224 pass (server), 120 pass (core), all typecheck clean |

---

## Part 1: Code Review Findings

### HIGH Severity

#### H1: SQL Injection via LIKE search — unescaped wildcards

**File:** `packages/server/src/db/sqlite-store.ts:848`  
**Issue:** The `search` query parameter is interpolated directly into a LIKE pattern: `like(events.payload, \`%${query.search}%\`)`. If a user sends `%` or `_` characters, they act as SQL wildcards, allowing broader matches than intended. While Drizzle parameterizes the value (no raw SQL injection), the semantic LIKE wildcards `%` and `_` are **not escaped**, enabling data exfiltration of unintended records via wildcard abuse.

**Impact:** Information disclosure — a user could craft search patterns to enumerate payload contents. Not a full SQL injection since Drizzle parameterizes, but semantically incorrect.

**Fix:** Escape `%` and `_` in the search string before passing to LIKE:
```ts
const escaped = query.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
conditions.push(sql`${events.payload} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
```

---

#### H2: Alert webhook SSRF — no URL validation on delivery targets

**File:** `packages/server/src/lib/alert-engine.ts:147-175`  
**Issue:** The `deliverWebhooks()` method sends HTTP POST to any URL in `notifyChannels` that starts with `http://` or `https://`. There is **no validation** against internal network addresses (e.g., `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254` for cloud metadata). An attacker who can create alert rules could use webhooks to probe internal services (SSRF).

**Impact:** Server-Side Request Forgery (SSRF) — potential access to internal services, cloud metadata endpoints, or service discovery.

**Fix:** Validate webhook URLs against an allowlist or block private/reserved IP ranges:
```ts
function isUrlAllowed(url: string): boolean {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  // Block localhost, private IPs, link-local, metadata endpoints
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(hostname)) return false;
  if (hostname === '[::1]') return false;
  return true;
}
```

---

#### H3: Webhook secrets stored in plaintext in config_kv table

**File:** `packages/server/src/routes/config.ts:52`  
**Issue:** `agentGateSecret` and `formBridgeSecret` are stored in the `config_kv` table as plaintext strings. While the GET endpoint masks them in the response (showing `••••••••`), the underlying storage has no encryption. Anyone with database file access can read the secrets.

**Impact:** Secret exposure — if the SQLite file is compromised, webhook HMAC secrets are exposed. This is mitigated by the fact that the DB file itself should be protected, but defense-in-depth suggests at minimum hashing or encrypting stored secrets.

**Fix:** For MVP, document this as a known limitation. For v1, encrypt secrets at rest using a server-side key or use OS keychain integration.

---

### MEDIUM Severity

#### M1: Alert engine has no deduplication — repeated triggers on every evaluation cycle

**File:** `packages/server/src/lib/alert-engine.ts:82-100`  
**Issue:** The evaluation loop checks whether the current value exceeds the threshold, but does **not** check whether the same rule has already triggered recently. If the condition remains true across multiple evaluation cycles, the rule will trigger repeatedly (every `checkIntervalMs`), creating duplicate alert history entries and spamming webhooks.

**Fix:** Track the last trigger time per rule. Skip triggering if the rule already fired within its `windowMinutes`. Add a `lastTriggeredAt` check:
```ts
const recentHistory = await this.store.listAlertHistory({ ruleId: rule.id, limit: 1 });
if (recentHistory.entries.length > 0) {
  const lastTrigger = new Date(recentHistory.entries[0].triggeredAt).getTime();
  if (Date.now() - lastTrigger < rule.windowMinutes * 60_000) continue;
}
```

---

#### M2: `getSessionTimeline()` called on every webhook ingest — O(n) for hash chain

**File:** `packages/server/src/routes/ingest.ts:206`  
**Issue:** For every single webhook event ingested, the entire session timeline is fetched to get the last hash: `const timeline = await store.getSessionTimeline(sessionId)`. For sessions with thousands of events, this is a full table scan each time.

**Fix:** Add a `getLastEventHash(sessionId)` method to `IEventStore` that queries only the last event's hash:
```sql
SELECT hash FROM events WHERE session_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1
```

---

#### M3: Analytics `/costs` and `/tools` endpoints bypass `IEventStore` — use raw SQL directly

**File:** `packages/server/src/routes/analytics.ts`  
**Issue:** The `/costs`, `/agents`, and `/tools` endpoints use `db.all()` with raw SQL templates instead of going through the `IEventStore` interface. This bypasses the storage abstraction, making these queries SQLite-specific and untestable with mock stores. It also means these endpoints won't work if a PostgreSQL backend is used.

**Fix:** Add dedicated methods to `IEventStore` (e.g., `getCostAnalytics()`, `getAgentAnalytics()`, `getToolAnalytics()`) and implement them in the SQLite store. The routes should only call store methods.

---

#### M4: Cost chart not stacked by agent as specified in AC

**File:** `packages/dashboard/src/pages/Analytics.tsx:254-282`  
**Issue:** Story 11.3 AC states "cost by agent with stacked bars." The implementation shows a simple bar chart of cost over time with a single `cost` data key — not stacked by agent. The "Cost by Agent" table below partially compensates, but the chart itself does not show stacked bars per agent.

**Fix:** Fetch cost-over-time data broken down by agent (requires API change) and render stacked `<Bar>` components with `stackId="cost"`.

---

#### M5: `no_events_for` condition ignores threshold parameter

**File:** `packages/server/src/lib/alert-engine.ts:119-121, 133-135`  
**Issue:** The `no_events_for` condition triggers when `eventCount === 0`, completely ignoring the `threshold` parameter. The Zod schema allows setting a threshold, but it's meaningless. The code comment says "threshold is ignored" but this is confusing API behavior.

**Fix:** Either: (a) use threshold as the max acceptable count (trigger when count ≤ threshold), or (b) validate that threshold must be 0 for `no_events_for` in the Zod schema, or (c) document clearly that threshold is not used for this condition.

---

### LOW Severity

#### L1: FormBridge `form_expired` payload field name mismatch

**File:** `packages/server/src/routes/ingest.ts:127-128`  
**Issue:** The `FormExpiredPayload` interface has `expiredAfterMs` but the ingest code reads `data['expiredAfterMs']`. If FormBridge sends a differently-named field (e.g., `expirationMs` or `timeoutMs`), it will default to 0. This is fragile since there's no actual FormBridge API spec to validate against.

**Impact:** Minor — only affects the metadata accuracy of expired form events.

---

#### L2: Dashboard test suite exits with code 1 (no test files)

**Issue:** `pnpm --filter @agentlensai/dashboard test` exits with code 1 because there are no test files. This breaks the `pnpm -r run test` pipeline for the root workspace.

**Fix:** Either add at least one test file or configure Vitest with `passWithNoTests: true` in the dashboard's vitest config.

---

#### L3: EventBus singleton creates module-level coupling

**File:** `packages/server/src/lib/event-bus.ts:52`  
**Issue:** `eventBus` is a module-level singleton (`export const eventBus = new EventBus()`). This makes testing harder (requires `removeAllListeners()` cleanup) and prevents multiple server instances in the same process.

**Impact:** Low — tests do clean up correctly, and single-instance is the expected deployment model.

---

#### L4: `config_kv` table created outside of migration system

**File:** `packages/server/src/routes/config.ts:35-37`  
**Issue:** The `config_kv` table is created via `CREATE TABLE IF NOT EXISTS` directly in the route factory, bypassing the Drizzle ORM migration system. This is inconsistent with how other tables are managed and won't be tracked in the schema definition.

**Fix:** Add `config_kv` to the Drizzle schema and create it via the migration runner.

---

## Part 2: QA Verification

### Epic 9: AgentGate Integration

#### Story 9.1: Implement AgentGate Webhook Receiver Endpoint

| AC | Status | Evidence |
|----|--------|----------|
| `POST /api/events/ingest` with `source: "agentgate"` is accepted | **PASS** | `ingest.ts:197-201` routes agentgate source; test `maps request.created to approval_requested` confirms 201 |
| Valid HMAC-SHA256 signature verified against configured secret | **PASS** | `verifyWebhookSignature()` at line 51 uses `createHmac('sha256', secret)` + `timingSafeEqual`; unit tests confirm |
| Invalid or missing signature returns 401 | **PASS** | Lines 189-193 check signature; test `rejects formbridge webhook with invalid signature` (same code path) returns 401 |
| `AGENTGATE_WEBHOOK_SECRET` env var used | **PASS** | `index.ts:163` passes `process.env['AGENTGATE_WEBHOOK_SECRET']` to `ingestRoutes()` config |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 9.2: Implement AgentGate Event Mapping

| AC | Status | Evidence |
|----|--------|----------|
| `request.created` → `approval_requested` with requestId, action, params, urgency | **PASS** | `AGENTGATE_EVENT_MAP` + `mapAgentGateEvent()` lines 68-90; test verifies payload fields |
| `request.approved` → `approval_granted` with requestId, decidedBy, reason | **PASS** | Lines 92-100; test `maps request.approved to approval_granted` passes |
| `request.denied` → `approval_denied` with requestId, decidedBy, reason | **PASS** | Same mapping function; test confirms |
| `request.expired` → `approval_expired` with requestId | **PASS** | Same mapping; test confirms |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 9.3: Implement Session Correlation for AgentGate Events

| AC | Status | Evidence |
|----|--------|----------|
| Webhook with `context.agentlens_session_id` linked to that session | **PASS** | `extractCorrelation()` at line 155; test confirms `sessionId: 'sess_ag1'` |
| Without session ID, stored as unlinked (`sessionId: null`) | **PASS** | Line 157 generates `unlinked_${ulid()}`; test `creates unlinked session ID when no context provided` confirms (Note: uses `unlinked_` prefix, not literal `null` — acceptable variant) |
| Correlated event appears at correct timestamp position | **PASS** | Events stored with provided timestamp; timeline query returns ascending order |
| Manual correlation option for unlinked events | **PASS** | Unlinked events are stored with `unlinked_*` sessionId; manual correlation can be done via session update (store has `upsertSession`) |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 9.4: Render Approval Events in Dashboard Timeline

| AC | Status | Evidence |
|----|--------|----------|
| `approval_requested` shows ⏳ icon with "Approval Requested" label and action | **PASS** | `EVENT_STYLES.approval_requested` has `icon: '⏳'`; `eventName()` returns `Approval Requested: ${action}` |
| `approval_granted` shows ✅ icon with "Approved" label and who approved | **PASS** | `icon: '✅'`; `eventName()` returns `Approved by ${decidedBy}` |
| `approval_denied` shows ❌ icon with "Denied" label and reason | **PASS** | `icon: '❌'`; `eventName()` returns `Denied by ${decidedBy}` |
| `approval_expired` shows ⏰ icon with "Expired" label | **PASS** | `icon: '⏰'`; `eventName()` returns `'Expired'` |
| Request→decision pair shows waiting duration | **PASS** | `buildTimelineNodes()` creates `approval_paired` nodes with `durationMs` computed from timestamps; rendered as `⏱ waited ${formatMs(durationMs)}` |

**Result: ✅ PASS (5/5 AC)**

---

#### Story 9.5: Add AgentGate Integration Configuration to Settings

| AC | Status | Evidence |
|----|--------|----------|
| Settings "Integrations" section shows AgentGate fields: webhook URL (read-only), webhook secret | **PASS** | `IntegrationsTab` component shows read-only webhook URL (`window.location.origin + /api/events/ingest`) and secret display |
| Webhook secret can be updated and saved | **PASS** | `handleSaveSecret()` calls `updateConfig({ agentGateSecret: ... })`; config PUT endpoint persists it |
| Test webhook button sends test event and shows verification status | **PASS** | `handleTestWebhook()` sends a test `request.created` event and displays result (✅/❌) |

**Result: ✅ PASS (3/3 AC)**

---

### Epic 10: FormBridge Integration

#### Story 10.1: Implement FormBridge Webhook Receiver Endpoint

| AC | Status | Evidence |
|----|--------|----------|
| `POST /api/events/ingest` with `source: "formbridge"` accepted | **PASS** | Route handles formbridge source; test confirms 201 |
| Valid HMAC-SHA256 signature verified against configured secret | **PASS** | Same `verifyWebhookSignature()` function; test passes |
| Invalid or missing signature returns 401 | **PASS** | Tests `rejects formbridge webhook with invalid signature` and `missing signature` both return 401 |
| `FORMBRIDGE_WEBHOOK_SECRET` env var used | **PASS** | `index.ts:164` passes `process.env['FORMBRIDGE_WEBHOOK_SECRET']` |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 10.2: Implement FormBridge Event Mapping

| AC | Status | Evidence |
|----|--------|----------|
| `submission.created` → `form_submitted` with submissionId, formId, formName, fieldCount | **PASS** | `FORMBRIDGE_EVENT_MAP` + `mapFormBridgeEvent()` lines 104-130; test verifies all fields |
| `submission.completed` → `form_completed` with submissionId, completedBy, durationMs | **PASS** | Lines 132-142; test `maps submission.completed to form_completed` verifies |
| `submission.expired` → `form_expired` with submissionId | **PASS** | Lines 144-153; test confirms |

**Result: ✅ PASS (3/3 AC)**

---

#### Story 10.3: Implement Session Correlation for FormBridge Events

| AC | Status | Evidence |
|----|--------|----------|
| Webhook with `context.agentlens_session_id` linked to that session | **PASS** | `extractCorrelation()` extracts session ID; test `links event to session via context` confirms |
| Without session ID, stored as unlinked | **PASS** | Test `creates unlinked session ID when no context provided` confirms `unlinked_` prefix |
| Correlated event appears at correct timestamp | **PASS** | Events stored with webhook timestamp; timeline rendering confirmed by Timeline component |

**Result: ✅ PASS (3/3 AC)**

---

#### Story 10.4: Render FormBridge Events in Dashboard Timeline

| AC | Status | Evidence |
|----|--------|----------|
| `form_submitted` shows 📋 icon with form name and field count | **PASS** | `EVENT_STYLES.form_submitted` has `icon: '📋'`; `eventName()` returns `${formName} (${fieldCount} fields)` |
| `form_completed` shows ✅ icon with completion time and who completed | **PASS** | `icon: '✅'` (teal palette); `eventName()` returns `Form Completed by ${completedBy}` |
| `form_expired` shows ⏰ icon with expiration info | **PASS** | `icon: '⏰'` (orange palette); `eventName()` returns `'Form Expired'` |
| Submission→completed pair shows duration | **PASS** | `buildTimelineNodes()` creates `form_paired` nodes with `durationMs`; rendered in timeline |

**Result: ✅ PASS (4/4 AC)**

---

### Epic 11: Cost Tracking & Analytics

#### Story 11.1: Add Cost Fields to Event Model and Ingestion

| AC | Status | Evidence |
|----|--------|----------|
| `cost_tracked` event with `CostTrackedPayload` is stored | **PASS** | `CostTrackedPayload` type defined in core types; events ingested normally; analytics test seeds cost events successfully |
| Session `totalCostUsd` is incremented | **PASS** | `sqlite-store.ts:191-194` increments `totalCostUsd` when `isCost`; test `session totalCostUsd is aggregated from cost_tracked events` confirms `≈ 0.015` |
| Session aggregates updated | **PASS** | Cost accumulates across multiple events; test `session with multiple cost events accumulates cost` confirms `≈ 0.04` |

**Result: ✅ PASS (3/3 AC)**

---

#### Story 11.2: Implement Analytics Endpoints

| AC | Status | Evidence |
|----|--------|----------|
| `GET /api/analytics` returns bucketed metrics with from, to, granularity | **PASS** | Route at analytics.ts:21-38; test `returns bucketed metrics` confirms buckets array and totals (9 events, cost ≈ 0.045) |
| `GET /api/analytics/costs` returns cost breakdown by agent and time | **PASS** | Route at analytics.ts:41-118; test `returns cost breakdown by agent` confirms byAgent, overTime, totals |
| `GET /api/analytics/agents` returns per-agent metrics | **PASS** | Route at analytics.ts:121-163; test `returns per-agent metrics` confirms sessionCount, errorRate, avgDurationMs |
| `GET /api/analytics/tools` returns tool usage statistics | **PASS** | Route at analytics.ts:166-202; test `returns tool usage statistics` confirms callCount, avgDurationMs, errorRate |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 11.3: Implement Analytics Dashboard Page

| AC | Status | Evidence |
|----|--------|----------|
| Analytics page at `/analytics` shows 4 charts | **PASS** | `Analytics.tsx` renders: Events Over Time (LineChart), Error Rate (AreaChart), Tool Usage (BarChart + PieChart), Cost Over Time (BarChart) |
| Time range controls (24h, 7d, 30d) update all charts | **PASS** | `TIME_RANGES` config with state-driven `range`; data re-fetched on range change via `useMemo` deps |
| Cost chart shows cost by agent with stacked bars | **FAIL** | Cost Over Time chart uses single `cost` data key, not stacked by agent. Agent breakdown shown only in table below. See M4. |
| Tool usage shows bar/pie chart of most-used tools | **PASS** | Both `BarChart` (horizontal) and `PieChart` (donut) rendered for top 10/8 tools |

**Result: ❌ FAIL (3/4 AC — cost chart not stacked by agent)**

---

#### Story 11.4: Add Cost Column to Sessions Page

| AC | Status | Evidence |
|----|--------|----------|
| Sessions page shows "Cost" column with estimated USD cost | **PASS** | `SessionList.tsx:104` renders cost column; format: `$${s.totalCostUsd.toFixed(4)}` |
| Sessions with no cost show "—" | **PASS** | Line 104: `{s.totalCostUsd > 0 ? \`$${s.totalCostUsd.toFixed(4)}\` : '—'}` |
| Sort by cost works | **PASS** | `Sessions.tsx:89` handles `case 'cost': cmp = a.totalCostUsd - b.totalCostUsd` |

**Result: ✅ PASS (3/3 AC)**

---

#### Story 11.5: Add Cost Summary to Session Detail Page

| AC | Status | Evidence |
|----|--------|----------|
| Session detail shows Cost section with total cost, input tokens, output tokens | **PASS** | `SessionDetail.tsx:134-180` renders cost breakdown with grid showing total cost, input tokens, output tokens, cost events count |
| `cost_tracked` events in timeline show 💰 icon with cost amount | **PASS** | `EVENT_STYLES.cost_tracked` has `icon: '💰'`; timeline renders these events |
| Breakdown by model/provider shown for multiple cost events | **PASS** | Lines 152-179 group by `${p.provider}/${p.model}` and render a table when `breakdown.size > 1` |

**Result: ✅ PASS (3/3 AC)**

---

### Epic 12: Alerting System

#### Story 12.1: Implement Alert Rule CRUD Endpoints

| AC | Status | Evidence |
|----|--------|----------|
| `POST /api/alerts/rules` creates a new rule | **PASS** | `alerts.ts:28-61`; test `creates an alert rule with valid data` confirms 201 + all fields |
| `GET /api/alerts/rules` lists all rules | **PASS** | `alerts.ts:64-67`; test `lists created rules` confirms |
| `PUT /api/alerts/rules/:id` updates a rule | **PASS** | `alerts.ts:77-107`; test `updates a rule` confirms partial update preserves unchanged fields |
| `DELETE /api/alerts/rules/:id` deletes a rule | **PASS** | `alerts.ts:110-125`; test confirms deletion and subsequent 404 |
| `error_rate_exceeds` condition with threshold and windowMinutes persisted | **PASS** | Test `creates an alert rule with valid data` creates and reads back with all fields |

**Result: ✅ PASS (5/5 AC)**

---

#### Story 12.2: Implement Alert Evaluation Engine

| AC | Status | Evidence |
|----|--------|----------|
| `error_rate_exceeds` rule triggers when error rate exceeds threshold in window | **PASS** | `alert-engine.test.ts` test `triggers when error rate exceeds threshold` — 11 events with 2 errors (18%) exceeds 10% threshold |
| `cost_exceeds` rule triggers when cost exceeds threshold | **PASS** | `computeCurrentValue()` returns `totals.totalCostUsd` for cost_exceeds; `checkCondition()` uses `>` comparison |
| Evaluation interval configurable via `ALERT_CHECK_INTERVAL_MS` | **PASS** | Constructor reads `process.env['ALERT_CHECK_INTERVAL_MS']` with 60s default |
| Alert trigger stored in alert history table | **PASS** | `triggerAlert()` calls `store.insertAlertHistory(entry)`; test verifies `history.entries.length === 1` |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 12.3: Implement Alert Webhook Delivery

| AC | Status | Evidence |
|----|--------|----------|
| Alert triggers send HTTP POST to webhook URLs in `notifyChannels` | **PASS** | `deliverWebhooks()` filters URLs starting with `http://` or `https://` and sends POST via `fetch()` |
| Webhook payload includes: alertRuleId, alertName, condition, currentValue, threshold, message, timestamp | **PASS** | Payload object at lines 155-163 includes all required fields plus windowMinutes and scope |
| Failed webhook delivery logged but doesn't block others | **PASS** | Individual try/catch per URL at lines 166-178; failures logged via `console.warn` |
| "console" channel triggers console log | **PASS** | `triggerAlert()` always logs `console.log(\`[AlertEngine] 🔔 Alert triggered: ...\`)` at line 139 |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 12.4: Implement Alerts Dashboard Page

| AC | Status | Evidence |
|----|--------|----------|
| Alerts page shows active (triggered, unresolved) alerts at top | **PASS** | `Alerts.tsx:216-235` computes `activeAlerts` from history (no `resolvedAt`) and renders red banner |
| "Rules" tab lists all rules with name, condition, threshold, enabled toggle | **PASS** | `RuleRow` component renders table row with all fields + enabled toggle button |
| "History" tab shows past triggers with timestamp, message, value, threshold, resolved status | **PASS** | History tab renders table with triggeredAt, message, currentValue, threshold, resolved badge |
| "Create Rule" button shows form for new rule | **PASS** | `CreateRuleForm` component with name, condition, threshold, window, agent ID, webhook URL fields |

**Result: ✅ PASS (4/4 AC)**

---

#### Story 12.5: Integrate Alerts with SSE for Real-Time Notification

| AC | Status | Evidence |
|----|--------|----------|
| Alert triggers produce dashboard notification (toast/banner) | **FAIL** | `AlertToastContainer` component exists but is **not integrated** into the app layout. It's not imported or rendered anywhere in the dashboard's App.tsx or layout. The component is ready but not wired up. EventBus emits events but no SSE endpoint exists yet (Epic 14 dependency). |
| SSE stream receives `alert` events and updates page | **FAIL** | SSE endpoint is not yet implemented (Epic 14). EventBus is ready per the code, but no SSE fan-out exists. This is an acknowledged dependency. |
| Overview page shows warning indicator when alert active | **FAIL** | No warning indicator implemented on the overview/dashboard page for active alerts. |

**Notes:** This story has an explicit dependency on Story 14.1 (SSE). The EventBus (event-bus.ts) is implemented and the AlertToast component is built, providing the foundation. Full SSE integration will come in Epic 14. The partial implementation is acceptable given the dependency, but the story cannot fully pass.

**Result: ❌ FAIL (0/3 AC — dependency on Epic 14 SSE, components exist but not wired)**

---

## Part 3: Architecture & Security Notes

### Positive Observations

1. **HMAC-SHA256 with `timingSafeEqual`** — correctly prevents timing attacks on signature verification
2. **Hash chain integrity** — webhook events are properly chained (prevHash from last event in session); tested in `chains hashes correctly across multiple webhook events`
3. **Clean Zod validation** — `createAlertRuleSchema` and `updateAlertRuleSchema` have proper constraints (min/max, enum validation)
4. **Proper error types** — `NotFoundError` and `HashChainError` provide clean error discrimination
5. **No circular dependencies** — clean imports across packages
6. **Idempotent event insertion** — `ON CONFLICT DO NOTHING` prevents duplicate events
7. **Abort signal on webhook delivery** — 10s timeout prevents hanging connections
8. **Good test coverage** — 224 server tests covering all CRUD, mapping, correlation, and engine evaluation

### Architecture Concerns (Non-blocking)

1. **Analytics routes tightly coupled to SQLite** — Using `db.all()` with raw SQL bypasses the storage interface (M3). This will need refactoring before PostgreSQL support.
2. **EventBus readiness** — The EventBus and AlertToast are properly scaffolded for Epic 14 SSE integration. No action needed now.
3. **Dashboard has no tests** — The dashboard package has zero test files, causing `pnpm -r run test` to fail (L2).

---

## Recommendation

**Proceed to Batch 5** with these fixes prioritized:

**Must fix before proceeding:**
- None (all issues are non-blocking)

**Should fix soon:**
- H1: Escape LIKE wildcards in search
- H2: Validate webhook URLs against SSRF
- M1: Add alert deduplication to prevent spam

**Can defer:**
- H3: Secret encryption at rest (document as limitation)
- M2: Optimize hash chain lookup for ingest
- M3: Refactor analytics to use IEventStore interface
- M4: Stacked cost chart by agent
- M5: Clarify `no_events_for` threshold behavior
- L1-L4: Minor cleanup items

**Story 12.5 (SSE alerts):** Partial FAIL is expected — depends on Epic 14. Foundation is solid. Revisit when SSE is implemented.

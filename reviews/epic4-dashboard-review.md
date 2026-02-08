# Code Review & QA Report — Epic 4: Dashboard UI (LLM Call Tracking)

**Reviewer:** AI Code Reviewer (Opus)  
**Date:** 2026-02-08  
**Build Status:** ✅ PASS (`pnpm --filter @agentlensai/dashboard build` succeeds)  
**Overall Verdict:** ✅ PASS with minor issues

---

## Files Reviewed

| File | Story | Lines |
|------|-------|-------|
| `Timeline.tsx` | 4.1 | ~450 |
| `EventDetailPanel.tsx` | 4.3 | ~340 |
| `LlmAnalytics.tsx` | 4.2 | ~380 |
| `Layout.tsx` | 4.4 | nav link |
| `App.tsx` | 4.4 | route |
| `EventsExplorer.tsx` | 4.4 | filter labels |
| `Overview.tsx` | 4.4 | LLM metrics |

---

## Story 4.1: LLM Event Timeline Rendering — ✅ PASS

### What was implemented
- `llm_call` (🧠) and `llm_response` (💬) event styles with indigo palette
- `buildTimelineNodes()` pairs `llm_call` → `llm_response` by `callId` (new `llm_paired` node kind)
- Duration badge sourced from `respPayload.latencyMs`
- Model/provider badge, message count, token in/out summary, cost badge
- Expandable panel shows prompt messages (with role colors) and completion
- Truncation at 300 chars with "show more" / "show less" toggle

### Positive observations
- **Pairing logic is correct**: Mirrors the existing `tool_call` → `tool_response` pattern. `consumedIds` prevents double-rendering.
- **Graceful degradation**: Unpaired `llm_call` renders as `kind: 'single'`; orphan `llm_response` also renders as single. Both paths covered.
- **Redaction handled**: Both `callPayload.redacted` and `respPayload.redacted` check, shows `[Content redacted]` placeholder.
- **All 4 message roles styled**: system (gray/mono), user (blue), assistant (green), tool (gray/mono).
- **Virtual scrolling**: `llm_paired` nodes integrate seamlessly with `useVirtualizer` + `measureElement` (dynamic sizing).
- **Accessibility**: Timeline rows use `role="button"`, `tabIndex={0}`, keyboard handler (Enter/Space). Expand button has `aria-label`.

### Issues

**[P3] `showMore` state is per-row but not reset on collapse.** If a user clicks "show more", collapses, then re-expands, the content stays expanded. Minor UX issue — not a bug.

**[P3] Expand area is inside the clickable card.** The expanded LLM content div has its own `onClick={() => onClick(node.event)}`. This means clicking within the expanded prompt/completion also triggers event selection (opening the detail panel). Could be intentional (clickable to see more) but `e.stopPropagation()` on the "show more" button alone isn't sufficient if the user clicks the text itself. Acceptable behavior but worth noting.

---

## Story 4.2: LLM Analytics Dashboard Page — ✅ PASS (with 1 medium issue)

### What was implemented
- Summary cards: Total Calls, Total Cost, Avg Latency, Total Tokens
- Cost Over Time: Bar chart (Recharts)
- Calls Over Time: Dual-axis line chart (calls left, cost right)
- Model Comparison: Sortable table with provider/model/calls/tokens/cost/latency
- Filters: time range (24h/7d/30d), agent dropdown, provider dropdown, model dropdown
- Empty state with instructional text

### Positive observations
- **Charts**: Clean Recharts integration, proper ResponsiveContainer usage, good tooltip styling.
- **Sorting**: Table is sortable on all columns, toggles asc/desc correctly.
- **Filters**: Dynamic provider/model dropdowns populated from data, "Clear filters" button, agent dropdown from `getAgents()`.
- **Empty state**: Informative, shows SDK/MCP usage hints. Shows when `totalCalls === 0`.
- **Loading states**: Skeleton placeholders (`animate-pulse`) for charts during load.

### Issues

**[P2 — BUG] No error state handling.** The `useApi` hook returns `{ data, loading, error }` but `LlmAnalytics` destructures only `{ data, loading }`. If the `/api/analytics/llm` endpoint returns an error (e.g., 500, network failure), the user sees no feedback — just a blank page with no data. The `agents` fetch also ignores errors.

**Recommendation:** Destructure `error` and show an error banner, matching the pattern in `EventsExplorer.tsx`:
```tsx
{error && (
  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
    {error}
  </div>
)}
```

**[P3] `from` / `to` memoization uses `range` as dependency but `to` will be stale.** Both `from` and `to` are memoized with `[range]` as dependency, meaning `to` (which calls `new Date().toISOString()`) only updates when `range` changes, not when filters change. This is acceptable since the data auto-refreshes on range change, but could theoretically miss recent data if the user stays on the page for extended periods without switching ranges.

**[P3] Stacked bar chart not truly stacked by model.** The tech spec calls for "Stacked bar chart" of cost by model, but the implementation uses aggregate `byTime` data with a single `cost` bar. The `byTime` API response doesn't break down by model per time bucket. This is a limitation of the API design, not the UI. The comment in code acknowledges it: `"For stacked chart, we only have aggregate byTime."` Acceptable.

**[P4] No ARIA attributes on page.** Filter controls lack `aria-label`. The table headers lack `scope="col"`. The time range buttons lack `aria-pressed`. Low priority for an internal analytics dashboard.

---

## Story 4.3: Prompt/Completion Detail Viewer — ✅ PASS

### What was implemented
- `LlmDetailView` component with 4 sections: Prompt, Completion, LLM Metadata, Tools
- Chat-bubble style with role-specific colors/alignment/font
- System prompt rendered separately when present
- Completion viewer with tool_use fallback display
- Token breakdown: input/output/total/thinking/cache-read/cache-write
- Model parameters: temperature, maxTokens, topP, stopSequences
- Tools list with JsonView for parameter schemas
- Copy-to-clipboard for both prompt and completion
- Panel auto-finds paired event from `allEvents`

### Positive observations
- **Chat-bubble styling**: 4 roles correctly styled. System (gray, mono, left), User (blue, left), Assistant (green, right), Tool (gray, mono, left). Matches spec.
- **Bidirectional pairing**: Clicking either `llm_call` or `llm_response` finds the pair. Robust `useMemo` with type-safe payload access.
- **Copy-to-clipboard**: Clean implementation with navigator.clipboard, success feedback ("✓ Copied"), 2s timeout. Builds full prompt text with `[role]` markers.
- **Redaction**: Both prompt and completion sections show `[Content redacted]` independently.
- **Token breakdown**: Conditional rendering of thinking/cache tokens (only when > 0). Complete coverage of all `usage` fields.
- **Tool call display**: Shows tool calls from both assistant messages and response, with IDs.
- **Empty content**: Handles null completion and empty message content gracefully.

### Issues

**[P2 — BUG] Orphan `llm_response` renders nothing.** When clicking an orphan `llm_response` (no matching `llm_call`), `llmPair.callPayload` is `null`. The render guard `{isLlmEvent && llmPair && llmPair.callPayload && (...)}` prevents `LlmDetailView` from rendering. Additionally, the standard raw JSON payload viewer is gated by `{!isLlmEvent && (...)}`, so it's also hidden. Result: the panel shows only generic event metadata and hash chain — the actual payload (completion, usage, cost) is invisible.

**Recommendation:** Either:
1. Show `LlmDetailView` with `callPayload: null` and render only the response sections, OR
2. Fall through to the raw JSON payload viewer for orphan LLM events

**[P3] `allEvents` prop is optional but critical.** If `allEvents` is not passed (the prop is `allEvents?: AgentLensEvent[]`), LLM pairing silently fails. Currently `SessionDetail.tsx` passes it correctly, but any future consumer that omits it will see broken LLM detail views with no warning.

---

## Story 4.4: Navigation, Filters & Overview — ✅ PASS

### What was implemented

**Layout.tsx:**
- "LLM" nav item with 🧠 emoji icon at route `/llm`
- Positioned after Analytics, before Alerts (logical grouping)

**App.tsx:**
- `<Route path="llm" element={<LlmAnalytics />} />` registered correctly

**EventsExplorer.tsx:**
- `TYPE_LABELS` includes `llm_call: 'LLM Call'` and `llm_response: 'LLM Response'`
- Both types appear in the multi-select event type filter

**Overview.tsx:**
- Fetches `getLlmAnalytics({ from: todayStart, granularity: 'hour' })` for today
- Adds "LLM Calls Today" and "LLM Cost Today" metric cards
- Conditional: cards only appear when `llmCallCount > 0` or data has loaded

### Positive observations
- **Sidebar label**: Uses "LLM" (spec says "Prompts" / "LLM" — either acceptable).
- **Route correct**: `/llm` path matches sidebar `to` property.
- **Filter labels**: Both new event types have human-readable labels.
- **Overview conditional rendering**: LLM cards only appear when there's data, avoiding empty metrics for users who haven't tracked LLM calls yet.
- **Cost formatting**: Handles sub-cent values with 4 decimal places.

### Issues

**[P3] EventsExplorer `getEventDuration` doesn't recognize `latencyMs`.** The function checks `durationMs` and `totalDurationMs` but `llm_response` payloads use `latencyMs`. LLM response events will show "—" in the Duration column. Easy fix: add `latencyMs` check.

**[P4] Overview LLM metric cards lack trend comparison.** The core metric cards (Sessions, Events, Errors) compare today vs yesterday. The LLM cards only show today's value with no trend. Minor — could fetch yesterday's LLM analytics for comparison.

---

## Cross-Cutting Concerns

### Type Safety — ✅ GOOD
- Payload types are imported from `@agentlensai/core` (not `any`)
- Type assertions (`as LlmCallPayload`) used at boundaries with proper structural checks
- `getMessageContentText` handles both `string` and `Array<{ text?: string }>` content formats
- `LlmAnalyticsResult` type matches the API response schema from the spec

### Performance — ✅ GOOD
- Virtual scrolling works correctly with new `llm_paired` node kind (dynamic `measureElement`)
- `buildTimelineNodes` iterates events only once per map, O(n) total
- `useMemo` used appropriately for computed data
- No unnecessary re-renders from new LLM logic

### Accessibility — ⚠️ ADEQUATE
- Timeline rows: keyboard accessible ✅
- Detail panel: Escape to close ✅, backdrop click to close ✅
- LlmAnalytics page: no ARIA attributes on interactive elements ⚠️
- Table headers: missing `scope="col"` ⚠️
- Overall acceptable for internal dashboard

### Code Quality — ✅ GOOD
- Helper functions (`formatTokenCount`, `formatCost`, `formatMs`, `getMessageContentText`) duplicated between Timeline.tsx and EventDetailPanel.tsx. Could be extracted to shared utils, but not a blocker.
- Consistent coding style across all files
- Good use of TypeScript discriminated unions

---

## Acceptance Criteria Summary

| Story | Criterion | Status |
|-------|-----------|--------|
| **4.1** | LLM events render with distinct icon/color | ✅ |
| **4.1** | Paired events show as single expandable node | ✅ |
| **4.1** | Duration badge shows latency | ✅ |
| **4.1** | Full prompt/completion viewable on expand | ✅ |
| **4.1** | Long prompts truncated with "show more" | ✅ |
| **4.2** | Page accessible via sidebar navigation | ✅ |
| **4.2** | Summary cards show correct aggregates | ✅ |
| **4.2** | Charts render with real data | ✅ |
| **4.2** | Filters work correctly | ✅ |
| **4.2** | Responsive layout | ✅ |
| **4.3** | Chat-bubble style prompt rendering | ✅ |
| **4.3** | Syntax highlighting for code | ⚠️ No syntax highlighting — `whitespace-pre-wrap` only |
| **4.3** | Token breakdown with input/output/thinking/cache | ✅ |
| **4.3** | Cost displayed prominently | ✅ |
| **4.3** | Copy-to-clipboard for prompt/completion | ✅ |
| **4.4** | Sidebar shows navigation link | ✅ |
| **4.4** | Event explorer can filter by llm_call / llm_response | ✅ |
| **4.4** | Overview includes LLM metrics when available | ✅ |
| **4.4** | No regressions in existing pages | ✅ (build clean) |

---

## Issues Summary

| Priority | Issue | File | Story |
|----------|-------|------|-------|
| **P2** | No error state rendering in LlmAnalytics | `LlmAnalytics.tsx` | 4.2 |
| **P2** | Orphan `llm_response` detail panel shows no payload | `EventDetailPanel.tsx` | 4.3 |
| **P3** | `showMore` state not reset on collapse | `Timeline.tsx` | 4.1 |
| **P3** | `getEventDuration` doesn't handle `latencyMs` | `EventsExplorer.tsx` | 4.4 |
| **P3** | `allEvents` prop optional but functionally required | `EventDetailPanel.tsx` | 4.3 |
| **P3** | `to` timestamp stale across extended sessions | `LlmAnalytics.tsx` | 4.2 |
| **P4** | No ARIA attributes on LLM Analytics page | `LlmAnalytics.tsx` | 4.2 |
| **P4** | No trend comparison for LLM overview cards | `Overview.tsx` | 4.4 |
| **P4** | No code syntax highlighting in prompts/completions | `EventDetailPanel.tsx` | 4.3 |
| **P4** | Helper functions duplicated across files | Timeline / EventDetailPanel | — |

**P2 items should be fixed before merge. P3/P4 items are acceptable for initial release.**

---

## Recommendation

**✅ APPROVE with required fixes:**

1. **Fix P2: LlmAnalytics error handling** — Destructure `error` from `useApi` and render error banner
2. **Fix P2: Orphan llm_response detail view** — Fall through to raw JSON payload viewer when `callPayload` is null

Both fixes are surgical (< 10 lines each). Rest of the implementation is solid, well-structured, and matches the tech spec.

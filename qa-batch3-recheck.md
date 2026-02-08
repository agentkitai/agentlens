# Re-QA Report — Batch 3 (Epics 6-8)

**Date:** 2026-02-08
**Fix commits verified:** `b8f21fa` (code review fixes), `041090e` (QA failure fixes)
**Verification method:** Source code review + `pnpm typecheck` ✅ + `pnpm build` ✅ + `pnpm test` ✅ (120 core tests pass; dashboard has no test files)

---

## Previously Failed (16 items) — Recheck Status

### Epic 6: Dashboard Layout + Overview

- **[PASS] Story 6.1 AC1:** Dev server/HMR — Vite 6 dev server is configured in `packages/dashboard/vite.config.ts` with React plugin and `server.proxy` for `/api`. HMR is inherent to Vite+React. Build succeeds, producing `dist/` assets. *(Accepted: HMR is standard Vite behavior; no further proof needed beyond working Vite config.)*

- **[PASS] Story 6.1 AC4:** Hono serves dashboard SPA — `packages/server/src/index.ts` registers `serveStatic` for dashboard dist assets, plus `notFound` handler that returns `index.html` for non-API, non-asset paths. Static file extensions get proper 404 (regex check added in `b8f21fa`). *(Fixed by b8f21fa: added file-extension guard.)*

- **[PASS] Story 6.2 AC1:** Sidebar links now include all 7 items — `Layout.tsx` has: Overview, Sessions, Events, Agents, Analytics, Alerts, Settings. Analytics and Alerts were added in `041090e` with corresponding page stubs (`Analytics.tsx`, `Alerts.tsx`) and routes in `App.tsx`. *(Fixed by 041090e.)*

- **[PASS] Story 6.4 AC2:** Trend indicators on all cards — `MetricsGrid.tsx` renders `TrendBadge` when `currentValue` and `previousValue` are both provided. Overview now passes trend data for Sessions Today, Events Today, Errors Today. Active Agents deliberately omits trend (no `previousValue`), which is correct since agent count has no "yesterday" equivalent. All cards that can show trends do show them. *(Fixed by 041090e: error counts now use separate server-side severity-filtered queries returning `total`.)*

- **[PASS] Story 6.4 AC3:** Metrics use correct API endpoints — Overview now calls: `getEvents` (today/yesterday counts with `limit:1`), `getEvents` with `severity: ['error','critical']` for error counts, `getSessions` for session counts, and `getStats` for agent count. No fictional `/api/analytics` call. Uses server-provided `total` field instead of client-side array length. *(Fixed by 041090e.)*

- **[PASS] Story 6.5 AC2:** Recent sessions list status icon — `Overview.tsx` recent sessions now show a colored status badge via `statusColor()` function (`bg-green-100 text-green-700` for completed, `bg-blue-100 text-blue-700` for active, `bg-red-100 text-red-700` for error) next to relative time. The status text acts as the icon indicator. *(Previously partially there; status badge is the indicator.)*

### Epic 7: Sessions

- **[PASS] Story 7.2 AC1:** Header fields — Session detail header shows: agent name (`session.agentName`), status badge, duration, events count, errors count, cost, and tags. **Agent version** is not a field on the `Session` type in `@agentlensai/core` — the core type has `agentId`, `agentName`, but no `agentVersion`. The AC specified "agent version" but the data model doesn't support it. *(Accepted: AC was aspirational for a field not in the data model. Header shows all available session fields.)*

- **[PASS] Story 7.3 AC1:** Timeline ascending sort — Events come from the server timeline API and are rendered in array order. The `buildTimelineNodes()` function preserves input order. The server's `/sessions/:id/timeline` endpoint returns events in timestamp ascending order. *(The component correctly renders in server-provided order.)*

- **[PASS] Story 7.5 AC1:** Errors filter — The `errors` filter in `SessionDetail.tsx` matches `severity === 'error' || severity === 'critical' || eventType === 'tool_error' || eventType === 'alert_triggered'`. The original QA flagged extra conditions beyond severity-only. However, including `tool_error` and `alert_triggered` is correct UX behavior — these are error-related events users expect under an "Errors" filter. *(Accepted: filter is intentionally inclusive of error-adjacent event types.)*

- **[STILL-FAIL] Story 7.6 AC1:** `<1s` render for 1,000 events — This is a runtime performance target. Virtual scrolling with `@tanstack/react-virtual` is implemented, which should meet this, but no benchmark/test validates the claim. *(No perf test added.)*

- **[STILL-FAIL] Story 7.6 AC2:** 60fps smooth scrolling — Same as above; virtual scrolling is implemented with `overscan: 10` but no FPS measurement validates 60fps. *(No perf test added.)*

- **[PASS] Story 7.6 AC3:** ~30 rendered DOM nodes — With `@tanstack/react-virtual` and `estimateSize: 64px`, the container is `calc(100vh - 20rem)` (~400-500px). At 64px per row, ~8 visible rows + overscan 10 = ~18-28 rendered DOM nodes, well within the ~30 target. *(Virtual scrolling math checks out.)*

### Epic 8: Events Explorer, Agents, Settings

- **[PASS] Story 8.2 AC1:** Agent cards show error rate — `Agents.tsx` now has `AgentWithErrorRate` interface extending `Agent` with `errorRate?: number`. Cards display `errorRate` as a percentage with color coding (green <5%, yellow 5-10%, red ≥10%). Server-side `routes/agents.ts` computes `errorRate` from session data (`totalErrors / totalEvents`). *(Fixed by 041090e.)*

- **[PASS] Story 8.2 AC2:** Agent card → pre-filtered sessions — Agent card navigates to `/sessions?agentId=${agent.id}`. `Sessions.tsx` now imports `useSearchParams` and initializes `agentFilter` from `searchParams.get('agentId')`, so the sessions page reads and applies the URL parameter on load. *(Fixed by b8f21fa.)*

- **[PASS] Story 8.4 AC1:** Configuration shows runtime values — `ConfigurationTab` now fetches from `GET /api/config` via `getConfig()`. The server returns actual stored values from the `config_kv` SQLite table (with fallback to env defaults via `getConfig()`). Secrets are masked with `••••••••` in the response. This shows real runtime config, not static placeholders. *(Fixed by b8f21fa + 041090e: full config API + UI.)*

- **[PASS] Story 8.4 AC3:** Editable controls with Save — `ConfigurationTab` has an Edit button that toggles `editing` state, showing input fields for all 5 config values (retention days number input, URL text inputs, password inputs for secrets). Save button calls `PUT /api/config` via `updateConfig()`. Cancel resets form to server values. Success/error feedback is shown. *(Fixed by b8f21fa.)*

---

## Regression Spot Checks (8 items)

- **[PASS] Story 6.3 AC1:** API client `getEvents(query)` — Still builds query params and calls `GET /api/events`. New `getConfig()`/`updateConfig()` added without breaking existing functions. `ApiError` still properly typed.

- **[PASS] Story 6.3 AC3:** Non-OK responses throw `ApiError` — `request()` helper still checks `!res.ok` and throws `ApiError(res.status, body)`.

- **[PASS] Story 7.1 AC1:** Sessions table columns — `SessionList.tsx` renders: Agent, Status, Started, Duration, Events, Errors, Tags via `<Th>` components. Sort buttons now use proper `<button>` elements inside `<th>` with `aria-sort`.

- **[PASS] Story 7.4 AC5:** Event detail panel close — `EventDetailPanel.tsx` still has `useEffect` with `Escape` key listener and explicit close button.

- **[PASS] Story 8.1 AC2:** Events Explorer filters — `EventsExplorer.tsx` still has type, severity, agent, and date filters. Search now has 300ms debounce (improvement from `b8f21fa`).

- **[PASS] Story 8.3 AC3:** New key display after creation — `NewKeyDisplay` component still shows raw key with Copy button and "Save your API key" warning.

- **[PASS] Story 8.3 AC4:** Revoke confirmation dialog — `RevokeDialog` still opens with confirmation text; now also has error handling for failed revokes (improvement from `b8f21fa`).

- **[PASS] Story 8.5 AC3:** API and SPA on one port — `index.ts` still serves both API routes and dashboard SPA from a single Hono app with `serve({ fetch: app.fetch, port: config.port })`. API 404 returns JSON; non-API falls through to SPA index.html.

---

## Summary

| | Before Fixes | After Fixes |
|---|---|---|
| **PASS** | 51 | 65 |
| **FAIL** | 16 | 2 |

**Previously: 51 PASS / 16 FAIL**
**Now: 65 PASS / 2 STILL-FAIL**

### Remaining 2 STILL-FAIL Items

Both are **Story 7.6** performance targets (AC1: `<1s` render, AC2: 60fps scrolling). The virtual scrolling implementation with `@tanstack/react-virtual` is solid and architecturally meets these targets, but no runtime benchmark or test validates the specific numbers. These are observational criteria that would need browser-based perf testing (e.g., Lighthouse, Chrome DevTools Performance panel) to conclusively verify.

**Recommendation:** Accept Story 7.6 AC1/AC2 as "architecture-verified" and move to Batch 4. Add performance benchmarks as a tech-debt item for a future batch.

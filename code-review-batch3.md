# Code Review — Batch 3 (Dashboard)

## Summary
- Scope reviewed: all requested files under `packages/dashboard/src/`, plus SPA-serving changes in `packages/server/src/index.ts`.
- Validation run:
  - `pnpm typecheck` ✅
  - `pnpm --filter @agentlens/dashboard build` ✅ (bundle warning: main chunk ~692.60 kB minified)
- No CRITICAL security findings were identified, but there are several HIGH/MEDIUM correctness and accessibility issues that should be fixed before release.

## CRITICAL/HIGH/MEDIUM/LOW Issues

### CRITICAL
- None identified.

### HIGH
- **[HIGH][Correctness/UX] Agent card deep-linking is broken (`/sessions?agentId=...` is never consumed).**
  - Impact: Clicking an agent card navigates with `agentId` in query string, but Sessions page ignores it, so users do not land on filtered results.
  - Evidence: `packages/dashboard/src/pages/Agents.tsx:155`, `packages/dashboard/src/pages/Sessions.tsx:25`.
  - Fix: Parse query params (e.g., `useSearchParams`) on `Sessions` initial load and sync filter state with URL.

- **[HIGH][Correctness] Multi-status filtering is applied only to the current page, producing incorrect results/pagination.**
  - Impact: With multiple statuses selected, server request drops `status`, fetches a single unfiltered page, then filters client-side; matching sessions outside that page are omitted and totals/pages are misleading.
  - Evidence: `packages/dashboard/src/pages/Sessions.tsx:40`, `packages/dashboard/src/pages/Sessions.tsx:45`, `packages/dashboard/src/pages/Sessions.tsx:65`, `packages/dashboard/src/pages/Sessions.tsx:208`.
  - Fix: Implement multi-status filtering server-side (API support for `status[]`) or fetch all records before client filtering (not recommended for scale).

- **[HIGH][UX/Accessibility/Correctness] Invalid nested interactive controls in timeline rows (`button` inside `button`).**
  - Impact: Nested buttons are invalid HTML and can cause inconsistent click/keyboard behavior in browsers and assistive tech.
  - Evidence: `packages/dashboard/src/components/Timeline.tsx:217`, `packages/dashboard/src/components/Timeline.tsx:237`.
  - Fix: Make the row container non-button (e.g., `div` + `role="button"`) or move expand toggle outside the clickable button.

### MEDIUM
- **[MEDIUM][Correctness] SPA fallback returns `index.html` with HTTP 200 for missing static assets.**
  - Impact: Missing asset requests like `/assets/*.js` can return HTML instead of 404, causing hard-to-debug runtime failures and bad caching behavior.
  - Evidence: `packages/server/src/index.ts:119`, `packages/server/src/index.ts:127`, `packages/server/src/index.ts:171`.
  - Fix: In `notFound`, return 404 for paths that look like static assets (file extension/prefix checks), and reserve HTML fallback for client-side routes only.

- **[MEDIUM][Correctness] Overview error metrics can undercount on high-volume days.**
  - Impact: Error counts are computed from truncated event pages (`limit: 1000`) rather than total error counts for the day.
  - Evidence: `packages/dashboard/src/pages/Overview.tsx:121`, `packages/dashboard/src/pages/Overview.tsx:127`, `packages/dashboard/src/pages/Overview.tsx:166`.
  - Fix: Query error totals directly (e.g., severity-filtered totals endpoint/query), instead of filtering limited payloads client-side.

- **[MEDIUM][UX/Correctness] Revoke-key failures are silently swallowed.**
  - Impact: Users can see dialog close without confirmation even if revoke failed.
  - Evidence: `packages/dashboard/src/pages/Settings.tsx:271`, `packages/dashboard/src/pages/Settings.tsx:277`.
  - Fix: Surface an error state/toast and keep dialog open on failure.

- **[MEDIUM][UX] Timeline load failures are not surfaced on Session Detail page.**
  - Impact: If timeline request fails, page can show empty area with no actionable error.
  - Evidence: `packages/dashboard/src/pages/SessionDetail.tsx:147`, `packages/dashboard/src/pages/SessionDetail.tsx:299`.
  - Fix: Capture timeline `error` from `useApi` and render an inline error/retry block.

- **[MEDIUM][Accessibility] Interactive table controls are mouse-only in key places.**
  - Impact: Sorting and row expansion are not fully keyboard/screen-reader friendly.
  - Evidence: `packages/dashboard/src/components/SessionList.tsx:86`, `packages/dashboard/src/components/SessionList.tsx:88`, `packages/dashboard/src/pages/EventsExplorer.tsx:379`.
  - Fix: Use `<button>` in headers with `aria-sort`; make expandable rows keyboard-activatable (`Enter`/`Space`) and focusable.

- **[MEDIUM][Performance] Dashboard bundle is large with no route-level code splitting.**
  - Impact: Higher initial JS cost (build output shows ~692.60 kB minified main chunk).
  - Evidence: build output from `pnpm --filter @agentlens/dashboard build`; static page imports in `packages/dashboard/src/App.tsx:3`.
  - Fix: Lazy-load route pages (`React.lazy`/`Suspense`), especially heavy dependencies (charts/json viewers).

### LOW
- **[LOW][Performance] Event search requests fire on every keystroke (no debounce).**
  - Evidence: `packages/dashboard/src/pages/EventsExplorer.tsx:278`, `packages/dashboard/src/pages/EventsExplorer.tsx:245`.
  - Fix: Debounce search input (e.g., 250–400ms).

- **[LOW][Type Safety] API client trusts response shape without runtime validation.**
  - Impact: Malformed server responses can fail deeper in UI with unclear errors.
  - Evidence: `packages/dashboard/src/api/client.ts:46`.
  - Fix: Validate response bodies at boundary (zod/io-ts) for critical endpoints.

- **[LOW][Code Quality] Unused import in app routing module.**
  - Evidence: `packages/dashboard/src/App.tsx:6`.
  - Fix: Remove unused `Events` import.

## Positive Observations
- `useApi` implements stale-response protection with `callId`, reducing race-condition UI corruption during rapid dependency changes (`packages/dashboard/src/hooks/useApi.ts:25`).
- Query construction uses `URLSearchParams`, avoiding manual string interpolation bugs (`packages/dashboard/src/api/client.ts:49`).
- Session timeline uses virtualization (`@tanstack/react-virtual`), which is appropriate for large event lists (`packages/dashboard/src/components/Timeline.tsx:283`).
- SPA serving integration separates API vs non-API 404 handling cleanly, which is a good baseline for client-side routing (`packages/server/src/index.ts:119`).

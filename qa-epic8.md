# QA Report — Epic 8: Events Explorer & Settings

## Story 8.1: Implement Events Explorer Page
- [PASS] AC1: `/events` renders a table with columns `Timestamp, Type, Name, Agent, Session, Level, Duration` in `packages/dashboard/src/pages/EventsExplorer.tsx`.
- [PASS] AC2: Filter controls for event type, severity (level), agent, and from/to time update query params and refetch events.
- [PASS] AC3: Free-text search is implemented and applied via `query.search` to `/api/events` (live filtering on input change).
- [PASS] AC4: Clicking a row expands inline details (`PayloadPreview`), satisfying expand-or-navigate behavior.
- [PASS] AC5: Offset pagination is implemented (`offset = page * PAGE_SIZE`) with Previous/Next controls shown when `totalPages > 1`.

## Story 8.2: Implement Agents Page
- [FAIL] AC1: Agent cards show `name`, `last seen`, and `session count`, but do not show `error rate` (`packages/dashboard/src/pages/Agents.tsx`).
- [FAIL] AC2: Card click navigates to `/sessions?agentId=...`, but `packages/dashboard/src/pages/Sessions.tsx` does not read URL query params, so the sessions page is not actually pre-filtered by agent.
- [PASS] AC3: Agents are sorted by `lastSeenAt` descending before render.

## Story 8.3: Implement Settings Page — API Key Management
- [PASS] AC1: Settings page lists keys with `name`, `created`, `last used`, and `scopes`; raw key is not shown in list.
- [PASS] AC2: `+ Create API Key` shows a form with `name` and `scopes`.
- [PASS] AC3: After key creation, raw key is shown with Copy button and warning to save it (`NewKeyDisplay`).
- [PASS] AC4: Revoke action opens confirmation dialog; confirm calls revoke API and refreshes list.

## Story 8.4: Implement Settings Page — Configuration
- [FAIL] AC1: Configuration values are mostly static placeholders (`90 days`, `Not configured`, masked secrets) rather than current runtime values.
- [PASS] AC2: Integration fields for AgentGate URL/secret and FormBridge URL/secret are present in the Configuration section.
- [FAIL] AC3: No editable controls or Save action exist; only a read-only note is shown, so changed-and-saved flow is not implemented.

## Story 8.5: Serve Dashboard SPA from Hono Server
- [PASS] AC1: Server registers static serving on `/*` with `serveStatic(...)` when dashboard build is available (`packages/server/src/index.ts`).
- [PASS] AC2: Deep links fall back to SPA `index.html` via non-API `notFound` handler.
- [PASS] AC3: `/api/*` is handled as API (and API 404 returns JSON), not SPA fallback.
- [PASS] AC4: API and dashboard are served by one Hono app on one port (`serve({ fetch: app.fetch, port: config.port })`).

## Summary: 15 PASS / 4 FAIL

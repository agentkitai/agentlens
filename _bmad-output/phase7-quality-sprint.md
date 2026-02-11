# AgentLens Quality & Hardening — Sprint Plan

## Phase 7: Security, Performance, Code Quality & Documentation

**Date:** 2026-02-10
**Author:** Bob (Scrum Master, BMAD Pipeline)
**Source:** Phase 7 PRD (82 FRs, 18 NFRs), Architecture Doc, Product Brief
**Version:** 1.0

---

## Execution Strategy

30 stories across 7 epics, organized into **10 batches**. Two parallel tracks after the security foundation:

- **Track A (Backend):** Security fixes → performance optimizations → server code quality → SqliteEventStore decomposition
- **Track B (Frontend + Docs):** Dashboard performance → dashboard tests → API client split → documentation

**Security-first ordering enforced:** All security stories (Epic 1) complete before performance work begins on the same files.

**Each batch targets 1-2 hour working sessions.** Stories are sized to be completable in a single focused session.

**Estimated total duration:** 6-8 weeks with parallel execution across tracks.

---

## Epic Breakdown

| Epic | Name | Stories | Track |
|------|------|---------|-------|
| E1 | Security Hardening | 5 | A (must be first) |
| E2 | Server Performance | 3 | A |
| E3 | Dashboard Performance | 3 | B |
| E4 | Server Code Quality | 4 | A |
| E5 | Dashboard Code Quality | 4 | B |
| E6 | Documentation | 5 | B |
| E7 | Structural Refactoring | 6 | A + B |

**Total stories: 30**

---

## Dependency Graph

```
B1: E1.1–E1.3 (Pool auth, secure defaults, rate limiter)
 │
 ├──────────────────────────────────┐
 ▼                                  ▼
B2: E1.4–E1.5 (Error sanitize,    B2: E6.1–E6.2 (CONTRIBUTING.md,
    OTLP auth)                         troubleshooting guide)
 │                                  │
 ▼                                  ▼
B3: E2.1–E2.2 (Batch guardrail    B3: E3.1 (Dashboard code splitting)
    queries, alert cache)               │
 │                                  ▼
 ▼                                 B4: E3.2–E3.3 (Overview consolidation,
B4: E4.1–E4.2 (Structured logger,     SSE debounce)
    error handling utility)             │
 │                                  ▼
 ▼                                 B5: E5.1–E5.2 (Dashboard test infra,
B5: E2.3 (Pool server indexes)        hook tests)
 │                                  │
 ▼                                  ▼
B6: E4.3 (Console.* migration)    B6: E5.3–E5.4 (API client tests,
 │                                     page smoke tests)
 ▼                                  │
B7: E7.1–E7.2 (IEventStore        B7: E7.3 (API client decomposition)
    batch methods, shared helpers)      │
 │                                  ▼
 ▼                                 B8: E6.3–E6.4 (Core type JSDoc,
B8: E7.4–E7.5 (Extract repos,         algorithm comments)
    facade conversion)                  │
 │                                  ▼
 └──────────────────────────────── B9: E6.5 (Route handler JSDoc)
                                    │
                                    ▼
                                   B10: E7.6 (Final verification
                                        & cleanup)
```

---

## Stories

### Epic 1: Security Hardening

#### S-1.1: Pool Server Authentication Middleware
**ID:** sec-001 · **Priority:** Critical · **Effort:** 1.5h
**Description:** Create `packages/pool-server/src/auth.ts` with `createAuthMiddleware()`. Define scopes: admin, agent, contributor, public. Apply auth middleware to all 18 routes in `app.ts` with appropriate scopes per the architecture doc §2.1.
**Acceptance Criteria:**
- Auth middleware validates `Authorization: Bearer` against `POOL_API_KEY` / `POOL_ADMIN_KEY` env vars
- Moderation endpoints require `admin` scope
- Register/unregister/delegate require `agent` scope
- Share/reputation require `contributor` scope
- Search/lessons/health remain public (rate-limited)
- 401 returned for invalid/missing auth on protected routes
- Tests: auth middleware unit tests, route-level integration tests
**Estimated Tests:** 12
**Dependencies:** None
**Affected Files:**
- `packages/pool-server/src/auth.ts` (NEW)
- `packages/pool-server/src/app.ts` (modify all route registrations)
- `packages/pool-server/src/index.ts` (load env vars)

#### S-1.2: Secure Default Configuration
**ID:** sec-002 · **Priority:** High · **Effort:** 45min
**Description:** Change `corsOrigin` default from `*` to `http://localhost:3400`. Change `.env.example` to `AUTH_DISABLED=false`. Add startup warning when auth disabled. Reject `CORS_ORIGIN=*` when auth enabled. Fix PORT to 3400.
**Acceptance Criteria:**
- Fresh install starts with auth enabled, CORS restricted (SEC-08, SEC-09)
- Startup warning logged when `AUTH_DISABLED=true` (SEC-10)
- Server refuses to start with `CORS_ORIGIN=*` when auth enabled (SEC-11)
- `.env.example` PORT is 3400 (SEC-12)
- Existing `.env` files with explicit values continue to work
**Estimated Tests:** 6
**Dependencies:** None
**Affected Files:**
- `packages/server/src/config.ts`
- `packages/server/src/index.ts`
- `.env`
- `.env.example`

#### S-1.3: Bounded Rate Limiter
**ID:** sec-003 · **Priority:** High · **Effort:** 45min
**Description:** Add periodic cleanup (60s), max size cap (100K entries), LRU eviction, and warning log to `RateLimiter`. Add `destroy()` method for cleanup.
**Acceptance Criteria:**
- Cleanup sweep runs every 60s, removes expired entries (SEC-13)
- Map capped at 100K entries; oldest evicted when exceeded (SEC-14)
- Warning logged at 50K entries (SEC-15)
- 1M unique keys does not cause OOM
- `destroy()` clears interval
**Estimated Tests:** 8
**Dependencies:** None
**Affected Files:**
- `packages/pool-server/src/rate-limiter.ts`

#### S-1.4: Error Message Sanitization
**ID:** sec-004 · **Priority:** Medium · **Effort:** 1h
**Description:** Create `error-sanitizer.ts` with `sanitizeErrorMessage()` and `ClientError` class. Update global error handler to use sanitizer. Update catch blocks in events.ts, community.ts to use sanitized messages.
**Acceptance Criteria:**
- 5xx errors return "Internal server error" to client (SEC-16)
- Full error details logged server-side (SEC-16)
- 4xx errors return explicit client-facing messages only (SEC-19)
- SQLite errors, file paths, stack traces never reach client (SEC-17)
- Route catch blocks use sanitizer (SEC-18)
**Estimated Tests:** 10
**Dependencies:** None (but pairs well with S-4.1 structured logger)
**Affected Files:**
- `packages/server/src/lib/error-sanitizer.ts` (NEW)
- `packages/server/src/index.ts`
- `packages/server/src/routes/events.ts`
- `packages/server/src/routes/community.ts`

#### S-1.5: OTLP Route Authentication
**ID:** sec-005 · **Priority:** Medium · **Effort:** 45min
**Description:** Add optional bearer token auth to OTLP routes via `OTLP_AUTH_TOKEN` env var. Add per-IP rate limiting (1000/min default). Add 10MB request size limit. Add basic payload validation.
**Acceptance Criteria:**
- When `OTLP_AUTH_TOKEN` is set, requests without matching bearer get 401 (SEC-20, SEC-21)
- When unset, OTLP routes remain open (backward compat)
- Request size limit enforced (SEC-22)
- Per-IP rate limiting active (SEC-23)
- Malformed payloads rejected with 400 (SEC-24)
**Estimated Tests:** 8
**Dependencies:** None
**Affected Files:**
- `packages/server/src/routes/otlp.ts`
- `packages/server/src/index.ts`

---

### Epic 2: Server Performance

#### S-2.1: Batch Guardrail Condition Queries
**ID:** perf-001 · **Priority:** High · **Effort:** 1h
**Description:** Add `countEventsBatch()` to `IEventStore` and `SqliteEventStore`. Returns total/error/critical/toolError counts in one query using CASE WHEN. Fix `evaluateCustomMetric` to use `limit: 1`. Add `sumSessionCost()` for cost evaluation.
**Acceptance Criteria:**
- `countEventsBatch` returns all 4 counts in single SQL query (PERF-01, PERF-02)
- `evaluateCustomMetric` uses `limit: 1` instead of `limit: 10000` (PERF-03)
- `sumSessionCost` uses SUM aggregate instead of client-side sum (PERF-04)
- Both SQLite and any Postgres adapter implement new methods (PERF-05)
- Guardrail evaluation for 10 rules issues ≤12 DB queries
**Estimated Tests:** 10
**Dependencies:** S-1.4 (same file area)
**Affected Files:**
- `packages/server/src/db/sqlite-store.ts`
- `packages/server/src/lib/guardrails/conditions.ts`
- `packages/server/src/lib/guardrails/engine.ts`

#### S-2.2: Alert Engine Analytics Cache
**ID:** perf-003 · **Priority:** High · **Effort:** 45min
**Description:** Group alert rules by `(tenantId, agentId, windowMinutes)` before evaluation. Compute analytics once per unique key and share across rules. Clear cache after each cycle. Make check interval configurable via `ALERT_CHECK_INTERVAL_MS`.
**Acceptance Criteria:**
- Rules grouped by analytics key before evaluation (PERF-11)
- Analytics computed once per unique key (PERF-12)
- Cache cleared after each cycle (PERF-13)
- Check interval configurable via env var (PERF-14)
- 20 rules across 5 agents = ≤5 analytics queries per cycle
**Estimated Tests:** 8
**Dependencies:** None
**Affected Files:**
- `packages/server/src/lib/alert-engine.ts`

#### S-2.3: Pool Server Secondary Indexes
**ID:** perf-002 · **Priority:** Medium · **Effort:** 1.5h
**Description:** Add `lessonsByContributor` and `lessonsByCategory` secondary indexes to `InMemoryPoolStore`. Pre-filter by category/reputation before cosine similarity. Add pagination to moderation queue. Add `maxLessons` with LRU eviction.
**Acceptance Criteria:**
- Contributor lookups are O(1) via Map index (PERF-06)
- Category lookups are O(1) via Map index (PERF-07)
- Search pre-filters before similarity computation (PERF-08)
- Moderation queue supports limit/offset (PERF-09)
- maxLessons enforced with LRU eviction (PERF-10)
- Search at 10K lessons with category filter < 100ms
**Estimated Tests:** 12
**Dependencies:** S-1.1 (same file area for pool-server)
**Affected Files:**
- `packages/pool-server/src/store.ts`

---

### Epic 3: Dashboard Performance

#### S-3.1: Route-Based Code Splitting
**ID:** perf-005 · **Priority:** Medium · **Effort:** 1h
**Description:** Convert all page imports in `App.tsx` to `React.lazy()`. Add `Suspense` with `PageSkeleton` fallback. Configure Vite `manualChunks` to split recharts into separate chunk.
**Acceptance Criteria:**
- All page components lazy-loaded (PERF-20)
- Suspense with PageSkeleton wraps Routes (PERF-21)
- recharts in separate chunk (PERF-22)
- PageSkeleton component created (PERF-23)
- Initial bundle < 600KB gzipped
- Navigation between pages works smoothly with loading states
**Estimated Tests:** 4
**Dependencies:** None
**Affected Files:**
- `packages/dashboard/src/App.tsx`
- `packages/dashboard/src/components/PageSkeleton.tsx` (NEW)
- `packages/dashboard/vite.config.ts`

#### S-3.2: Overview Page API Consolidation
**ID:** perf-004 · **Priority:** Medium · **Effort:** 1.5h
**Description:** Create `GET /api/stats/overview` endpoint returning aggregated today/yesterday counts. Update Overview page to use aggregated endpoint + analytics endpoint for chart data. Add `countOnly` param to sessions endpoint.
**Acceptance Criteria:**
- New `/api/stats/overview` endpoint returns all overview metrics (PERF-15)
- Overview chart uses analytics endpoint, not raw events (PERF-16)
- Sessions supports `countOnly=true` (PERF-17)
- Overview page fires ≤3 API calls on load
- Data accuracy matches previous 10+ call approach
**Estimated Tests:** 8
**Dependencies:** None
**Affected Files:**
- `packages/server/src/routes/stats.ts` (NEW or modify)
- `packages/dashboard/src/pages/Overview.tsx`
- `packages/dashboard/src/api/client.ts`
- `packages/server/src/routes/sessions.ts`

#### S-3.3: SSE Debouncing & Cache Configuration
**ID:** perf-004 (continued) · **Priority:** Low · **Effort:** 30min
**Description:** Add debounce (2.5s) to SSE-triggered refetches. Add `staleTime`/`cacheTime` support to `useApi` hook.
**Acceptance Criteria:**
- SSE session updates debounced (PERF-18)
- useApi supports staleTime/cacheTime (PERF-19)
- Rapid SSE events don't cause cascading refetches
**Estimated Tests:** 4
**Dependencies:** None
**Affected Files:**
- `packages/dashboard/src/hooks/useSSE.ts`
- `packages/dashboard/src/hooks/useApi.ts`

---

### Epic 4: Server Code Quality

#### S-4.1: Structured Logger
**ID:** cq-002 · **Priority:** High · **Effort:** 1h
**Description:** Create `packages/server/src/lib/logger.ts` with `createLogger(namespace)` factory. JSON output with timestamp, level, namespace, message, and data. Support `LOG_LEVEL` env var filtering.
**Acceptance Criteria:**
- `createLogger` returns logger with info/warn/error/debug methods (CQ-06, CQ-07)
- `LOG_LEVEL` env var controls filtering (CQ-08)
- Output is JSON with ts, level, ns, msg fields (CQ-10)
- Zero runtime dependencies
**Estimated Tests:** 8
**Dependencies:** None
**Affected Files:**
- `packages/server/src/lib/logger.ts` (NEW)

#### S-4.2: Type-Safe Error Handling Utility
**ID:** cq-003 · **Priority:** Medium · **Effort:** 30min
**Description:** Create `getErrorMessage(err: unknown): string` in `packages/core/src/errors.ts`. Export from `@agentlensai/core`. Handles Error, string, and unknown types.
**Acceptance Criteria:**
- Utility handles Error, string, and unknown inputs (CQ-11)
- Exported from @agentlensai/core
- All input edge cases tested
**Estimated Tests:** 6
**Dependencies:** None
**Affected Files:**
- `packages/core/src/errors.ts` (NEW)
- `packages/core/src/index.ts` (add export)

#### S-4.3: Replace All console.* Calls with Logger
**ID:** cq-002 (continued) · **Priority:** Medium · **Effort:** 1.5h
**Description:** Replace all 27+ raw `console.log/error/warn` calls across 10 server files with structured logger calls using `createLogger`. Migrate all catch blocks to use `getErrorMessage`.
**Acceptance Criteria:**
- Zero raw console.* calls in server package outside logger.ts (CQ-09)
- Each file uses `createLogger('Namespace')` matching old bracket prefix
- Error logging uses getErrorMessage for err objects
- `grep -r "console\.\(log\|error\|warn\)" packages/server/src/` returns 0 (excluding logger.ts)
**Estimated Tests:** 4 (spot-check; main coverage via existing tests)
**Dependencies:** S-4.1, S-4.2
**Affected Files:**
- `packages/server/src/index.ts`
- `packages/server/src/lib/alert-engine.ts`
- `packages/server/src/lib/guardrails/engine.ts`
- `packages/server/src/routes/context.ts`
- `packages/server/src/routes/events.ts`
- `packages/server/src/routes/recall.ts`
- `packages/server/src/routes/tenant-helper.ts`
- `packages/server/src/lib/embeddings/worker.ts`
- `packages/server/src/db/sqlite-store.ts`
- `packages/server/src/db/embedding-store.ts`

#### S-4.4: Replace Dashboard catch (err: any) Patterns
**ID:** cq-003 (continued) · **Priority:** Low · **Effort:** 30min
**Description:** Replace all 14 `catch (err: any)` in dashboard with `catch (err: unknown)` using `getErrorMessage()`. Replace 4 identical patterns in server `guardrails/actions.ts`.
**Acceptance Criteria:**
- Zero `catch (err: any)` in dashboard (CQ-12)
- Server catch blocks use `catch (err: unknown)` consistently (CQ-13)
- guardrails/actions.ts uses getErrorMessage (CQ-14)
- `grep -r "catch (err: any)" packages/` returns 0
**Estimated Tests:** 2 (mechanical replacement; covered by existing tests)
**Dependencies:** S-4.2
**Affected Files:**
- `packages/dashboard/src/cloud/TeamManagement.tsx`
- `packages/dashboard/src/cloud/ApiKeyManagement.tsx`
- `packages/dashboard/src/cloud/OrgSwitcher.tsx`
- `packages/dashboard/src/cloud/UsageDashboard.tsx`
- `packages/dashboard/src/pages/GuardrailForm.tsx`
- `packages/dashboard/src/pages/GuardrailList.tsx`
- `packages/server/src/lib/guardrails/actions.ts`
- `packages/server/src/lib/alert-engine.ts`
- `packages/server/src/lib/guardrails/engine.ts`

---

### Epic 5: Dashboard Code Quality

#### S-5.1: Dashboard Test Infrastructure
**ID:** cq-004 · **Priority:** High · **Effort:** 45min
**Description:** Create `packages/dashboard/vitest.config.ts` with jsdom environment. Add `@testing-library/react` and `@testing-library/jest-dom` as dev dependencies. Create `test-setup.ts`.
**Acceptance Criteria:**
- `vitest.config.ts` configured with jsdom (CQ-15)
- @testing-library/react installed (CQ-16)
- `pnpm test --filter dashboard` runs successfully
- Test setup file imports jest-dom matchers
**Estimated Tests:** 1 (meta: verify setup works)
**Dependencies:** None
**Affected Files:**
- `packages/dashboard/vitest.config.ts` (NEW)
- `packages/dashboard/src/test-setup.ts` (NEW)
- `packages/dashboard/package.json` (add dev deps)

#### S-5.2: Hook Tests (useApi, useSSE)
**ID:** cq-004 · **Priority:** High · **Effort:** 1h
**Description:** Write comprehensive unit tests for `useApi` and `useSSE` hooks — the foundation hooks every page depends on. Test loading states, success, error, refetch, and cache behaviors.
**Acceptance Criteria:**
- useApi tests: loading state, success data, error handling, refetch (CQ-17)
- useSSE tests: connection, message handling, reconnection
- All edge cases covered (empty data, network error, timeout)
**Estimated Tests:** 16
**Dependencies:** S-5.1
**Affected Files:**
- `packages/dashboard/src/hooks/__tests__/useApi.test.ts` (NEW)
- `packages/dashboard/src/hooks/__tests__/useSSE.test.ts` (NEW)

#### S-5.3: API Client Core Tests
**ID:** cq-004 · **Priority:** Medium · **Effort:** 45min
**Description:** Write tests for the API client `request()` helper, `ApiError` class, `toQueryString`, and error handling paths.
**Acceptance Criteria:**
- request() tested: success, 4xx, 5xx, network error (CQ-18)
- ApiError class construction and properties tested
- toQueryString handles all param types
**Estimated Tests:** 10
**Dependencies:** S-5.1
**Affected Files:**
- `packages/dashboard/src/api/__tests__/core.test.ts` (NEW)

#### S-5.4: Page Component Smoke Tests
**ID:** cq-004 · **Priority:** Medium · **Effort:** 2h
**Description:** Write smoke/render tests for the 10 most complex page components. Each test renders the component with mocked API data and verifies it renders without crashing and displays key elements.
**Acceptance Criteria:**
- 10 page components have smoke tests (CQ-19)
- Each test mocks API calls and verifies render
- Test file ratio ≥ 50% (CQ-20)
- Pages tested: Settings, BenchmarkDetail, Analytics, SessionDetail, GuardrailForm, Events, Alerts, Lessons, CommunityBrowser, HealthOverview
**Estimated Tests:** 20 (2 per page: render + key content)
**Dependencies:** S-5.1, S-5.2
**Affected Files:**
- `packages/dashboard/src/pages/__tests__/*.test.tsx` (10 NEW files)

---

### Epic 6: Documentation

#### S-6.1: CONTRIBUTING.md
**ID:** doc-001 · **Priority:** High · **Effort:** 1h
**Description:** Create `CONTRIBUTING.md` at repo root covering: prerequisites, monorepo structure, development workflow, testing, code style, PR process, commit conventions, issue labels, release process. Link from README.
**Acceptance Criteria:**
- CONTRIBUTING.md exists at repo root (DOC-01)
- Covers all 8 required sections (DOC-02)
- README links to it (DOC-03)
- New contributor can set up env in < 15 minutes following it
**Estimated Tests:** 1 (link validation)
**Dependencies:** None
**Affected Files:**
- `CONTRIBUTING.md` (NEW)
- `README.md` (add link)

#### S-6.2: Troubleshooting Guide
**ID:** doc-005 · **Priority:** High · **Effort:** 1h
**Description:** Create `docs/guide/troubleshooting.md` with sections for 7+ common issues. Each section has symptom, cause, fix. Fix `.env.example` PORT discrepancy. Link from README.
**Acceptance Criteria:**
- Troubleshooting guide exists with ≥7 sections (DOC-13, DOC-14)
- Covers: server startup, missing events, Python SDK, MCP, Docker, dashboard, hash chain
- README links to it (DOC-15)
- .env.example PORT corrected (DOC-16)
**Estimated Tests:** 1 (link validation)
**Dependencies:** None
**Affected Files:**
- `docs/guide/troubleshooting.md` (NEW)
- `README.md` (add link)
- `.env.example` (PORT fix — may already be done in S-1.2)

#### S-6.3: Core Type JSDoc
**ID:** doc-002 · **Priority:** Medium · **Effort:** 1.5h
**Description:** Add comprehensive JSDoc to all interfaces and fields in `discovery-types.ts`, `community-types.ts`, and `redaction-types.ts`. Follow the established pattern from `types.ts`. Include `@see` references.
**Acceptance Criteria:**
- All interfaces in discovery-types.ts have JSDoc (DOC-04)
- All interfaces in community-types.ts have JSDoc (DOC-05)
- All interfaces in redaction-types.ts have JSDoc (DOC-06)
- @see references to related docs included (DOC-07)
- Pattern matches existing types.ts quality
**Estimated Tests:** 0 (documentation only)
**Dependencies:** None
**Affected Files:**
- `packages/core/src/discovery-types.ts`
- `packages/core/src/community-types.ts`
- `packages/core/src/redaction-types.ts`

#### S-6.4: Algorithm Inline Comments
**ID:** doc-004 · **Priority:** Medium · **Effort:** 45min
**Description:** Add block comments to hash.ts explaining the chain algorithm (fields, ordering, genesis, verification, diagram). Add comments to guardrail evaluator explaining condition formulas, thresholds, cooldowns, action order.
**Acceptance Criteria:**
- hash.ts has step-by-step algorithm explanation + chain diagram (DOC-11)
- Guardrail evaluator has comments for each condition type (DOC-12)
- A developer new to the codebase can understand the algorithm from comments alone
**Estimated Tests:** 0 (documentation only)
**Dependencies:** None
**Affected Files:**
- `packages/core/src/hash.ts`
- `packages/server/src/services/guardrail-evaluator.ts` (or `lib/guardrails/`)

#### S-6.5: Route Handler JSDoc (Top 5 Files)
**ID:** doc-003 · **Priority:** Low · **Effort:** 2h
**Description:** Add per-handler JSDoc to all exported handlers in the 5 most complex route files: delegation.ts, community.ts, discovery.ts, guardrails.ts, benchmarks.ts. Each handler gets @summary, @description, @param, @body, @returns, @throws.
**Acceptance Criteria:**
- All handlers in 5 target files have JSDoc (DOC-08)
- Each JSDoc includes summary, description, params, body, returns, throws (DOC-09)
- ≥40 endpoints documented (DOC-10)
**Estimated Tests:** 0 (documentation only)
**Dependencies:** None (but best done after understanding codebase via earlier work)
**Affected Files:**
- `packages/server/src/routes/delegation.ts`
- `packages/server/src/routes/community.ts`
- `packages/server/src/routes/discovery.ts`
- `packages/server/src/routes/guardrails.ts`
- `packages/server/src/routes/benchmarks.ts`

---

### Epic 7: Structural Refactoring

#### S-7.1: Add Batch Query Methods to IEventStore
**ID:** cq-005 (prep) · **Priority:** Medium · **Effort:** 45min
**Description:** Add `countEventsBatch` and `sumSessionCost` to `IEventStore` interface. Implement in `SqliteEventStore`. This is prep work shared between perf-001 and cq-005.
**Acceptance Criteria:**
- IEventStore interface includes new batch methods
- SqliteEventStore implements both methods
- Existing tests still pass
- New methods have their own tests
**Estimated Tests:** 6
**Dependencies:** S-2.1 (may overlap; can be combined)
**Affected Files:**
- `packages/server/src/db/sqlite-store.ts`
- `packages/server/src/types.ts` (or wherever IEventStore is defined)

#### S-7.2: Extract Shared Query Helpers
**ID:** cq-005 · **Priority:** Medium · **Effort:** 30min
**Description:** Extract the 7 private helper methods (query building, row mapping) from `SqliteEventStore` into `packages/server/src/db/shared/query-helpers.ts`.
**Acceptance Criteria:**
- Query helpers extracted to shared module
- SqliteEventStore imports from shared module
- All tests pass
**Estimated Tests:** 2
**Dependencies:** S-7.1
**Affected Files:**
- `packages/server/src/db/shared/query-helpers.ts` (NEW)
- `packages/server/src/db/sqlite-store.ts`

#### S-7.3: API Client Decomposition
**ID:** cq-001 · **Priority:** Medium · **Effort:** 1.5h
**Description:** Split `client.ts` (1,126 lines, 62 exports) into ~14 domain modules under `api/`. Create barrel `index.ts` for backward compat. Update all imports. Delete `client.ts`.
**Acceptance Criteria:**
- `core.ts` contains request(), ApiError, toQueryString (CQ-02)
- ~13 domain modules created (CQ-03)
- Barrel index.ts re-exports everything (CQ-04)
- No import in dashboard codebase breaks (CQ-05)
- `client.ts` deleted (CQ-01)
- Build succeeds, all existing tests pass
**Estimated Tests:** 2 (build verification + import check)
**Dependencies:** S-5.3 (API client tests exist before split)
**Affected Files:**
- `packages/dashboard/src/api/client.ts` (DELETE)
- `packages/dashboard/src/api/*.ts` (~15 NEW files)
- All dashboard files importing from `./api/client` (update imports)

#### S-7.4: Extract Repository Classes
**ID:** cq-005 · **Priority:** Medium · **Effort:** 2h
**Description:** Extract `EventRepository`, `SessionRepository`, `AgentRepository`, `AlertRepository`, `AnalyticsRepository` from `SqliteEventStore`. Each repository gets its own file. Share DB handle and query helpers.
**Acceptance Criteria:**
- 5 repository classes extracted (CQ-21, CQ-22)
- Each handles one domain
- All existing SqliteEventStore tests pass
**Estimated Tests:** 4 (new repo-level tests; existing tests verify behavior)
**Dependencies:** S-7.2
**Affected Files:**
- `packages/server/src/db/repositories/event-repository.ts` (NEW)
- `packages/server/src/db/repositories/session-repository.ts` (NEW)
- `packages/server/src/db/repositories/agent-repository.ts` (NEW)
- `packages/server/src/db/repositories/alert-repository.ts` (NEW)
- `packages/server/src/db/repositories/analytics-repository.ts` (NEW)
- `packages/server/src/db/sqlite-store.ts` (reduce to delegation)

#### S-7.5: SqliteEventStore Facade Conversion
**ID:** cq-005 · **Priority:** Medium · **Effort:** 1h
**Description:** Convert `SqliteEventStore` to a facade that delegates to repository classes. Extract `RetentionService`. Verify all tests pass. Evaluate `IEventStore` interface for decomposition.
**Acceptance Criteria:**
- SqliteEventStore delegates to repositories (CQ-23)
- All existing tests pass without modification (CQ-24)
- IEventStore decomposition evaluated (CQ-25)
- RetentionService extracted
- SqliteEventStore is < 200 lines (down from 1,155)
**Estimated Tests:** 2 (existing tests serve as verification)
**Dependencies:** S-7.4
**Affected Files:**
- `packages/server/src/db/sqlite-store.ts` (facade)
- `packages/server/src/db/services/retention-service.ts` (NEW)

#### S-7.6: Final Verification & Cleanup
**ID:** all · **Priority:** Low · **Effort:** 1h
**Description:** Full test suite run. Verify all acceptance criteria. Run grep checks for eliminated patterns. Build verification. Update any documentation affected by changes.
**Acceptance Criteria:**
- All tests pass across all packages
- `grep "catch (err: any)"` → 0 results
- `grep "console\.\(log\|error\|warn\)" packages/server/src/` → 0 results (excluding logger)
- Dashboard test file ratio ≥ 50%
- Build succeeds for all packages
- No broken links in documentation
**Estimated Tests:** 0 (verification only)
**Dependencies:** All stories
**Affected Files:** None (verification)

---

## Batch Plan

### Batch 1: Security Critical (Lock the Doors)
**Stories:** S-1.1, S-1.2, S-1.3
**Track:** A
**Goal:** Pool server authenticated, defaults secure, rate limiter bounded
**Estimated Time:** 3 hours
**Estimated Tests:** 26

### Batch 2: Security Complete + Docs Start
**Stories:** S-1.4, S-1.5, S-6.1, S-6.2
**Track:** A (S-1.4, S-1.5) + B (S-6.1, S-6.2)
**Parallel:** Error sanitization + OTLP auth || CONTRIBUTING.md + troubleshooting
**Goal:** All security hardening done; contributor docs published
**Estimated Time:** 3.5 hours
**Estimated Tests:** 20

### Batch 3: Server Performance + Dashboard Code Split
**Stories:** S-2.1, S-2.2, S-3.1
**Track:** A (S-2.1, S-2.2) + B (S-3.1)
**Parallel:** Guardrail batch queries + alert cache || route-based code splitting
**Goal:** 75%+ reduction in server queries; smaller initial bundle
**Estimated Time:** 2.75 hours
**Estimated Tests:** 22

### Batch 4: Logger + Error Utility + Dashboard API Consolidation
**Stories:** S-4.1, S-4.2, S-3.2
**Track:** A (S-4.1, S-4.2) + B (S-3.2)
**Parallel:** Logger + error utility || Overview page consolidation
**Goal:** Logging infrastructure ready; Overview page fast
**Estimated Time:** 2.5 hours
**Estimated Tests:** 22

### Batch 5: Pool Indexes + Dashboard Test Setup
**Stories:** S-2.3, S-5.1, S-5.2, S-3.3
**Track:** A (S-2.3) + B (S-5.1, S-5.2, S-3.3)
**Parallel:** Pool server indexes || Test infra + hook tests + SSE debounce
**Goal:** Pool search fast; dashboard test foundation laid
**Estimated Time:** 3.25 hours
**Estimated Tests:** 33

### Batch 6: Console Migration + API/Page Tests
**Stories:** S-4.3, S-4.4, S-5.3, S-5.4
**Track:** A (S-4.3, S-4.4) + B (S-5.3, S-5.4)
**Parallel:** Replace all console.* + catch(any) || API client tests + page smoke tests
**Goal:** Clean server logging; dashboard test coverage ≥ 50%
**Estimated Time:** 4 hours
**Estimated Tests:** 36

### Batch 7: API Client Split + Batch Query Interface
**Stories:** S-7.1, S-7.2, S-7.3
**Track:** A (S-7.1, S-7.2) + B (S-7.3)
**Parallel:** IEventStore batch methods + shared helpers || API client decomposition
**Goal:** API client modularized; batch query interface ready
**Estimated Time:** 2.75 hours
**Estimated Tests:** 10

### Batch 8: SqliteEventStore Decomposition + Type JSDoc
**Stories:** S-7.4, S-7.5, S-6.3
**Track:** A (S-7.4, S-7.5) + B (S-6.3)
**Parallel:** Repository extraction + facade || Core type JSDoc
**Goal:** God class eliminated; types documented
**Estimated Time:** 4.5 hours
**Estimated Tests:** 6

### Batch 9: Algorithm Comments + Route Handler JSDoc
**Stories:** S-6.4, S-6.5
**Track:** B
**Goal:** Critical algorithms explained; top 5 route files documented
**Estimated Time:** 2.75 hours
**Estimated Tests:** 0

### Batch 10: Final Verification
**Stories:** S-7.6
**Track:** Both
**Goal:** Everything verified, all acceptance criteria met
**Estimated Time:** 1 hour
**Estimated Tests:** 0

---

## Summary

| Metric | Value |
|--------|-------|
| Total Epics | 7 |
| Total Stories | 30 |
| Total Batches | 10 |
| Total Estimated Tests | ~175 |
| Total Estimated Time | ~30 hours of focused work |
| Estimated Calendar Duration | 6-8 weeks (with parallel tracks) |
| Parallel Tracks | 2 (Backend + Frontend/Docs) |
| Critical Path | E1 → E2 → E4 → E7 (security → perf → quality → refactoring) |

### Idea-to-Story Traceability

| Idea | Stories |
|------|---------|
| sec-001 | S-1.1 |
| sec-002 | S-1.2 |
| sec-003 | S-1.3 |
| sec-004 | S-1.4 |
| sec-005 | S-1.5 |
| perf-001 | S-2.1, S-7.1 |
| perf-002 | S-2.3 |
| perf-003 | S-2.2 |
| perf-004 | S-3.2, S-3.3 |
| perf-005 | S-3.1 |
| cq-001 | S-7.3 |
| cq-002 | S-4.1, S-4.3 |
| cq-003 | S-4.2, S-4.4 |
| cq-004 | S-5.1, S-5.2, S-5.3, S-5.4 |
| cq-005 | S-7.1, S-7.2, S-7.4, S-7.5 |
| doc-001 | S-6.1 |
| doc-002 | S-6.3 |
| doc-003 | S-6.5 |
| doc-004 | S-6.4 |
| doc-005 | S-6.2 |

### FR Coverage

| Epic | Requirements Covered |
|------|---------------------|
| E1 | SEC-01 through SEC-24 |
| E2 | PERF-01 through PERF-14 |
| E3 | PERF-15 through PERF-23 |
| E4 | CQ-06 through CQ-14 |
| E5 | CQ-15 through CQ-20 |
| E6 | DOC-01 through DOC-16 |
| E7 | CQ-01 through CQ-05, CQ-21 through CQ-25 |

---

*End of sprint plan. 30 stories, 10 batches, ~175 tests, ~30 hours of focused work, 6-8 weeks estimated.*

# AgentLens Quality & Hardening — Product Requirements Document

## Phase 7: Security, Performance, Code Quality & Documentation

**Date:** 2026-02-10
**Author:** John (Product Manager, BMAD Pipeline)
**Source:** Phase 7 Product Brief (Paige, 2026-02-10), IDEAS.md (20 ideas)
**Status:** Draft
**Version:** 0.1

---

## Table of Contents

1. [Overview](#1-overview)
2. [Personas](#2-personas)
3. [User Stories](#3-user-stories)
4. [Functional Requirements — Security Hardening](#4-functional-requirements--security-hardening)
5. [Functional Requirements — Performance Optimizations](#5-functional-requirements--performance-optimizations)
6. [Functional Requirements — Code Quality](#6-functional-requirements--code-quality)
7. [Functional Requirements — Documentation](#7-functional-requirements--documentation)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Acceptance Criteria](#9-acceptance-criteria)
10. [Success Metrics & KPIs](#10-success-metrics--kpis)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Constraints](#12-constraints)
13. [Idea-to-Requirement Traceability](#13-idea-to-requirement-traceability)

---

## 1. Overview

Phase 7 is a quality, security, and hardening release with no new user-facing features. It addresses 20 improvements identified through automated codebase analysis across 4 categories: security hardening (5 items, including 1 critical), performance optimization (5 items), code quality (5 items), and documentation (5 items).

**Goal:** Make AgentLens production-grade, secure-by-default, performant at scale, well-documented, and contributor-friendly.

**Scope:** All changes target the existing shared codebase (not cloud-specific). No new features, no schema changes beyond what's required for these improvements.

---

## 2. Personas

### P1: AgentLens Self-Hosted Operator (Alex)
- Deploys AgentLens on their own infrastructure
- Needs secure defaults that don't require security expertise to configure
- Affected by: sec-002 (insecure defaults), sec-004 (error leakage), doc-005 (troubleshooting)

### P2: Pool Server Community User (River)
- Contributes and consumes shared lessons via the pool server
- Needs the pool server to be secure and performant at scale
- Affected by: sec-001 (no auth), sec-003 (DoS), perf-002 (search perf)

### P3: AgentLens Contributor (Jordan)
- Wants to contribute to the open-source project
- Needs clear contribution guidelines, well-documented code, and a good test suite
- Affected by: cq-001-005 (all code quality), doc-001-004 (all docs)

### P4: Platform Team Running Guardrails (Casey)
- Configures 10-50 guardrail and alert rules
- Needs efficient rule evaluation that doesn't overload the database
- Affected by: perf-001 (guardrail N+1), perf-003 (alert cache)

### P5: Dashboard User (Morgan)
- Uses the dashboard daily for agent monitoring
- Needs fast page loads and responsive UI
- Affected by: perf-004 (API calls), perf-005 (bundle size)

---

## 3. User Stories

| ID | As a... | I want to... | So that... | Ideas |
|----|---------|-------------|------------|-------|
| US-01 | Self-Hosted Operator | deploy AgentLens with secure defaults | I don't accidentally expose an unauthenticated API | sec-002 |
| US-02 | Pool Community User | know that pool server endpoints require authentication | malicious actors can't manipulate shared data | sec-001 |
| US-03 | Self-Hosted Operator | not see internal error details in API responses | attackers can't fingerprint my deployment | sec-004 |
| US-04 | Platform Team | have guardrail evaluation not slow down my database | my monitoring doesn't degrade system performance | perf-001, perf-003 |
| US-05 | Dashboard User | have the Overview page load quickly | I can check agent status without waiting | perf-004 |
| US-06 | Dashboard User | only download code for the page I'm viewing | the initial load is fast | perf-005 |
| US-07 | Contributor | find a CONTRIBUTING.md with setup instructions | I can start contributing without guessing the workflow | doc-001 |
| US-08 | Contributor | see JSDoc on all public types | I understand the API contract without reading implementation | doc-002 |
| US-09 | Contributor | have structured logging with levels | I can filter logs in development and production | cq-002 |
| US-10 | Contributor | have consistent error handling patterns | I know how to write catch blocks correctly | cq-003 |
| US-11 | Contributor | navigate small, focused API client modules | I can find and modify the code I need | cq-001 |
| US-12 | Dashboard User | trust that UI changes are tested | regressions are caught before they reach me | cq-004 |
| US-13 | Self-Hosted Operator | find a troubleshooting guide for common issues | I can self-serve instead of filing GitHub issues | doc-005 |
| US-14 | Pool Community User | have the pool server handle many concurrent searches | search doesn't slow down as the community grows | perf-002 |
| US-15 | Contributor | understand the hash chain and guardrail algorithms from comments | I can audit and modify critical code safely | doc-004 |

---

## 4. Functional Requirements — Security Hardening

### 4.1 Pool Server Authentication (sec-001)

| ID | Requirement |
|----|------------|
| SEC-01 | The pool server SHALL implement an authentication middleware that validates requests before they reach route handlers. |
| SEC-02 | Moderation endpoints (`/pool/moderation/*`) SHALL require admin-level authentication (API key with admin scope or shared secret). |
| SEC-03 | Agent-facing endpoints (`/pool/register`, `/pool/unregister`, `/pool/delegate`) SHALL require agent-level authentication (API key with agent scope). |
| SEC-04 | Data mutation endpoints (`/pool/purge`, `/pool/purge-token`, `/pool/reputation/*`) SHALL require authenticated access with the contributor's identity verified. |
| SEC-05 | Read-only endpoints (`/pool/search`, `/pool/lessons`) MAY support optional authentication, with rate limits enforced per identity or per IP for unauthenticated requests. |
| SEC-06 | The pool server authentication SHALL support shared-secret (API key) authentication configurable via `POOL_API_KEY` environment variable. |
| SEC-07 | Unauthenticated requests to protected endpoints SHALL receive `401 Unauthorized` with a generic error message (no internal details). |

### 4.2 Secure Default Configuration (sec-002)

| ID | Requirement |
|----|------------|
| SEC-08 | The server config SHALL default `corsOrigin` to `http://localhost:3400` (same-origin only) instead of `*`. |
| SEC-09 | The `.env.example` file SHALL set `AUTH_DISABLED=false` with a comment: `# Set to true ONLY for local development`. |
| SEC-10 | The server SHALL log a startup warning when `AUTH_DISABLED=true` is detected: `⚠️ Authentication is disabled. Enable auth for non-development deployments.` |
| SEC-11 | The server SHALL reject `CORS_ORIGIN=*` when `AUTH_DISABLED=false`, logging an error and refusing to start. |
| SEC-12 | The `.env.example` SHALL use port `3400` consistently (fixing the discrepancy with README/docs). |

### 4.3 Bounded Rate Limiter (sec-003)

| ID | Requirement |
|----|------------|
| SEC-13 | The pool server's RateLimiter SHALL implement a periodic cleanup sweep (every 60 seconds) that removes expired entries from the Map. |
| SEC-14 | The RateLimiter SHALL enforce a maximum size cap of 100,000 entries. When exceeded, oldest entries SHALL be evicted. |
| SEC-15 | The RateLimiter SHALL log a warning when the Map exceeds 50,000 entries: `Rate limiter map size: {n}, approaching limit`. |

### 4.4 Error Message Sanitization (sec-004)

| ID | Requirement |
|----|------------|
| SEC-16 | The global error handler SHALL return generic error messages for 5xx responses: `Internal server error`. Full error details SHALL be logged server-side only. |
| SEC-17 | An error sanitization utility SHALL map known internal error patterns (SQLite errors, file paths, library errors) to safe user-facing messages. |
| SEC-18 | Route-level catch blocks SHALL use the sanitization utility rather than passing raw `Error.message` to responses. |
| SEC-19 | For 4xx client errors, specific error messages SHALL only be returned when explicitly constructed for the client (not derived from caught exceptions). |

### 4.5 OTLP Route Authentication (sec-005)

| ID | Requirement |
|----|------------|
| SEC-20 | OTLP routes (`/v1/traces`, `/v1/metrics`, `/v1/logs`) SHALL support optional bearer token authentication via `OTLP_AUTH_TOKEN` environment variable. |
| SEC-21 | When `OTLP_AUTH_TOKEN` is set, OTLP requests without a matching `Authorization: Bearer` header SHALL receive `401 Unauthorized`. |
| SEC-22 | OTLP routes SHALL enforce request size limits (configurable, default 10MB per request). |
| SEC-23 | OTLP routes SHALL enforce per-IP rate limiting (configurable, default 1000 requests/minute). |
| SEC-24 | OTLP payload validation SHALL check for required fields and reject malformed data with `400 Bad Request` before it reaches the store. |

---

## 5. Functional Requirements — Performance Optimizations

### 5.1 Batch Guardrail Queries (perf-001)

| ID | Requirement |
|----|------------|
| PERF-01 | The `IEventStore` interface SHALL expose a `countEventsBatch` method that returns multiple aggregate counts (total, error, critical, tool_error) in a single query using `CASE WHEN` aggregation. |
| PERF-02 | The `evaluateErrorRateThreshold` function SHALL use `countEventsBatch` instead of 4 separate COUNT queries. |
| PERF-03 | The `evaluateCustomMetric` function SHALL use `limit: 1` instead of `limit: 10000` when only the latest value is needed. |
| PERF-04 | The `evaluateCostLimit` function SHALL use a `sumSessionCost` method with `SELECT SUM(total_cost_usd)` instead of fetching 10,000 sessions client-side. |
| PERF-05 | Both `SqliteEventStore` and any Postgres adapter SHALL implement `countEventsBatch` and `sumSessionCost`. |

### 5.2 Pool Server Indexes & Search Optimization (perf-002)

| ID | Requirement |
|----|------------|
| PERF-06 | The `InMemoryPoolStore` SHALL maintain a secondary index `Map<contributorId, Set<lessonId>>` for O(1) contributor-based lookups. |
| PERF-07 | The `InMemoryPoolStore` SHALL maintain a secondary index `Map<category, Set<lessonId>>` for category-based filtering. |
| PERF-08 | The `searchLessons` method SHALL pre-filter by category and reputation BEFORE computing cosine similarity, reducing the candidate set. |
| PERF-09 | The `getModerationQueue` method SHALL support pagination with `limit` and `offset` parameters. |
| PERF-10 | The pool store SHALL enforce a `maxLessons` configuration (default 100,000) with LRU eviction when exceeded. |

### 5.3 Alert Engine Analytics Cache (perf-003)

| ID | Requirement |
|----|------------|
| PERF-11 | The `AlertEngine.evaluate()` method SHALL group rules by `(tenantId, agentId, windowMinutes)` before evaluation. |
| PERF-12 | Analytics SHALL be computed once per unique `(tenantId, agentId, windowMinutes)` key and shared across all rules in that group. |
| PERF-13 | The analytics cache SHALL be cleared after each evaluation cycle completes. |
| PERF-14 | The `DEFAULT_CHECK_INTERVAL_MS` SHALL be configurable via `ALERT_CHECK_INTERVAL_MS` environment variable (default 60000). |

### 5.4 Dashboard API Consolidation (perf-004)

| ID | Requirement |
|----|------------|
| PERF-15 | A new `GET /api/stats/overview` endpoint SHALL return today/yesterday counts for events, errors, and sessions in a single response. |
| PERF-16 | The Overview page SHALL use `/api/analytics` for chart data instead of fetching 5,000 raw events for client-side bucketing. |
| PERF-17 | The sessions endpoint SHALL support a `countOnly=true` query parameter that returns only the total count without full session objects. |
| PERF-18 | SSE-triggered session refetches SHALL be debounced with a 2-3 second delay to batch rapid updates. |
| PERF-19 | `useApi` hooks SHALL support `staleTime` / `cacheTime` configuration to prevent unnecessary refetches. |

### 5.5 Dashboard Code Splitting (perf-005)

| ID | Requirement |
|----|------------|
| PERF-20 | All page component imports in `App.tsx` SHALL use `React.lazy()` for route-based code splitting. |
| PERF-21 | The `<Routes>` content SHALL be wrapped in `<Suspense fallback={<PageSkeleton />}>`. |
| PERF-22 | Vite's build config SHALL split `recharts` into a separate chunk via `manualChunks`. |
| PERF-23 | A lightweight `<PageSkeleton>` component SHALL be created for loading states during code-split navigation. |

---

## 6. Functional Requirements — Code Quality

### 6.1 API Client Decomposition (cq-001)

| ID | Requirement |
|----|------------|
| CQ-01 | The monolithic `client.ts` (1,126 lines, 62 exports) SHALL be split into domain-specific modules under `packages/dashboard/src/api/`. |
| CQ-02 | A `core.ts` module SHALL contain the shared `request()` helper, `ApiError` class, and `toQueryString` utility. |
| CQ-03 | Domain modules SHALL be created for: events, sessions, agents, analytics, alerts, guardrails, community, benchmarks, capabilities, delegations, lessons, health, config. |
| CQ-04 | A barrel `index.ts` SHALL re-export all functions from domain modules, preserving backward compatibility with existing import paths. |
| CQ-05 | No existing import statement in the dashboard codebase SHALL break after the decomposition. |

### 6.2 Structured Logger (cq-002)

| ID | Requirement |
|----|------------|
| CQ-06 | A structured logger factory SHALL be created at `packages/server/src/lib/logger.ts` with a `createLogger(namespace: string)` function. |
| CQ-07 | Logger instances SHALL expose `.info()`, `.warn()`, `.error()`, and `.debug()` methods. |
| CQ-08 | The logger SHALL support `LOG_LEVEL` environment variable for filtering (`debug`, `info`, `warn`, `error`). Default: `info`. |
| CQ-09 | All 27+ raw `console.log/error/warn` calls in the server package SHALL be replaced with structured logger calls. |
| CQ-10 | Logger output SHALL include timestamp, level, namespace, and message. Structured data SHALL be passed as a second argument object. |

### 6.3 Type-Safe Error Handling (cq-003)

| ID | Requirement |
|----|------------|
| CQ-11 | A `getErrorMessage(err: unknown): string` utility SHALL be created in `packages/core/src/errors.ts` and exported from `@agentlensai/core`. |
| CQ-12 | All 14 `catch (err: any)` patterns in the dashboard SHALL be replaced with `catch (err: unknown)` using `getErrorMessage()`. |
| CQ-13 | All server-side catch blocks SHALL be standardized to use `catch (err: unknown)` consistently. |
| CQ-14 | The 4 identical `err instanceof Error ? err.message : 'Unknown'` patterns in `guardrails/actions.ts` SHALL use `getErrorMessage()`. |

### 6.4 Dashboard Test Coverage (cq-004)

| ID | Requirement |
|----|------------|
| CQ-15 | A `packages/dashboard/vitest.config.ts` SHALL be created with `jsdom` environment and test setup for React component testing. |
| CQ-16 | `@testing-library/react` SHALL be added as a dev dependency to the dashboard package. |
| CQ-17 | Unit tests SHALL be written for `useApi` and `useSSE` hooks (all components depend on these). |
| CQ-18 | Unit tests SHALL be written for the API client `request()` helper and error handling. |
| CQ-19 | Smoke/render tests SHALL be written for the 10 most complex page components: Settings, BenchmarkDetail, Analytics, SessionDetail, GuardrailForm, Events, Alerts, Lessons, CommunityBrowser, HealthOverview. |
| CQ-20 | Dashboard test file ratio SHALL reach ≥50% (currently 12%). |

### 6.5 SqliteEventStore Decomposition (cq-005)

| ID | Requirement |
|----|------------|
| CQ-21 | The `SqliteEventStore` class (1,155 lines, 35 methods) SHALL be decomposed into focused repository classes: `EventRepository`, `SessionRepository`, `AgentRepository`, `AlertRepository`, `AnalyticsRepository`, `RetentionService`. |
| CQ-22 | Each repository class SHALL handle one aggregate root / domain. |
| CQ-23 | `SqliteEventStore` SHALL become a facade that delegates to repository classes, maintaining the `IEventStore` interface for backward compatibility. |
| CQ-24 | All existing tests for `SqliteEventStore` SHALL pass without modification after the decomposition. |
| CQ-25 | The `IEventStore` interface SHALL be evaluated for decomposition into domain-specific interfaces (e.g., `IEventRepository`, `ISessionRepository`). |

---

## 7. Functional Requirements — Documentation

### 7.1 CONTRIBUTING.md (doc-001)

| ID | Requirement |
|----|------------|
| DOC-01 | A `CONTRIBUTING.md` file SHALL be created at the repository root. |
| DOC-02 | It SHALL cover: prerequisites (Node.js ≥20, pnpm ≥10, Python 3.10+), monorepo structure with package descriptions, development workflow, testing, code style, PR process, commit conventions, issue labels, and release process. |
| DOC-03 | The README.md SHALL link to CONTRIBUTING.md from its Development section. |

### 7.2 Core Type JSDoc (doc-002)

| ID | Requirement |
|----|------------|
| DOC-04 | All interfaces and their fields in `discovery-types.ts` SHALL have JSDoc comments following the pattern in `types.ts`. |
| DOC-05 | All interfaces and their fields in `community-types.ts` SHALL have JSDoc comments. |
| DOC-06 | All interfaces and their fields in `redaction-types.ts` SHALL have JSDoc comments. |
| DOC-07 | JSDoc SHALL include `@see` references to related documentation files where applicable. |

### 7.3 Route Handler JSDoc (doc-003)

| ID | Requirement |
|----|------------|
| DOC-08 | Per-handler JSDoc SHALL be added to the 5 most complex route files: `delegation.ts`, `community.ts`, `discovery.ts`, `guardrails.ts`, `benchmarks.ts`. |
| DOC-09 | Each handler's JSDoc SHALL include: `@summary`, `@description`, `@param` for path/query params, `@body` for request schema, `@returns` for response shape, `@throws` for error conditions. |
| DOC-10 | At least 40 of the 97 total endpoints SHALL have per-handler JSDoc after this phase. |

### 7.4 Algorithm Inline Comments (doc-004)

| ID | Requirement |
|----|------------|
| DOC-11 | `packages/core/src/hash.ts` SHALL contain block comments explaining: what fields are hashed, ordering, genesis hash handling, verification walk, and a text diagram of chain structure. |
| DOC-12 | Guardrail evaluator files SHALL contain comments explaining: each condition type's evaluation formula, threshold semantics, cooldown logic, and action execution order. |

### 7.5 Troubleshooting Guide (doc-005)

| ID | Requirement |
|----|------------|
| DOC-13 | A `docs/guide/troubleshooting.md` file SHALL be created with sections for common issues: server startup, missing events, Python SDK, MCP connection, Docker setup, dashboard loading, hash chain errors. |
| DOC-14 | Each section SHALL include: symptom, cause, and fix. |
| DOC-15 | The README.md SHALL link to the troubleshooting guide from its Quick Start section. |
| DOC-16 | The `.env.example` PORT value SHALL be corrected to match documentation (3400). |

---

## 8. Non-Functional Requirements

### 8.1 Security

| ID | Requirement |
|----|------------|
| NFR-01 | No API endpoint SHALL return raw internal error messages (stack traces, file paths, SQL errors) to clients. |
| NFR-02 | Default configuration SHALL be secure: authentication enabled, CORS restricted to localhost. |
| NFR-03 | All rate limiters SHALL have bounded memory usage with maximum entry caps. |
| NFR-04 | Security changes SHALL maintain backward compatibility with existing deployments via environment variable configuration. |

### 8.2 Performance

| ID | Requirement |
|----|------------|
| NFR-05 | Guardrail evaluation with 10 active rules SHALL execute in < 500ms total (down from current ~2s). |
| NFR-06 | Alert evaluation with 20 rules SHALL execute < 50% of the current query count. |
| NFR-07 | Dashboard Overview page SHALL load with ≤ 3 API calls (down from 10+). |
| NFR-08 | Dashboard initial JavaScript bundle SHALL be < 600KB gzipped (down from ~1.5MB estimated). |
| NFR-09 | Pool server search at 10K lessons SHALL complete in < 100ms (with category pre-filtering). |

### 8.3 Code Quality

| ID | Requirement |
|----|------------|
| NFR-10 | Dashboard test file ratio SHALL be ≥ 50% (up from 12%). |
| NFR-11 | No `catch (err: any)` patterns SHALL remain in the codebase. |
| NFR-12 | No raw `console.log/error/warn` calls SHALL remain in the server package. |
| NFR-13 | No source file SHALL exceed 500 lines (after decomposition of identified large files). |

### 8.4 Documentation

| ID | Requirement |
|----|------------|
| NFR-14 | All public type definitions in `@agentlensai/core` SHALL have JSDoc coverage. |
| NFR-15 | The CONTRIBUTING.md SHALL enable a new contributor to set up the dev environment in < 15 minutes. |

### 8.5 Backward Compatibility

| ID | Requirement |
|----|------------|
| NFR-16 | All security changes SHALL be configurable via environment variables. Existing deployments with explicit config SHALL not break. |
| NFR-17 | API client decomposition SHALL not change any public import paths. |
| NFR-18 | SqliteEventStore decomposition SHALL maintain the `IEventStore` interface contract. |

---

## 9. Acceptance Criteria

### 9.1 Security

| AC | Criterion |
|----|-----------|
| AC-01 | Pool server moderation endpoints return 401 without valid authentication. |
| AC-02 | Fresh install with default `.env` starts with auth enabled and CORS restricted to localhost. |
| AC-03 | Sending 1M unique contributor IDs to the rate limiter does not cause OOM (memory stays bounded). |
| AC-04 | A deliberate server error returns "Internal server error" to the client, not stack trace or file paths. |
| AC-05 | OTLP endpoint with `OTLP_AUTH_TOKEN` set rejects requests without matching bearer token. |

### 9.2 Performance

| AC | Criterion |
|----|-----------|
| AC-06 | Guardrail evaluation for 10 rules issues ≤12 DB queries (down from 40+). |
| AC-07 | Alert evaluation for 20 rules across 5 agents issues ≤5 analytics queries (down from 20). |
| AC-08 | Dashboard Overview page fires ≤3 API requests on initial load. |
| AC-09 | Dashboard initial bundle (before any navigation) is < 600KB gzipped. |
| AC-10 | Pool server search with category filter at 10K lessons completes in < 100ms. |

### 9.3 Code Quality

| AC | Criterion |
|----|-----------|
| AC-11 | `grep -r "catch (err: any)" packages/dashboard/` returns 0 results. |
| AC-12 | `grep -r "console\.\(log\|error\|warn\)" packages/server/src/` returns 0 results (outside logger.ts). |
| AC-13 | `packages/dashboard/src/api/client.ts` no longer exists (split into modules). |
| AC-14 | `pnpm test --filter dashboard` runs ≥30 test files. |
| AC-15 | All existing server tests pass after SqliteEventStore decomposition. |

### 9.4 Documentation

| AC | Criterion |
|----|-----------|
| AC-16 | `CONTRIBUTING.md` exists at repo root and README links to it. |
| AC-17 | `docs/guide/troubleshooting.md` exists with ≥7 problem/solution sections. |
| AC-18 | Running `tsc` on `packages/core` produces no JSDoc-related warnings for discovery/community/redaction types. |
| AC-19 | The 5 targeted route files have per-handler JSDoc on every exported handler function. |

---

## 10. Success Metrics & KPIs

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Authenticated pool server routes | 0/18 | 18/18 | Code review |
| Secure default deploys | 0% | 100% | .env.example audit |
| Guardrail queries/min (10 rules) | ~40 | ~10 | DB query logging |
| Alert analytics queries/cycle | N (= rule count) | ≤ unique agent groups | DB query logging |
| Overview page API calls | 10+ | ≤3 | Network tab |
| Initial bundle size (gzipped) | ~1.5MB est. | <600KB | Build output |
| Dashboard test file ratio | 12% (7/59) | ≥50% (30+/59) | File count |
| Raw console.* in server | 27+ | 0 | grep |
| catch (err: any) in dashboard | 14 | 0 | grep |
| Core type JSDoc coverage | ~4% | 100% | Manual audit |
| Contributors docs | None | CONTRIBUTING.md + troubleshooting | File existence |

---

## 11. Risks & Mitigations

| # | Risk | Severity | Probability | Mitigation |
|---|------|----------|-------------|------------|
| R1 | Pool server auth breaks existing pool integrations | High | Medium | Document the change, provide migration guide, configurable via env var for transition period |
| R2 | Secure defaults break existing developer setups | Medium | High | Clear comments in .env.example, startup banner explains dev mode, .env overrides apply |
| R3 | SqliteEventStore refactoring introduces regressions | High | Medium | Write comprehensive tests BEFORE refactoring (cq-004 dependency), facade pattern preserves interface |
| R4 | Dashboard code splitting causes UX jank | Low | Low | Suspense with skeleton component, prefetch hints for common routes |
| R5 | Structured logger changes server log format | Low | High | This is intentional; document new format, provide LOG_LEVEL guidance |
| R6 | Large scope causes incomplete delivery | Medium | Medium | Strict phasing (7a→7d), each phase independently valuable and shippable |
| R7 | API client split breaks imports in untested code paths | Medium | Low | Barrel re-export ensures all existing imports work; grep for all import sites |

---

## 12. Constraints

| Constraint | Description |
|-----------|-------------|
| No new features | This is a quality-only release; no user-facing feature additions |
| Backward compatibility | All changes must be backward-compatible; breaking changes require env var opt-in |
| Same codebase | All changes target the shared codebase, not cloud-specific code |
| No new runtime dependencies | Structural logger and error utility must be zero-dependency implementations |
| Dashboard test infra | vitest + jsdom + @testing-library/react are the only new dev dependencies |

---

## 13. Idea-to-Requirement Traceability

| Idea ID | Idea Title | Requirements |
|---------|-----------|-------------|
| sec-001 | Pool server zero authentication | SEC-01 through SEC-07 |
| sec-002 | Insecure defaults | SEC-08 through SEC-12 |
| sec-003 | Unbounded rate limiter | SEC-13 through SEC-15 |
| sec-004 | Error message leakage | SEC-16 through SEC-19 |
| sec-005 | OTLP route auth bypass | SEC-20 through SEC-24 |
| perf-001 | Batch guardrail queries | PERF-01 through PERF-05 |
| perf-002 | Pool server indexes | PERF-06 through PERF-10 |
| perf-003 | Alert analytics cache | PERF-11 through PERF-14 |
| perf-004 | Dashboard API consolidation | PERF-15 through PERF-19 |
| perf-005 | Dashboard code splitting | PERF-20 through PERF-23 |
| cq-001 | API client decomposition | CQ-01 through CQ-05 |
| cq-002 | Structured logger | CQ-06 through CQ-10 |
| cq-003 | Type-safe error handling | CQ-11 through CQ-14 |
| cq-004 | Dashboard test coverage | CQ-15 through CQ-20 |
| cq-005 | SqliteEventStore decomposition | CQ-21 through CQ-25 |
| doc-001 | CONTRIBUTING.md | DOC-01 through DOC-03 |
| doc-002 | Core type JSDoc | DOC-04 through DOC-07 |
| doc-003 | Route handler JSDoc | DOC-08 through DOC-10 |
| doc-004 | Algorithm inline comments | DOC-11, DOC-12 |
| doc-005 | Troubleshooting guide | DOC-13 through DOC-16 |

**Total: 20 ideas → 82 functional requirements + 18 non-functional requirements + 19 acceptance criteria**

---

*End of PRD. 82 functional requirements, 18 NFRs, 19 acceptance criteria, full traceability to all 20 ideas.*

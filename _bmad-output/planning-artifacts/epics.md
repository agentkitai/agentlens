# AgentLens — Epic Breakdown

**Version:** 1.0
**Date:** 2026-02-07
**Author:** BMAD Product Strategist
**Status:** Draft

---

## Requirements Inventory

### Functional Requirements

**P0 — Must Have (MVP)**

- **FR1:** MCP server exposes tools: `agentlens_session_start`, `agentlens_log_event`, `agentlens_session_end` (PRD FR-P0-1.1)
- **FR2:** MCP server auto-captures tool call/result events via MCP protocol hooks (PRD FR-P0-1.2)
- **FR3:** Each event includes: timestamp, event type, session ID, agent ID, payload, duration (PRD FR-P0-1.3)
- **FR4:** MCP server buffers events locally and flushes to API in batches (max 100 events or 1s interval) (PRD FR-P0-1.4)
- **FR5:** MCP server works as stdio transport (Claude Desktop/Cursor) and SSE transport (programmatic agents) (PRD FR-P0-1.5)
- **FR6:** MCP server config accepts: API URL, agent name, version, environment, custom tags (PRD FR-P0-1.6)
- **FR7:** Events stored in append-only `events` table with no UPDATE or DELETE operations (PRD FR-P0-2.1)
- **FR8:** Sessions stored in `sessions` table with computed fields (start, end, duration, event count, status) (PRD FR-P0-2.2)
- **FR9:** SQLite WAL mode for concurrent read/write (PRD FR-P0-2.3)
- **FR10:** Automatic retention policy: configurable max age (default 90 days), max size (PRD FR-P0-2.4)
- **FR11:** Database schema managed via Drizzle ORM with migration support (PRD FR-P0-2.5)
- **FR12:** Event ingestion endpoint: `POST /api/events` (batch) (PRD FR-P0-3.1)
- **FR13:** Event query endpoints: `GET /api/events`, `GET /api/events/:id` (PRD FR-P0-3.2)
- **FR14:** Session endpoints: `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/sessions/:id/events` (PRD FR-P0-3.3)
- **FR15:** Query filtering: by event type, session ID, agent ID, time range, status, tags (PRD FR-P0-3.4)
- **FR16:** Cursor-based pagination with configurable page size (default 50, max 500) (PRD FR-P0-3.5)
- **FR17:** API key authentication for ingestion and querying (PRD FR-P0-3.6)
- **FR18:** Sessions list page: table with sorting, filtering, search (PRD FR-P0-4.1)
- **FR19:** Session detail page: vertical timeline with expand/collapse, event type icons, duration (PRD FR-P0-4.2)
- **FR20:** Events page: filterable list of all events across sessions (PRD FR-P0-4.3)
- **FR21:** Event detail panel: side panel showing full event JSON with syntax highlighting (PRD FR-P0-4.4)
- **FR22:** Dashboard served by same Hono server (SPA from `/` route) (PRD FR-P0-4.5)
- **FR23:** Responsive layout (desktop-first, functional on tablet) (PRD FR-P0-4.6)

**P1 — Should Have (v0.2.0)**

- **FR24:** AgentGate webhook receiver: `POST /api/v1/integrations/agentgate/webhook` (PRD FR-P1-1.1)
- **FR25:** Maps AgentGate events to AgentLens event format (PRD FR-P1-1.2)
- **FR26:** Correlates approval events with agent sessions via request ID or agent context (PRD FR-P1-1.3)
- **FR27:** Approval events appear in timeline with distinct styling (✅/❌/⏰) (PRD FR-P1-1.4)
- **FR28:** Webhook signature verification (HMAC-SHA256) (PRD FR-P1-1.5)
- **FR29:** FormBridge webhook receiver: `POST /api/v1/integrations/formbridge/webhook` (PRD FR-P1-2.1)
- **FR30:** Maps FormBridge submission events to AgentLens event format (PRD FR-P1-2.2)
- **FR31:** Tracks data flow: form created → fields filled → submitted → delivered (PRD FR-P1-2.3)
- **FR32:** FormBridge events appear in session timeline (PRD FR-P1-2.4)
- **FR33:** Events can include optional `cost` field with tokens and estimatedCostUsd (PRD FR-P1-3.1)
- **FR34:** Session summary includes total token usage and estimated cost (PRD FR-P1-3.2)
- **FR35:** Dashboard shows cost per session, cost over time chart, cost by agent (PRD FR-P1-3.3)
- **FR36:** API endpoint: `GET /api/analytics/costs` with grouping (PRD FR-P1-3.4)
- **FR37:** Configurable alert rules: error rate threshold, cost spike, session duration anomaly (PRD FR-P1-4.1)
- **FR38:** Alert channels: webhook (generic), console log (PRD FR-P1-4.2)
- **FR39:** Alert history stored and viewable in dashboard (PRD FR-P1-4.3)
- **FR40:** API endpoints for CRUD on alert rules (PRD FR-P1-4.4)

### Non-Functional Requirements

- **NFR1:** Event ingestion throughput ≥ 1,000 events/sec (single instance) (PRD §7 Performance)
- **NFR2:** Event ingestion latency P95 < 5ms per event (batch of 100) (PRD §7 Performance)
- **NFR3:** Dashboard page load < 2s initial, < 500ms navigation (PRD §7 Performance)
- **NFR4:** Event query latency P95 < 100ms for filtered queries (< 1M events) (PRD §7 Performance)
- **NFR5:** Session timeline render < 1s for sessions with up to 1,000 events (PRD §7 Performance)
- **NFR6:** Average event size ~500 bytes; payload truncation at 10KB (PRD §7 Storage)
- **NFR7:** Retention default 90 days, configurable (PRD §7 Storage)
- **NFR8:** API key authentication; keys stored as SHA-256 hashes (PRD §7 Security)
- **NFR9:** Payload sanitization — option to redact sensitive fields (PRD §7 Security)
- **NFR10:** HMAC-SHA256 webhook verification for all inbound webhooks (PRD §7 Security)
- **NFR11:** CORS: configurable allowed origins, default same-origin (PRD §7 Security)
- **NFR12:** No outbound network calls except configured alert webhooks (PRD §7 Security)
- **NFR13:** MCP server resilience: buffer up to 10K events if API unreachable, flush on reconnect (PRD §7 Reliability)
- **NFR14:** No data loss: append-only storage, no DELETE on events table (PRD §7 Reliability)
- **NFR15:** Graceful degradation: dashboard shows stale data indicator if API unreachable (PRD §7 Reliability)

### Additional Requirements (from Architecture)

- **AR1:** ULID for event IDs (time-sortable) (Arch §4.1)
- **AR2:** SHA-256 hash chain per session for tamper evidence (Arch §4.3)
- **AR3:** In-process EventBus for SSE fan-out (Arch §11.1)
- **AR4:** SSE endpoint for real-time dashboard updates (Arch §7.2, ADR-004)
- **AR5:** Dedicated MCP tools approach (not proxy) (Arch ADR-001)
- **AR6:** `agentlens_query_events` MCP tool for agent self-inspection (Arch §5.2)
- **AR7:** SQLite-first with PostgreSQL alternative (Arch ADR-002)
- **AR8:** Hybrid schema: typed columns for query fields, JSON for payload (Arch ADR-003)
- **AR9:** Six npm packages: core, mcp, server, dashboard, sdk, cli (Arch ADR-005)
- **AR10:** Health endpoint `GET /api/health` (no auth) (Arch §7.1)
- **AR11:** Storage statistics endpoint `GET /api/stats` (Arch §7.1)
- **AR12:** Changesets for versioning (Arch §3.3)
- **AR13:** VitePress documentation site (Arch §3.1)
- **AR14:** Environment configuration via env vars with sensible defaults (Arch Appendix A)
- **AR15:** Port 3400 default (Arch Appendix A)
- **AR16:** Alert rule CRUD API (Arch §7.1)
- **AR17:** Alert history table and endpoint (Arch §6.2)
- **AR18:** Retention enforcement via scheduled cleanup (Arch §6.5)
- **AR19:** Generic webhook receiver for third-party integrations (Arch §9.3)
- **AR20:** Agents table — auto-created on first event (Arch §6.2)

---

## Epic List

1. **Epic 1: Project Foundation & Monorepo Setup** (6 stories)
2. **Epic 2: Core Types & Validation** (5 stories)
3. **Epic 3: Event Storage Layer** (6 stories)
4. **Epic 4: REST API Server** (7 stories)
5. **Epic 5: MCP Server** (6 stories)
6. **Epic 6: Dashboard — Layout & Overview** (5 stories)
7. **Epic 7: Dashboard — Sessions & Timeline** (6 stories)
8. **Epic 8: Dashboard — Events & Settings** (5 stories)
9. **Epic 9: AgentGate Integration** (5 stories)
10. **Epic 10: FormBridge Integration** (4 stories)
11. **Epic 11: Cost Tracking & Analytics** (5 stories)
12. **Epic 12: Alerting System** (5 stories)
13. **Epic 13: SDK & CLI** (5 stories)
14. **Epic 14: Real-Time Updates (SSE)** (4 stories)
15. **Epic 15: Documentation & Launch** (5 stories)

---

## Epic 1: Project Foundation & Monorepo Setup

**Goal:** Establish the monorepo structure, build tooling, CI configuration, and shared configs so all subsequent work has a solid foundation.

**Delivers:** A runnable monorepo with all package scaffolds, dev tooling, and CI pipeline.

### Story 1.1: Initialize pnpm Monorepo with Workspace Config

As a **developer**, I want a properly configured pnpm monorepo workspace,
So that all packages can share dependencies and build together.

**Acceptance Criteria:**
- Given a fresh clone, When I run `pnpm install`, Then all workspace dependencies resolve correctly
- Given the root `pnpm-workspace.yaml`, When inspected, Then it includes `packages/*` glob
- Given the root `package.json`, When inspected, Then it includes `build`, `test`, `dev`, `lint`, `typecheck` scripts
- Given any package, When it imports from a sibling, Then it uses `workspace:*` protocol

**Technical Notes:**
- Create `pnpm-workspace.yaml` with `packages: ['packages/*']`
- Root `package.json` with workspace scripts per Arch §3.3
- `.npmrc` with `shamefully-hoist=false` for strict dependency isolation

**Dependencies:** None
**Estimate:** S

### Story 1.2: Configure TypeScript with Shared Base Config

As a **developer**, I want a shared TypeScript base config with strict mode,
So that all packages have consistent type-checking.

**Acceptance Criteria:**
- Given the root `tsconfig.json`, When inspected, Then strict mode is enabled
- Given each package's `tsconfig.json`, When inspected, Then it extends the root config
- Given any TypeScript file, When I run `pnpm typecheck`, Then it type-checks across all packages
- Given ESM configuration, When packages compile, Then they output ESM modules

**Technical Notes:**
- Root `tsconfig.json` with `"strict": true`, `"target": "ES2022"`, `"module": "NodeNext"`
- Each package extends: `{ "extends": "../../tsconfig.json" }`
- TypeScript ≥ 5.7 per Arch §12.1

**Dependencies:** Story 1.1
**Estimate:** S

### Story 1.3: Scaffold All Package Directories

As a **developer**, I want all six package directories created with correct `package.json` and entry points,
So that the package structure matches the architecture.

**Acceptance Criteria:**
- Given the packages directory, When I list contents, Then I see: `core`, `mcp`, `server`, `dashboard`, `sdk`, `cli`
- Given each package, When I inspect `package.json`, Then it has correct name (`@agentlens/<name>`), version `0.0.0`, and entry point
- Given the dependency graph, When inspected, Then `core` has no internal deps; `mcp`, `server`, `dashboard`, `sdk` depend on `core`; `cli` depends on `sdk`
- Given each package, When it has a `src/index.ts`, Then it exports a placeholder (empty or comment)

**Technical Notes:**
- Package names per Arch §3.2: `@agentlens/core`, `@agentlens/mcp`, `@agentlens/server`, `@agentlens/dashboard`, `@agentlens/sdk`, `@agentlens/cli`
- Dependency graph per Arch ADR-005

**Dependencies:** Story 1.1
**Estimate:** S

### Story 1.4: Set Up ESLint and Prettier

As a **developer**, I want consistent linting and formatting across all packages,
So that code style is uniform and reviews focus on logic.

**Acceptance Criteria:**
- Given any `.ts` or `.tsx` file, When I run `pnpm lint`, Then ESLint reports violations
- Given any file, When I run `pnpm format`, Then Prettier formats it consistently
- Given the ESLint config, When inspected, Then it uses flat config (ESLint 9+) with typescript-eslint

**Technical Notes:**
- ESLint 9 flat config (`.eslintrc.js` or `eslint.config.js`) per Arch §12.2
- Prettier config in `.prettierrc`
- `typescript-eslint` ^8.x

**Dependencies:** Story 1.2
**Estimate:** S

### Story 1.5: Configure Vitest for All Packages

As a **developer**, I want a unified test runner that works across all packages,
So that I can run tests from root or per-package.

**Acceptance Criteria:**
- Given the root, When I run `pnpm test`, Then Vitest runs tests across all packages
- Given a single package, When I run `pnpm --filter @agentlens/core test`, Then only that package's tests run
- Given a test file, When it imports from `@agentlens/core`, Then workspace resolution works correctly
- Given the Vitest config, When inspected, Then it includes coverage configuration (v8 provider)

**Technical Notes:**
- Root `vitest.workspace.ts` per Arch §3.1
- `@vitest/coverage-v8` for coverage
- Each package can have local `vitest.config.ts` extending the root

**Dependencies:** Story 1.2
**Estimate:** S

### Story 1.6: Set Up Changesets for Versioning

As a **developer**, I want automated version management and changelog generation,
So that package releases are consistent and documented.

**Acceptance Criteria:**
- Given a code change, When I run `pnpm changeset`, Then I can create a changeset describing the change
- Given pending changesets, When I run `pnpm changeset version`, Then package versions are bumped and CHANGELOG.md is generated
- Given the `.changeset/` directory, When inspected, Then it contains a `config.json` with proper settings

**Technical Notes:**
- `@changesets/cli` ^2.x per Arch §12.2
- Configure for independent versioning of packages
- `.changeset/config.json` with `"access": "public"`, `"baseBranch": "main"`

**Dependencies:** Story 1.3
**Estimate:** S

---

## Epic 2: Core Types & Validation

**Goal:** Define the shared type system, event schemas, validation logic, and utility functions that all packages depend on.

**Delivers:** `@agentlens/core` package — the foundation for every other package.

### Story 2.1: Define Core Event Types and Interfaces

As a **developer**, I want strongly-typed event definitions with discriminated unions,
So that every package handles events with compile-time safety.

**Acceptance Criteria:**
- Given `packages/core/src/types.ts`, When I import `AgentLensEvent`, Then it includes all fields: id, timestamp, sessionId, agentId, eventType, severity, payload, metadata, prevHash, hash
- Given the `EventType` union, When inspected, Then it includes all types: session_started, session_ended, tool_call, tool_response, tool_error, approval_requested, approval_granted, approval_denied, approval_expired, form_submitted, form_completed, form_expired, cost_tracked, alert_triggered, alert_resolved, custom
- Given `EventSeverity`, When inspected, Then it includes: debug, info, warn, error, critical
- Given typed payloads (ToolCallPayload, ToolResponsePayload, etc.), When used in discriminated union, Then TypeScript narrows correctly on `eventType`

**Technical Notes:**
- File: `packages/core/src/types.ts`
- All types per Arch §4.1 — `EventType`, `EventSeverity`, `AgentLensEvent`, typed payloads
- `EventId` type alias for string (ULID)
- `Timestamp` type alias for ISO 8601 string

**Dependencies:** Story 1.3
**Estimate:** M

### Story 2.2: Define Session, Agent, and Query Types

As a **developer**, I want typed Session, Agent, and query interfaces,
So that querying and rendering are type-safe across packages.

**Acceptance Criteria:**
- Given the `Session` interface, When inspected, Then it includes: id, agentId, agentName, startedAt, endedAt, status, eventCount, toolCallCount, errorCount, totalCostUsd, tags
- Given `SessionStatus`, When inspected, Then it includes: active, completed, error
- Given `EventQuery`, When used, Then it supports: sessionId, agentId, eventType, severity, from, to, limit, offset, order, search
- Given `SessionQuery`, When used, Then it supports: agentId, status, from, to, limit, offset, tags
- Given `AlertRule` interface, When inspected, Then it includes: id, name, enabled, condition, threshold, windowMinutes, scope, notifyChannels

**Technical Notes:**
- File: `packages/core/src/types.ts` (continuation)
- Types per Arch §4.1 — `Session`, `Agent`, `EventQuery`, `EventQueryResult`, `SessionQuery`, `AlertRule`, `AlertCondition`

**Dependencies:** Story 2.1
**Estimate:** S

### Story 2.3: Create Zod Validation Schemas

As a **developer**, I want runtime validation schemas for all API inputs,
So that invalid data is rejected at the boundary with clear error messages.

**Acceptance Criteria:**
- Given `ingestEventSchema`, When validating a valid event, Then it passes with correctly typed output
- Given `ingestEventSchema`, When validating with missing `sessionId`, Then it returns a descriptive error
- Given `eventTypeSchema`, When validating an unknown type string, Then it fails validation
- Given `severitySchema`, When used with `.default('info')`, Then missing severity defaults to `info`
- Given all schemas, When imported from `@agentlens/core`, Then they are re-exported via `index.ts`

**Technical Notes:**
- File: `packages/core/src/schemas.ts`
- Schemas per Arch §4.2 — `eventTypeSchema`, `severitySchema`, `ingestEventSchema`
- Zod ^3.x for runtime validation
- Export `IngestEventInput` type inferred from Zod schema

**Dependencies:** Story 2.1
**Estimate:** S

### Story 2.4: Implement Hash Chain Utilities

As a **compliance officer**, I want every event to be part of a cryptographic hash chain,
So that event tampering is detectable and audit trails are trustworthy.

**Acceptance Criteria:**
- Given an event and its predecessor's hash, When `computeEventHash()` is called, Then it returns a deterministic SHA-256 hex string
- Given the same input, When called twice, Then the hash is identical (deterministic)
- Given a valid chain of events, When `verifyChain()` is called, Then it returns `true`
- Given a chain where one event's payload was modified, When `verifyChain()` is called, Then it returns `false`
- Given the first event in a session (no predecessor), When hashed, Then `prevHash` is `null` and the hash is still computed correctly

**Technical Notes:**
- File: `packages/core/src/hash.ts`
- Implementation per Arch §4.3 — canonical JSON serialization → SHA-256
- Uses `node:crypto` createHash
- `computeEventHash()` and `verifyChain()` functions

**Dependencies:** Story 2.1
**Estimate:** S

### Story 2.5: Implement Event Creation Helpers and Constants

As a **developer**, I want factory functions for creating events with proper defaults,
So that event creation is consistent and less error-prone across packages.

**Acceptance Criteria:**
- Given `createEvent()` helper, When called with minimal fields (sessionId, agentId, eventType, payload), Then it returns a full `AgentLensEvent` with generated ULID id, ISO timestamp, default severity `info`, and computed hash
- Given `packages/core/src/constants.ts`, When inspected, Then it exports: default pagination limit (50), max pagination limit (500), max payload size (10KB), default retention days (90)
- Given `packages/core/src/index.ts`, When imported, Then all public types, schemas, helpers, and constants are re-exported

**Technical Notes:**
- Files: `packages/core/src/events.ts`, `packages/core/src/constants.ts`, `packages/core/src/index.ts`
- Use `ulid` package (^2.x) for time-sortable IDs per Arch §4.1
- Payload truncation utility: if `JSON.stringify(payload).length > 10KB`, truncate with indicator

**Dependencies:** Story 2.4
**Estimate:** S

---

## Epic 3: Event Storage Layer

**Goal:** Implement the storage interface and SQLite backend so events can be persisted, queried, and maintained.

**Delivers:** Fully functional event storage with append-only semantics, indexing, and retention.

### Story 3.1: Define Storage Interface (IEventStore)

As a **developer**, I want a clear storage interface that all backends implement,
So that storage is pluggable and testable via mocks.

**Acceptance Criteria:**
- Given `IEventStore` interface, When inspected, Then it includes methods: `insertEvents`, `queryEvents`, `getEvent`, `getSessionTimeline`, `countEvents`, `upsertSession`, `querySessions`, `getSession`, `upsertAgent`, `listAgents`, `getAgent`, `getAnalytics`, `createAlertRule`, `updateAlertRule`, `deleteAlertRule`, `listAlertRules`, `getAlertRule`, `applyRetention`, `getStats`
- Given `AnalyticsResult` type, When inspected, Then it includes `buckets` array and `totals` object
- Given `StorageStats` type, When inspected, Then it includes: totalEvents, totalSessions, totalAgents, oldestEvent, newestEvent, storageSizeBytes

**Technical Notes:**
- File: `packages/core/src/storage.ts`
- Interface per Arch §6.1 — `IEventStore`, `AnalyticsResult`, `StorageStats`
- Pure interface with no implementation — enables mock testing

**Dependencies:** Story 2.2
**Estimate:** S

### Story 3.2: Implement SQLite Schema with Drizzle ORM

As a **developer**, I want the SQLite database schema defined in Drizzle ORM,
So that the database structure is type-safe and migratable.

**Acceptance Criteria:**
- Given `schema.sqlite.ts`, When inspected, Then it defines tables: `events`, `sessions`, `agents`, `alertRules`, `alertHistory`, `apiKeys`
- Given the events table, When inspected, Then it has columns: id (PK), timestamp, sessionId, agentId, eventType, severity, payload (JSON text), metadata (JSON text), prevHash, hash
- Given the sessions table, When inspected, Then it has: id (PK), agentId, agentName, startedAt, endedAt, status (enum: active/completed/error), eventCount, toolCallCount, errorCount, totalCostUsd, tags
- Given all tables, When indexes are inspected, Then they include: idx_events_timestamp, idx_events_session_id, idx_events_agent_id, idx_events_type, idx_events_session_ts, idx_events_agent_type_ts, idx_sessions_agent_id, idx_sessions_started_at, idx_sessions_status, idx_api_keys_hash

**Technical Notes:**
- File: `packages/server/src/db/schema.sqlite.ts`
- Schema per Arch §6.2 with all indexes from §6.2
- Drizzle ORM ^0.39.x with `drizzle-orm/sqlite-core`
- Composite index `idx_events_agent_type_ts` for dashboard query pattern

**Dependencies:** Story 3.1, Story 1.3
**Estimate:** M

### Story 3.3: Implement Database Initialization and Migration Runner

As a **developer**, I want the database to auto-initialize on first start and support migrations,
So that setup is zero-config and schema changes are managed.

**Acceptance Criteria:**
- Given a fresh start with no database file, When the server starts, Then the SQLite database is created at the configured path with all tables and indexes
- Given `DB_DIALECT=sqlite`, When `createDb()` is called, Then it returns a Drizzle SQLite instance with WAL mode, NORMAL synchronous, 64MB cache, 5s busy timeout
- Given `DB_DIALECT=postgresql`, When `createDb()` is called, Then it returns a Drizzle PostgreSQL instance with connection pooling
- Given a schema change, When migrations are run, Then the database is updated without data loss

**Technical Notes:**
- Files: `packages/server/src/db/index.ts`, `packages/server/src/db/migrate.ts`
- DB dialect selector per Arch §6.4
- SQLite pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-64000`, `busy_timeout=5000`
- `bootstrap.ts` runs migrations on server startup

**Dependencies:** Story 3.2
**Estimate:** M

### Story 3.4: Implement SQLite Event Store — Write Operations

As a **developer**, I want to persist events and sessions to SQLite,
So that the event store captures agent activity reliably.

**Acceptance Criteria:**
- Given a batch of valid events, When `insertEvents()` is called, Then all events are inserted in a single transaction
- Given an event insert, When the session already exists, Then session aggregates (eventCount, toolCallCount, errorCount) are incremented
- Given an event insert for a new agent, When processed, Then an agent record is auto-created via `upsertAgent()`
- Given a batch of 100 events, When inserted, Then the operation completes in < 50ms (per NFR2)
- Given a `session_started` event, When inserted, Then a new session record is created with status `active`
- Given a `session_ended` event, When inserted, Then the session's `endedAt` and `status` are updated

**Technical Notes:**
- File: `packages/server/src/db/sqlite-store.ts` (implements `IEventStore`)
- Batch insert inside transaction for atomicity
- Materialized session updates: increment counters on each event insert per Arch §11.2
- Use Drizzle's `db.insert()` and `db.update()` with `eq()` filters

**Dependencies:** Story 3.3
**Estimate:** M

### Story 3.5: Implement SQLite Event Store — Read Operations

As a **developer**, I want to query events and sessions with flexible filters,
So that the API can serve dashboard and programmatic queries.

**Acceptance Criteria:**
- Given a `queryEvents()` call with sessionId filter, When executed, Then only events for that session are returned, ordered by timestamp
- Given a `queryEvents()` call with eventType and severity filters, When executed, Then results are filtered by both criteria
- Given a `queryEvents()` call with `from` and `to` timestamps, When executed, Then only events within the range are returned
- Given `getSessionTimeline(sessionId)`, When called, Then all events for the session are returned in ascending timestamp order
- Given `querySessions()` with agentId and status filters, When executed, Then matching sessions are returned with total count
- Given `getAnalytics()` with a time range and granularity, When called, Then bucketed counts (eventCount, toolCallCount, errorCount, avgLatencyMs, totalCostUsd) are returned

**Technical Notes:**
- File: `packages/server/src/db/sqlite-store.ts` (continuation)
- Use Drizzle query builder with dynamic `where` clause construction
- Leverage composite indexes for efficient queries
- `countEvents()` for pagination metadata
- Offset-based pagination (limit/offset) per Arch §7.1

**Dependencies:** Story 3.4
**Estimate:** M

### Story 3.6: Implement Retention Policy Engine

As an **engineering manager**, I want old events automatically cleaned up based on retention policy,
So that storage doesn't grow unbounded in self-hosted deployments.

**Acceptance Criteria:**
- Given `RETENTION_DAYS=90`, When the retention job runs, Then events older than 90 days are deleted
- Given `applyRetention()` is called, When it completes, Then it returns `{ deletedCount: number }` indicating how many events were removed
- Given `RETENTION_DAYS=0`, When configured, Then no events are ever deleted (keep forever)
- Given the retention job, When it runs, Then it also cleans up sessions with no remaining events

**Technical Notes:**
- File: `packages/server/src/lib/retention.ts`
- Default policy per Arch §6.5: 90 days retention
- Runs on configurable interval (daily by default)
- Note: this is the ONE exception to "no DELETE on events" — retention cleanup is audited

**Dependencies:** Story 3.4
**Estimate:** S

---

## Epic 4: REST API Server

**Goal:** Implement the Hono HTTP server with all MVP endpoints for event ingestion, querying, session management, and API key auth.

**Delivers:** A fully functional API server that the MCP server, dashboard, and SDK can communicate with.

### Story 4.1: Bootstrap Hono Server with Middleware

As a **developer**, I want a configured Hono HTTP server with logging, CORS, and error handling,
So that all API routes have consistent middleware behavior.

**Acceptance Criteria:**
- Given the server starts, When I check the console, Then it logs the port and URL it's listening on (default port 3400)
- Given a request to any `/api/*` route, When processed, Then CORS headers are included based on `CORS_ORIGIN` config
- Given a request to any route, When processed, Then the request is logged (method, path, status, duration)
- Given an unhandled error in a route, When it occurs, Then a JSON error response is returned with appropriate status code
- Given `GET /api/health`, When called without auth, Then it returns `{ status: "ok", version: "0.1.0" }`

**Technical Notes:**
- File: `packages/server/src/index.ts`
- Hono setup per Arch §7.3 — `cors()`, `logger()` middleware
- `getConfig()` from `packages/server/src/config.ts` per Arch Appendix A
- Health endpoint excluded from auth per Arch §10.1
- Default port 3400 per AR15

**Dependencies:** Story 3.3 (needs db bootstrap)
**Estimate:** S

### Story 4.2: Implement API Key Authentication Middleware

As a **developer**, I want API key-based authentication on all API endpoints,
So that only authorized clients can ingest and query data.

**Acceptance Criteria:**
- Given a request with valid `Authorization: Bearer als_xxx` header, When the key hash matches a stored key, Then the request proceeds
- Given a request with missing or invalid API key, When processed, Then a 401 response is returned with `{ error: "Missing API key" }` or `{ error: "Invalid API key" }`
- Given a revoked API key, When used in a request, Then a 401 response is returned
- Given `AUTH_DISABLED=true`, When any request is made, Then authentication is skipped (development mode)
- Given a successful auth, When processed, Then `lastUsedAt` is updated asynchronously (fire-and-forget)

**Technical Notes:**
- File: `packages/server/src/middleware/auth.ts`
- Implementation per Arch §10.1 — SHA-256 hash comparison, `Bearer` prefix
- Key format: `als_` prefix + 32 hex chars
- Attach `apiKey` info to Hono context via `c.set('apiKey', apiKey)`

**Dependencies:** Story 3.2 (needs apiKeys table)
**Estimate:** S

### Story 4.3: Implement API Key Management Endpoints

As a **developer**, I want to create, list, and revoke API keys via the API,
So that I can manage access to the AgentLens server.

**Acceptance Criteria:**
- Given `POST /api/keys` with `{ name, scopes }`, When called, Then a new API key is created and returned (key shown ONLY in this response)
- Given `GET /api/keys`, When called, Then all keys are listed with metadata (id, name, scopes, createdAt, lastUsedAt) but NOT the key itself
- Given `DELETE /api/keys/:id`, When called, Then the key is marked as revoked (soft delete)
- Given a newly created key, When the response is inspected, Then the key starts with `als_` prefix

**Technical Notes:**
- File: `packages/server/src/routes/api-keys.ts`
- Routes per Arch §7.1: `POST /api/keys`, `GET /api/keys`, `DELETE /api/keys/:id`
- Generate key: `als_` + 32 random hex bytes via `crypto.randomBytes()`
- Store only SHA-256 hash in DB; return raw key once on creation

**Dependencies:** Story 4.2
**Estimate:** S

### Story 4.4: Implement Event Ingestion Endpoint

As a **developer**, I want a batch event ingestion endpoint,
So that MCP servers and webhooks can send events efficiently.

**Acceptance Criteria:**
- Given `POST /api/events` with `{ events: [...] }`, When called with valid events, Then all events are validated, assigned ULIDs, hashed, and persisted
- Given a batch of events, When ingested, Then the response includes `{ ingested: number, events: [{ id, hash }] }`
- Given an event with missing required fields, When ingested, Then a 400 response with validation errors is returned
- Given an event with payload > 10KB, When ingested, Then the payload is truncated with a `_truncated: true` indicator
- Given batch ingestion of 100 events, When measured, Then latency is < 50ms (per NFR2)

**Technical Notes:**
- File: `packages/server/src/routes/events.ts` (POST handler)
- Validate each event via `ingestEventSchema` from `@agentlens/core`
- Assign ULID via `ulid()`, compute hash chain per session
- Call `store.insertEvents()` then emit to EventBus

**Dependencies:** Story 3.4, Story 4.1
**Estimate:** M

### Story 4.5: Implement Event Query Endpoints

As a **developer**, I want to query events with flexible filters,
So that the dashboard and SDK can fetch event data.

**Acceptance Criteria:**
- Given `GET /api/events` with no filters, When called, Then the most recent 50 events are returned (descending)
- Given `GET /api/events?sessionId=X&eventType=tool_call`, When called, Then only matching events are returned
- Given `GET /api/events?from=X&to=Y`, When called, Then only events within the time range are returned
- Given `GET /api/events/:id`, When called with a valid ID, Then the single event is returned
- Given `GET /api/events/:id`, When called with an invalid ID, Then a 404 response is returned
- Given pagination params `?limit=20&offset=40`, When called, Then the response includes `{ events, total, hasMore }`

**Technical Notes:**
- File: `packages/server/src/routes/events.ts` (GET handlers)
- Query params: sessionId, agentId, eventType, severity, from, to, search, limit, offset, order
- Delegate to `store.queryEvents()` and `store.getEvent()`
- Enforce max limit of 500 per AR constants

**Dependencies:** Story 3.5, Story 4.1
**Estimate:** M

### Story 4.6: Implement Session Endpoints

As a **developer**, I want session query and detail endpoints,
So that the dashboard can render session lists and timelines.

**Acceptance Criteria:**
- Given `GET /api/sessions`, When called, Then sessions are returned with filters (agentId, status, from, to) and pagination
- Given `GET /api/sessions/:id`, When called, Then session details including aggregates (eventCount, errorCount, totalCostUsd) are returned
- Given `GET /api/sessions/:id/timeline`, When called, Then all events for the session are returned in ascending timestamp order with `chainValid` boolean
- Given `GET /api/sessions/:id` for a non-existent session, When called, Then a 404 response is returned

**Technical Notes:**
- File: `packages/server/src/routes/sessions.ts`
- Routes per Arch §7.1: `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/timeline`
- Timeline includes hash chain verification via `verifyChain()` from core
- Delegate to `store.querySessions()`, `store.getSession()`, `store.getSessionTimeline()`

**Dependencies:** Story 3.5, Story 4.1
**Estimate:** M

### Story 4.7: Implement Agent and Stats Endpoints

As a **developer**, I want agent listing and storage stats endpoints,
So that the dashboard can show agent overviews and system health.

**Acceptance Criteria:**
- Given `GET /api/agents`, When called, Then all known agents are returned with: id, name, firstSeenAt, lastSeenAt, sessionCount
- Given `GET /api/agents/:id`, When called, Then a single agent's details are returned
- Given `GET /api/stats`, When called, Then storage statistics are returned: totalEvents, totalSessions, totalAgents, oldestEvent, newestEvent, storageSizeBytes

**Technical Notes:**
- Files: `packages/server/src/routes/agents.ts`, `packages/server/src/routes/stats.ts`
- Agents endpoint per Arch §7.1
- Stats endpoint per AR11
- Delegate to `store.listAgents()`, `store.getAgent()`, `store.getStats()`

**Dependencies:** Story 3.5, Story 4.1
**Estimate:** S

---

## Epic 5: MCP Server

**Goal:** Implement the MCP server that agents connect to for instrumentation, providing tools for session management, event logging, and querying.

**Delivers:** `@agentlens/mcp` — a working MCP server that agents add to their config for automatic observability.

### Story 5.1: Implement MCP Server Entrypoint with Stdio Transport

As a **developer**, I want an MCP server that starts via `npx @agentlens/mcp`,
So that agents can connect to AgentLens through standard MCP configuration.

**Acceptance Criteria:**
- Given the MCP server is started, When it connects via stdio, Then it logs "AgentLens MCP server running" to stderr
- Given `ListToolsRequest`, When received, Then four tools are returned: `agentlens_session_start`, `agentlens_log_event`, `agentlens_session_end`, `agentlens_query_events`
- Given environment variables `AGENTLENS_URL` and `AGENTLENS_API_KEY`, When the server starts, Then it configures the HTTP transport with these values
- Given no `AGENTLENS_URL`, When the server starts, Then it defaults to `http://localhost:3400`

**Technical Notes:**
- File: `packages/mcp/src/index.ts`
- Implementation per Arch §5.3 — `Server` from `@modelcontextprotocol/sdk/server`
- `StdioServerTransport` for Claude Desktop / Cursor integration
- Environment config per Arch Appendix A

**Dependencies:** Story 2.1 (core types)
**Estimate:** S

### Story 5.2: Implement `agentlens_session_start` Tool

As a **developer**, I want agents to start observability sessions via MCP tool,
So that events are grouped into logical session units.

**Acceptance Criteria:**
- Given the `agentlens_session_start` tool is called with `{ agentId: "my-agent" }`, When processed, Then a new session is created on the server and `{ sessionId: "..." }` is returned
- Given optional fields (agentName, tags), When provided, Then they are included in the session creation
- Given the server is unreachable, When the tool is called, Then a meaningful error message is returned to the agent
- Given the tool definition, When inspected, Then `agentId` is required, all other fields are optional

**Technical Notes:**
- File: `packages/mcp/src/tools.ts`
- Tool definition per Arch §5.2
- HTTP POST to server's event ingestion with `eventType: "session_started"`
- Returns `{ sessionId }` in tool result content

**Dependencies:** Story 5.1, Story 4.4
**Estimate:** S

### Story 5.3: Implement `agentlens_log_event` Tool

As a **developer**, I want agents to log custom events during a session,
So that tool calls, decisions, errors, and costs are captured.

**Acceptance Criteria:**
- Given `agentlens_log_event` is called with `{ sessionId, eventType: "tool_call", payload: { toolName: "search" } }`, When processed, Then the event is sent to the server
- Given a `severity` field, When provided, Then it overrides the default `info` level
- Given a `metadata` field, When provided, Then arbitrary key-value pairs are included
- Given the tool is called, When the server accepts the event, Then a confirmation message is returned

**Technical Notes:**
- File: `packages/mcp/src/tools.ts`
- Tool definition per Arch §5.2
- Accepts: sessionId (required), eventType (required), payload (required), severity (optional), metadata (optional)
- HTTP POST to `/api/events`

**Dependencies:** Story 5.2
**Estimate:** S

### Story 5.4: Implement `agentlens_session_end` Tool

As a **developer**, I want agents to explicitly end observability sessions,
So that sessions have clear boundaries and status.

**Acceptance Criteria:**
- Given `agentlens_session_end` is called with `{ sessionId, reason: "completed" }`, When processed, Then a `session_ended` event is sent with the reason
- Given an optional `summary` field, When provided, Then it is included in the session end event
- Given valid reasons: `completed`, `error`, `timeout`, `manual`, When any is provided, Then it is accepted
- Given the tool is called, When processed, Then the session status is updated on the server

**Technical Notes:**
- File: `packages/mcp/src/tools.ts`
- Tool definition per Arch §5.2
- `reason` enum: completed, error, timeout, manual
- Sends `session_ended` event type to server

**Dependencies:** Story 5.2
**Estimate:** S

### Story 5.5: Implement `agentlens_query_events` Tool

As a **developer**, I want agents to query their own event history via MCP,
So that agents can review their actions and detect patterns.

**Acceptance Criteria:**
- Given `agentlens_query_events` is called with `{ sessionId }`, When processed, Then recent events for that session are returned
- Given a `limit` parameter, When provided, Then at most that many events are returned (default 50)
- Given an `eventType` filter, When provided, Then only matching events are returned
- Given the query results, When returned to the agent, Then they include event summaries (type, name, timestamp, severity)

**Technical Notes:**
- File: `packages/mcp/src/tools.ts`
- Tool definition per Arch §5.2 (`agentlens_query_events`)
- HTTP GET to `/api/events` with query params
- Return summarized format to avoid overwhelming agent context

**Dependencies:** Story 5.1, Story 4.5
**Estimate:** S

### Story 5.6: Implement HTTP Transport Layer for MCP→Server Communication

As a **developer**, I want the MCP server to communicate with the API server reliably,
So that events are delivered even under intermittent connectivity.

**Acceptance Criteria:**
- Given the MCP server sends events, When the server is reachable, Then events are delivered via HTTP POST with API key auth
- Given the server is unreachable, When events are generated, Then they are buffered in memory (up to 10K events or 10MB)
- Given the server becomes reachable again, When reconnected, Then buffered events are flushed in order
- Given the MCP server shuts down (SIGTERM/SIGINT), When shutdown is triggered, Then remaining buffered events are flushed before exit

**Technical Notes:**
- File: `packages/mcp/src/transport.ts`
- HTTP client using native `fetch()`
- `Authorization: Bearer ${apiKey}` header
- Buffer per NFR13: 10K events max in memory
- Graceful shutdown with flush-on-exit

**Dependencies:** Story 5.1
**Estimate:** M

---

## Epic 6: Dashboard — Layout & Overview

**Goal:** Build the dashboard shell (routing, layout, navigation) and the Overview page with key metrics.

**Delivers:** A navigable dashboard SPA with a useful home page showing system health at a glance.

### Story 6.1: Set Up React SPA with Vite and Tailwind

As a **developer**, I want the dashboard project scaffolded with React, Vite, and Tailwind,
So that development can begin on dashboard pages.

**Acceptance Criteria:**
- Given the dashboard package, When I run `pnpm --filter @agentlens/dashboard dev`, Then Vite dev server starts with HMR
- Given the project, When inspected, Then it uses React 18, Vite 6, Tailwind CSS 3, React Router 6
- Given a production build, When I run `pnpm --filter @agentlens/dashboard build`, Then static assets are output to `dist/`
- Given the build output, When served by the Hono server, Then the SPA loads correctly at the root URL

**Technical Notes:**
- Files: `packages/dashboard/package.json`, `vite.config.ts`, `tailwind.config.js`, `index.html`, `src/main.tsx`
- Tech stack per Arch §8.5
- Vite proxy config to forward `/api/*` to the server during development
- Output `dist/` to be copied to server's `public/` for production

**Dependencies:** Story 1.3
**Estimate:** S

### Story 6.2: Implement Dashboard Layout with Sidebar Navigation

As a **developer**, I want a consistent layout with sidebar navigation,
So that all pages share a common structure and navigation is intuitive.

**Acceptance Criteria:**
- Given the dashboard, When loaded, Then a sidebar is visible with links: Overview, Sessions, Events, Analytics, Alerts, Settings
- Given any sidebar link, When clicked, Then the main content area navigates to the corresponding page without full reload
- Given the current page, When inspected in the sidebar, Then it is visually highlighted
- Given a narrow viewport (< 768px), When the dashboard is viewed, Then the sidebar collapses to a hamburger menu

**Technical Notes:**
- Files: `packages/dashboard/src/App.tsx`, `packages/dashboard/src/components/Layout.tsx`
- Page structure per Arch §8.1 — sidebar + main content area
- React Router v6 with `<Outlet />` for nested routes
- Tailwind responsive classes for mobile collapse

**Dependencies:** Story 6.1
**Estimate:** M

### Story 6.3: Implement API Client for Dashboard

As a **developer**, I want a typed API client for the dashboard,
So that all pages fetch data consistently with error handling.

**Acceptance Criteria:**
- Given the API client, When calling `getEvents(query)`, Then it makes a GET request to `/api/events` with proper query params
- Given the API client, When calling `getSessions(query)`, Then it makes a GET request to `/api/sessions`
- Given the API client, When the server returns a non-200 response, Then a typed error is thrown
- Given the API client, When used in React, Then it integrates with hooks for loading/error states

**Technical Notes:**
- Files: `packages/dashboard/src/api/client.ts`, `packages/dashboard/src/hooks/useApi.ts`
- Typed fetch wrappers using core types from `@agentlens/core`
- Base URL derived from `window.location.origin` (SPA served by same server)
- Custom hook `useApi()` wrapping `useState`/`useEffect` for data fetching

**Dependencies:** Story 6.1, Story 2.1
**Estimate:** S

### Story 6.4: Implement Overview Page with Metrics Cards

As an **engineering manager**, I want an overview page showing today's key metrics,
So that I can assess system health at a glance.

**Acceptance Criteria:**
- Given the Overview page (`/`), When loaded, Then four metric cards are displayed: Sessions Today, Events Today, Errors Today, Active Agents
- Given each metric card, When rendered, Then it shows the current value and a trend indicator (↑/↓/—) comparing to the previous 24h period
- Given the metrics, When the page loads, Then data is fetched from `GET /api/analytics` and `GET /api/stats`
- Given a loading state, When data is being fetched, Then skeleton placeholders are shown

**Technical Notes:**
- Files: `packages/dashboard/src/pages/Overview.tsx`, `packages/dashboard/src/components/MetricsGrid.tsx`
- MetricsGrid per Arch §8.4 — card layout with label, value, change, trend, icon
- Fetch from `/api/analytics?from=<24h ago>&to=<now>` and `/api/stats`

**Dependencies:** Story 6.3, Story 4.7
**Estimate:** M

### Story 6.5: Implement Overview Page Charts and Feeds

As an **engineering manager**, I want charts and activity feeds on the overview page,
So that I can spot trends and recent issues quickly.

**Acceptance Criteria:**
- Given the Overview page, When loaded, Then an "Events Over Time" bar chart shows hourly event counts for the last 24h
- Given the Overview page, When loaded, Then a "Recent Sessions" list shows the 10 most recent sessions with agent name, status icon, and relative time
- Given the Overview page, When loaded, Then a "Recent Errors" feed shows the 10 most recent error events
- Given a session in the recent list, When clicked, Then it navigates to the session detail page
- Given the chart, When hovering a bar, Then a tooltip shows the exact count and time bucket

**Technical Notes:**
- File: `packages/dashboard/src/pages/Overview.tsx` (continuation)
- Chart library: Recharts (or lightweight alternative) per Arch §8.5
- Fetch events-over-time from `/api/analytics` with `granularity=hour`
- Recent sessions: `/api/sessions?limit=10&order=desc`
- Recent errors: `/api/events?severity=error&limit=10&order=desc`

**Dependencies:** Story 6.4
**Estimate:** M

---

## Epic 7: Dashboard — Sessions & Timeline

**Goal:** Build the Sessions list page and Session Detail page with the interactive timeline — the core debugging experience.

**Delivers:** The primary user experience: finding sessions and inspecting their event timelines.

### Story 7.1: Implement Sessions List Page with Filters

As a **developer**, I want a sessions list page with filtering and sorting,
So that I can quickly find the session I need to investigate.

**Acceptance Criteria:**
- Given the Sessions page (`/sessions`), When loaded, Then a table of sessions is displayed with columns: Agent, Status, Started, Duration, Events, Errors, Tags
- Given the filter bar, When I select an agent from the dropdown, Then the list filters to that agent's sessions
- Given the status multi-select, When I select "error", Then only failed sessions are shown
- Given column headers, When I click "Started", Then the table sorts by start time
- Given more than 50 sessions, When the page loads, Then pagination controls are shown at the bottom

**Technical Notes:**
- Files: `packages/dashboard/src/pages/Sessions.tsx`, `packages/dashboard/src/components/SessionList.tsx`
- Sessions page per PRD §12 Page 2
- Fetch from `/api/sessions` with query params for filters
- Status badges: ✅ completed, ❌ error, 🔄 active

**Dependencies:** Story 6.3
**Estimate:** M

### Story 7.2: Implement Session Detail Page Header

As a **developer**, I want a session detail page with agent info and status,
So that I immediately understand the context of the session I'm inspecting.

**Acceptance Criteria:**
- Given the Session Detail page (`/sessions/:id`), When loaded, Then it shows: agent name, version, status badge, duration, event count, error count, tags
- Given the session header, When the session is still active, Then a pulsing "running" indicator is shown
- Given a back button (`← Sessions`), When clicked, Then it navigates back to the sessions list
- Given the session is not found, When the page loads, Then a 404 message is displayed

**Technical Notes:**
- File: `packages/dashboard/src/pages/SessionDetail.tsx`
- Session detail layout per PRD §12 Page 3
- Fetch from `/api/sessions/:id`
- Status badges with color coding: green (completed), red (error), blue (active)

**Dependencies:** Story 7.1
**Estimate:** S

### Story 7.3: Implement Session Timeline Component

As a **developer**, I want a vertical timeline showing all events in chronological order,
So that I can trace the full decision path of an agent session.

**Acceptance Criteria:**
- Given the timeline, When rendered, Then events are displayed vertically in ascending timestamp order with time markers on the left
- Given each event in the timeline, When rendered, Then it shows: timestamp, event type icon, name, and duration (if applicable)
- Given a `tool_call`/`tool_response` pair, When rendered, Then they are shown as a single expandable node with duration between them
- Given different event types, When rendered, Then they have distinct colors: green (success), red (error), blue (info), yellow (warning), purple (approval)
- Given a hash chain, When the timeline loads, Then a chain validity indicator (✓ valid / ✗ broken) is shown at the top

**Technical Notes:**
- File: `packages/dashboard/src/components/Timeline.tsx`
- Timeline per Arch §8.4 and PRD §12 Page 3
- Fetch from `/api/sessions/:id/timeline`
- Tool call/response pairing via `callId` in payload
- `chainValid` boolean from the timeline API response

**Dependencies:** Story 7.2, Story 4.6
**Estimate:** L

### Story 7.4: Implement Event Detail Panel

As a **developer**, I want to click an event and see its full payload in a detail panel,
So that I can inspect the exact data for debugging.

**Acceptance Criteria:**
- Given an event in the timeline, When I click it, Then a side panel opens showing the full event details
- Given the detail panel, When rendered, Then it shows: full JSON payload with syntax highlighting, event metadata, timing info, severity, hash
- Given a JSON payload, When rendered, Then it uses a collapsible tree viewer for nested objects
- Given the detail panel is open, When I click another event, Then the panel updates to show the new event
- Given the detail panel, When I click a close button or press Escape, Then the panel closes

**Technical Notes:**
- File: `packages/dashboard/src/components/EventCard.tsx` (or `EventDetailPanel.tsx`)
- Event detail per PRD §12 Page 3 — right panel
- JSON syntax highlighting (use a lightweight lib like `react-json-view-lite` or custom with Tailwind)
- Panel slides in from the right with animation

**Dependencies:** Story 7.3
**Estimate:** M

### Story 7.5: Implement Timeline Event Type Filters

As a **developer**, I want to filter the timeline by event type,
So that I can focus on specific categories (errors, tool calls, approvals).

**Acceptance Criteria:**
- Given filter buttons below the timeline header, When "Errors" is selected, Then only events with severity `error` or `critical` are shown
- Given filter buttons, When "Tool Calls" is selected, Then only `tool_call`, `tool_response`, `tool_error` events are shown
- Given filter buttons, When "All" is selected, Then all events are shown (default)
- Given a filter is active, When inspected, Then the button is visually highlighted and the event count updates

**Technical Notes:**
- File: `packages/dashboard/src/pages/SessionDetail.tsx` (filter controls)
- Filter buttons per PRD §12 Page 3: All, Tool Calls, Errors, Approvals, Custom
- Client-side filtering on the already-fetched timeline data (no additional API call)

**Dependencies:** Story 7.3
**Estimate:** S

### Story 7.6: Implement Virtual Scrolling for Large Timelines

As a **developer**, I want the timeline to perform well with 1,000+ events,
So that large sessions don't cause UI lag.

**Acceptance Criteria:**
- Given a session with 1,000 events, When the timeline renders, Then it completes in < 1s (per NFR5)
- Given a session with 1,000 events, When scrolling the timeline, Then scrolling is smooth (60fps)
- Given the virtual scroller, When only 30 events are visible, Then only ~30 DOM elements exist in the viewport
- Given the timeline scrolls, When new events enter the viewport, Then they render seamlessly

**Technical Notes:**
- Use a virtual scrolling library (e.g., `@tanstack/react-virtual` or `react-window`)
- Only render visible events + small overscan buffer
- Critical for NFR5 performance target

**Dependencies:** Story 7.3
**Estimate:** M

---

## Epic 8: Dashboard — Events Explorer & Settings

**Goal:** Build the Events Explorer page for cross-session event querying and the Settings page for configuration management.

**Delivers:** Advanced event exploration and server configuration capabilities in the dashboard.

### Story 8.1: Implement Events Explorer Page

As a **developer**, I want an events page to search and filter events across all sessions,
So that I can find specific events without knowing which session they belong to.

**Acceptance Criteria:**
- Given the Events page (`/events`), When loaded, Then a table of events is displayed with columns: Timestamp, Type, Name, Agent, Session, Level, Duration
- Given the filter bar, When I select event types, levels, agent, and time range, Then the table filters accordingly
- Given a free-text search input, When I type and submit, Then events matching the search in name or payload are shown
- Given an event row, When I click it, Then it either expands inline or navigates to the session with that event highlighted
- Given the table, When pagination is needed, Then offset-based pagination controls are shown

**Technical Notes:**
- File: `packages/dashboard/src/pages/EventsExplorer.tsx`
- Events page per PRD §12 Page 4
- Fetch from `/api/events` with all filter query params
- Multi-select dropdowns for eventType and severity filters
- Date range picker for from/to

**Dependencies:** Story 6.3, Story 4.5
**Estimate:** M

### Story 8.2: Implement Agents Page

As an **engineering manager**, I want an agents page showing all registered agents,
So that I can see which agents are active and their key statistics.

**Acceptance Criteria:**
- Given the Agents page (`/agents`), When loaded, Then each known agent is displayed as a card with: name, last seen, session count, error rate
- Given an agent card, When clicked, Then it navigates to the sessions page filtered by that agent
- Given agents, When sorted, Then they are ordered by last seen (most recent first)

**Technical Notes:**
- File: `packages/dashboard/src/pages/Agents.tsx`
- Agents page per PRD §12 Page 5
- Fetch from `/api/agents`
- Card layout with Tailwind grid

**Dependencies:** Story 6.3, Story 4.7
**Estimate:** S

### Story 8.3: Implement Settings Page — API Key Management

As a **developer**, I want to manage API keys from the dashboard,
So that I can create keys for new agents and revoke compromised keys.

**Acceptance Criteria:**
- Given the Settings page (`/settings`), When loaded, Then a list of existing API keys is shown (name, created date, last used, scopes — NOT the key itself)
- Given a "Create Key" button, When clicked, Then a form appears for name and scopes
- Given a new key is created, When the response arrives, Then the raw key is displayed once with a "Copy" button and a warning to save it
- Given an existing key, When "Revoke" is clicked, Then a confirmation dialog appears; on confirm the key is revoked

**Technical Notes:**
- File: `packages/dashboard/src/pages/Settings.tsx`
- Settings per PRD §12 Page 6
- Fetch from `/api/keys` (list), `POST /api/keys` (create), `DELETE /api/keys/:id` (revoke)
- Show raw key only once in a dismissable banner

**Dependencies:** Story 6.3, Story 4.3
**Estimate:** M

### Story 8.4: Implement Settings Page — Configuration

As a **developer**, I want to view and adjust server configuration from the dashboard,
So that I can manage retention, integrations, and display preferences.

**Acceptance Criteria:**
- Given the Settings page, When the "Configuration" section loads, Then current retention days and other settings are displayed
- Given the integration config section, When viewed, Then it shows fields for AgentGate webhook URL/secret and FormBridge webhook URL/secret
- Given a setting is changed, When saved, Then the configuration is updated (or a note explains restart is required)

**Technical Notes:**
- File: `packages/dashboard/src/pages/Settings.tsx` (configuration tab)
- Display-only for MVP; actual config changes may require env var updates and server restart
- Show current values from `/api/stats` or a dedicated config endpoint

**Dependencies:** Story 8.3
**Estimate:** S

### Story 8.5: Serve Dashboard SPA from Hono Server

As a **developer**, I want the dashboard served from the same process as the API,
So that deployment is a single binary with no separate frontend server.

**Acceptance Criteria:**
- Given a production build of the dashboard, When the Hono server starts, Then static assets are served from `/*` routes
- Given a deep link like `/sessions/abc123`, When accessed directly, Then the SPA's `index.html` is returned (client-side routing)
- Given an API route `/api/*`, When accessed, Then it is handled by the API (not the SPA fallback)
- Given the server, When started, Then both API and dashboard are available on the same port

**Technical Notes:**
- File: `packages/server/src/index.ts` (static serving)
- Implementation per Arch §7.3 — `serveStatic` for assets, fallback to `index.html`
- Dashboard `dist/` output copied to server's `public/` directory during build
- Build script in root `package.json` to orchestrate: build dashboard → copy to server/public → build server

**Dependencies:** Story 6.1, Story 4.1
**Estimate:** S

---

## Epic 9: AgentGate Integration

**Goal:** Receive, transform, and display approval events from AgentGate in the AgentLens timeline.

**Delivers:** Unified timeline showing agent tool calls alongside human approval decisions from AgentGate.

### Story 9.1: Implement AgentGate Webhook Receiver Endpoint

As a **developer**, I want an endpoint that receives webhooks from AgentGate,
So that approval events flow into AgentLens automatically.

**Acceptance Criteria:**
- Given `POST /api/events/ingest` with `source: "agentgate"`, When called, Then the webhook is accepted
- Given a valid HMAC-SHA256 signature header, When verified against the configured secret, Then the webhook is processed
- Given an invalid or missing signature, When the webhook arrives, Then a 401 response is returned
- Given the `AGENTGATE_WEBHOOK_SECRET` env var, When configured, Then it is used for signature verification

**Technical Notes:**
- File: `packages/server/src/routes/ingest.ts`
- Webhook verification per Arch §10.2 — HMAC-SHA256 with `timingSafeEqual`
- Secret from `AGENTGATE_WEBHOOK_SECRET` env var per Arch Appendix A
- Header: `X-Webhook-Signature` (matching AgentGate's `signPayload` format)

**Dependencies:** Story 4.4
**Estimate:** S

### Story 9.2: Implement AgentGate Event Mapping

As a **developer**, I want AgentGate webhook payloads mapped to AgentLens events,
So that approval events integrate seamlessly into the event model.

**Acceptance Criteria:**
- Given `request.created` from AgentGate, When mapped, Then it becomes an `approval_requested` event with fields: requestId, action, params, urgency
- Given `request.approved` from AgentGate, When mapped, Then it becomes an `approval_granted` event with: requestId, decidedBy, reason
- Given `request.denied` from AgentGate, When mapped, Then it becomes an `approval_denied` event with: requestId, decidedBy, reason
- Given `request.expired` from AgentGate, When mapped, Then it becomes an `approval_expired` event with: requestId

**Technical Notes:**
- File: `packages/server/src/routes/ingest.ts` (mapping logic)
- Event mapping per Arch §9.1 table
- Use `ApprovalRequestedPayload`, `ApprovalDecisionPayload` types from core

**Dependencies:** Story 9.1, Story 2.1
**Estimate:** M

### Story 9.3: Implement Session Correlation for AgentGate Events

As a **developer**, I want AgentGate approval events correlated with the correct agent session,
So that approvals appear in the right session timeline.

**Acceptance Criteria:**
- Given an AgentGate webhook with `context.agentlens_session_id`, When processed, Then the event is linked to that session
- Given an AgentGate webhook without a session ID, When processed, Then the event is stored as "unlinked" with `sessionId: null`
- Given an unlinked event, When a matching agent and time proximity are found, Then a manual correlation option is available
- Given a correlated approval event, When viewed in the session timeline, Then it appears at the correct timestamp position

**Technical Notes:**
- Session correlation per PRD §10 — extract `agentlens_session_id` from webhook's `context` field
- Store unlinked events with `sessionId: null` for later manual correlation
- Agent matching by `agentId` from webhook context

**Dependencies:** Story 9.2
**Estimate:** M

### Story 9.4: Render Approval Events in Dashboard Timeline

As a **developer**, I want approval events visually distinct in the timeline,
So that I can immediately identify human approval points in the agent's workflow.

**Acceptance Criteria:**
- Given an `approval_requested` event in the timeline, When rendered, Then it shows a ⏳ icon with "Approval Requested" label and the action being approved
- Given an `approval_granted` event, When rendered, Then it shows a ✅ icon with "Approved" label and who approved
- Given an `approval_denied` event, When rendered, Then it shows a ❌ icon with "Denied" label and reason
- Given an `approval_expired` event, When rendered, Then it shows a ⏰ icon with "Expired" label
- Given a request→decision pair, When rendered, Then the waiting duration is shown between them

**Technical Notes:**
- File: `packages/dashboard/src/components/Timeline.tsx` (extend for approval types)
- Visual styling per PRD FR-P1-1.4
- Duration between request_created and request_decided calculated from timestamps

**Dependencies:** Story 7.3, Story 9.3
**Estimate:** M

### Story 9.5: Add AgentGate Integration Configuration to Settings

As a **developer**, I want to configure AgentGate webhook settings from the Settings page,
So that I can set up the integration without editing environment variables.

**Acceptance Criteria:**
- Given the Settings page, When the "Integrations" section loads, Then AgentGate configuration fields are shown: webhook URL (read-only, showing the endpoint), webhook secret
- Given the webhook secret field, When updated and saved, Then the new secret is stored
- Given the integration section, When a test webhook button is clicked, Then a test event is sent and verification status is shown

**Technical Notes:**
- File: `packages/dashboard/src/pages/Settings.tsx` (integrations tab)
- Display the receiver URL: `{serverUrl}/api/events/ingest`
- Secret management may need a dedicated API endpoint

**Dependencies:** Story 8.4, Story 9.1
**Estimate:** S

---

## Epic 10: FormBridge Integration

**Goal:** Receive, transform, and display form submission events from FormBridge in the AgentLens timeline.

**Delivers:** Unified timeline showing data flow events (form creation, submission, delivery) alongside agent activity.

### Story 10.1: Implement FormBridge Webhook Receiver Endpoint

As a **developer**, I want an endpoint that receives webhooks from FormBridge,
So that form submission events flow into AgentLens automatically.

**Acceptance Criteria:**
- Given `POST /api/events/ingest` with `source: "formbridge"`, When called, Then the webhook is accepted
- Given a valid HMAC-SHA256 signature, When verified against the configured secret, Then the webhook is processed
- Given an invalid or missing signature, When the webhook arrives, Then a 401 response is returned
- Given `FORMBRIDGE_WEBHOOK_SECRET` env var, When configured, Then it is used for verification

**Technical Notes:**
- File: `packages/server/src/routes/ingest.ts` (extend)
- Same verification pattern as AgentGate (Arch §10.2)
- Secret from `FORMBRIDGE_WEBHOOK_SECRET` env var

**Dependencies:** Story 9.1 (shared ingest endpoint)
**Estimate:** S

### Story 10.2: Implement FormBridge Event Mapping

As a **developer**, I want FormBridge webhook payloads mapped to AgentLens events,
So that form lifecycle events integrate into the event model.

**Acceptance Criteria:**
- Given `submission.created` from FormBridge, When mapped, Then it becomes a `form_submitted` event with: submissionId, formId, formName, fieldCount
- Given `submission.completed` from FormBridge, When mapped, Then it becomes a `form_completed` event with: submissionId, completedBy, durationMs
- Given `submission.expired` from FormBridge, When mapped, Then it becomes a `form_expired` event with: submissionId

**Technical Notes:**
- File: `packages/server/src/routes/ingest.ts` (mapping logic)
- Event mapping per Arch §9.2 table
- Use `FormSubmittedPayload`, `FormCompletedPayload` types from core

**Dependencies:** Story 10.1, Story 2.1
**Estimate:** S

### Story 10.3: Implement Session Correlation for FormBridge Events

As a **developer**, I want FormBridge events correlated with the correct agent session,
So that data flow events appear in the right timeline.

**Acceptance Criteria:**
- Given a FormBridge webhook with `context.agentlens_session_id`, When processed, Then the event is linked to that session
- Given a FormBridge webhook without a session ID, When processed, Then the event is stored as unlinked
- Given a correlated form event, When viewed in the session timeline, Then it appears at the correct timestamp

**Technical Notes:**
- Same correlation pattern as AgentGate (Story 9.3)
- Extract `agentlens_session_id` from webhook context

**Dependencies:** Story 10.2
**Estimate:** S

### Story 10.4: Render FormBridge Events in Dashboard Timeline

As a **developer**, I want form submission events visually distinct in the timeline,
So that I can see data handoff points in the agent's workflow.

**Acceptance Criteria:**
- Given a `form_submitted` event in the timeline, When rendered, Then it shows a 📋 icon with form name and field count
- Given a `form_completed` event, When rendered, Then it shows a ✅ icon with completion time and who completed it
- Given a `form_expired` event, When rendered, Then it shows a ⏰ icon with expiration info
- Given a submission→completed pair, When rendered, Then the duration between them is shown

**Technical Notes:**
- File: `packages/dashboard/src/components/Timeline.tsx` (extend for form types)
- Visual styling for form events — distinct from approval events
- Duration calculation between form_submitted and form_completed

**Dependencies:** Story 7.3, Story 10.3
**Estimate:** S

---

## Epic 11: Cost Tracking & Analytics

**Goal:** Add cost tracking to events and sessions, and build analytics endpoints and dashboard charts.

**Delivers:** Token usage and cost visibility per session, per agent, and over time.

### Story 11.1: Add Cost Fields to Event Model and Ingestion

As a **developer**, I want events to carry optional cost information,
So that token usage and costs are tracked alongside agent activity.

**Acceptance Criteria:**
- Given an event with `eventType: "cost_tracked"` and `CostTrackedPayload`, When ingested, Then the cost data (provider, model, inputTokens, outputTokens, costUsd) is stored
- Given a cost event for a session, When the session is queried, Then `totalCostUsd` is incremented
- Given cost data, When ingested, Then session aggregates (totalTokensInput, totalTokensOutput, estimatedCostUsd) are updated

**Technical Notes:**
- `CostTrackedPayload` type from Arch §4.1
- Update session materialization in `insertEvents()` to increment cost fields
- Cost fields on session record per PRD FR-P1-3.2

**Dependencies:** Story 3.4, Story 2.1
**Estimate:** S

### Story 11.2: Implement Analytics Endpoints

As an **engineering manager**, I want analytics API endpoints,
So that the dashboard can show aggregated metrics and trends.

**Acceptance Criteria:**
- Given `GET /api/analytics`, When called with `from`, `to`, and `granularity`, Then bucketed metrics are returned per `AnalyticsResult` type
- Given `GET /api/analytics/costs`, When called, Then cost breakdown by agent and time period is returned
- Given `GET /api/analytics/agents`, When called, Then per-agent metrics (session count, error rate, avg duration, total cost) are returned
- Given `GET /api/analytics/tools`, When called, Then tool usage statistics (frequency, avg duration, error rate per tool) are returned

**Technical Notes:**
- File: `packages/server/src/routes/analytics.ts`
- Routes per Arch §7.1
- Delegate to `store.getAnalytics()` with appropriate grouping
- Default time range: last 24h

**Dependencies:** Story 3.5, Story 4.1
**Estimate:** M

### Story 11.3: Implement Analytics Dashboard Page

As an **engineering manager**, I want a dedicated analytics page with charts,
So that I can visualize trends in agent activity, errors, and costs.

**Acceptance Criteria:**
- Given the Analytics page (`/analytics`), When loaded, Then it shows: Events Over Time chart, Error Rate trend, Tool Usage breakdown, Cost Over Time chart
- Given time range controls, When I select a different range (24h, 7d, 30d), Then all charts update
- Given the cost chart, When rendered, Then it shows cost by agent with stacked bars
- Given the tool usage chart, When rendered, Then it shows a bar/pie chart of most-used tools

**Technical Notes:**
- File: `packages/dashboard/src/pages/Analytics.tsx`
- Analytics page per Arch §8.2
- Recharts for charting per Arch §8.5
- Fetch from `/api/analytics`, `/api/analytics/costs`, `/api/analytics/tools`

**Dependencies:** Story 11.2, Story 6.3
**Estimate:** M

### Story 11.4: Add Cost Column to Sessions Page

As an **engineering manager**, I want cost displayed in the sessions list,
So that I can identify expensive agent sessions.

**Acceptance Criteria:**
- Given the Sessions page, When loaded, Then a "Cost" column shows estimated USD cost per session
- Given sessions with no cost data, When rendered, Then the cost column shows "—"
- Given the sessions list, When sorted by cost, Then sessions are ordered by `estimatedCostUsd` descending

**Technical Notes:**
- File: `packages/dashboard/src/pages/Sessions.tsx` (add column)
- Cost data already available from session API response

**Dependencies:** Story 7.1, Story 11.1
**Estimate:** S

### Story 11.5: Add Cost Summary to Session Detail Page

As a **developer**, I want cost breakdown on the session detail page,
So that I can see which tool calls were most expensive.

**Acceptance Criteria:**
- Given the session detail page, When the session has cost data, Then a "Cost" section shows: total cost, total input tokens, total output tokens
- Given cost_tracked events in the timeline, When rendered, Then they show a 💰 icon with cost amount
- Given the cost section, When there are multiple cost events, Then a breakdown by model/provider is shown

**Technical Notes:**
- File: `packages/dashboard/src/pages/SessionDetail.tsx` (cost section)
- Filter cost_tracked events from timeline for breakdown
- Display in session header alongside duration and event count

**Dependencies:** Story 7.2, Story 11.1
**Estimate:** S

---

## Epic 12: Alerting System

**Goal:** Implement configurable alert rules that trigger when thresholds are exceeded, with webhook delivery and dashboard visibility.

**Delivers:** Proactive monitoring: alerts for error spikes, cost overruns, and anomalies.

### Story 12.1: Implement Alert Rule CRUD Endpoints

As a **developer**, I want API endpoints to create, read, update, and delete alert rules,
So that alerting can be configured programmatically.

**Acceptance Criteria:**
- Given `POST /api/alerts/rules` with valid rule data, When called, Then a new alert rule is created and returned
- Given `GET /api/alerts/rules`, When called, Then all alert rules are listed
- Given `PUT /api/alerts/rules/:id` with updates, When called, Then the rule is updated
- Given `DELETE /api/alerts/rules/:id`, When called, Then the rule is deleted
- Given a rule with condition `error_rate_exceeds`, threshold `0.1`, windowMinutes `60`, When created, Then it is persisted correctly

**Technical Notes:**
- File: `packages/server/src/routes/alerts.ts`
- Routes per Arch §7.1
- AlertRule schema per Arch §6.2 — `alertRules` table
- AlertCondition types: error_rate_exceeds, cost_exceeds, latency_exceeds, event_count_exceeds, no_events_for

**Dependencies:** Story 3.2, Story 4.1
**Estimate:** M

### Story 12.2: Implement Alert Evaluation Engine

As a **developer**, I want alert rules evaluated periodically against recent data,
So that alerts trigger when conditions are met.

**Acceptance Criteria:**
- Given an alert rule with `error_rate_exceeds: 0.1` and `windowMinutes: 60`, When the error rate in the last 60 minutes exceeds 10%, Then the alert triggers
- Given an alert rule with `cost_exceeds: 10.0` and `windowMinutes: 1440`, When daily cost exceeds $10, Then the alert triggers
- Given the evaluation interval, When configured via `ALERT_CHECK_INTERVAL_MS`, Then rules are evaluated at that interval (default: 60s)
- Given an alert triggers, When evaluated, Then an `alert_triggered` event is stored in the alert history table

**Technical Notes:**
- File: `packages/server/src/lib/alert-engine.ts`
- Runs on setInterval per Arch Appendix A (`ALERT_CHECK_INTERVAL_MS`)
- Queries analytics for each rule's window to compute current values
- Stores history in `alertHistory` table per Arch §6.2

**Dependencies:** Story 12.1, Story 3.5
**Estimate:** M

### Story 12.3: Implement Alert Webhook Delivery

As a **developer**, I want alerts delivered to configured webhook URLs,
So that teams are notified when something goes wrong.

**Acceptance Criteria:**
- Given an alert triggers, When the rule has webhook URLs in `notifyChannels`, Then an HTTP POST is sent to each URL with alert details
- Given the webhook payload, When inspected, Then it includes: alertRuleId, alertName, condition, currentValue, threshold, message, timestamp
- Given a webhook delivery fails, When the POST returns non-2xx, Then the failure is logged but does not block other deliveries
- Given alert channels include "console", When triggered, Then the alert is also logged to the server console

**Technical Notes:**
- File: `packages/server/src/lib/alert-engine.ts` (delivery logic)
- Use native `fetch()` for webhook POST
- Alert channels per PRD FR-P1-4.2: webhook (generic), console log
- Fire-and-forget delivery; don't retry for MVP

**Dependencies:** Story 12.2
**Estimate:** S

### Story 12.4: Implement Alerts Dashboard Page

As an **engineering manager**, I want a dashboard page showing active alerts and alert history,
So that I can monitor and manage alerting configuration.

**Acceptance Criteria:**
- Given the Alerts page (`/alerts`), When loaded, Then active (triggered, unresolved) alerts are shown at the top
- Given the alerts page, When "Rules" tab is selected, Then all alert rules are listed with: name, condition, threshold, enabled toggle
- Given the "History" tab, When selected, Then past alert triggers are shown with: timestamp, rule name, value, threshold, resolved status
- Given a rule, When the "Create Rule" button is clicked, Then a form appears for configuring a new alert rule

**Technical Notes:**
- File: `packages/dashboard/src/pages/Alerts.tsx`
- Alerts page per Arch §8.2
- Fetch from `/api/alerts/rules` and `/api/alerts/history`
- CRUD via `/api/alerts/rules` endpoints

**Dependencies:** Story 12.1, Story 6.3
**Estimate:** M

### Story 12.5: Integrate Alerts with SSE for Real-Time Notification

As an **engineering manager**, I want alert triggers to appear in the dashboard in real-time,
So that I'm notified immediately when something needs attention.

**Acceptance Criteria:**
- Given an alert triggers, When the dashboard is open, Then an alert notification appears (toast/banner)
- Given the SSE stream, When an `alert` event is received, Then the alerts page updates without manual refresh
- Given the overview page, When an alert is active, Then a warning indicator is shown in the metrics area

**Technical Notes:**
- Emit alert events on the EventBus per Arch §11.1
- SSE `alert` event type per Arch §7.2
- Dashboard subscribes to SSE alert events

**Dependencies:** Story 14.1, Story 12.2
**Estimate:** S

---

## Epic 13: SDK & CLI

**Goal:** Build the programmatic TypeScript SDK and command-line interface for querying and managing AgentLens data.

**Delivers:** `@agentlens/sdk` and `@agentlens/cli` — tools for developers who prefer code or terminal over the dashboard.

### Story 13.1: Implement SDK HTTP Client

As a **developer**, I want a typed TypeScript SDK for the AgentLens API,
So that I can integrate AgentLens queries into my own tools and scripts.

**Acceptance Criteria:**
- Given `new AgentLensClient({ url, apiKey })`, When created, Then the client is configured with the server URL and API key
- Given `client.queryEvents(query)`, When called, Then it returns typed `EventQueryResult`
- Given `client.getSessions(query)`, When called, Then it returns typed sessions array
- Given `client.getSessionTimeline(sessionId)`, When called, Then it returns the full timeline with chain validity
- Given a server error, When the client receives a non-2xx response, Then a typed `AgentLensError` is thrown

**Technical Notes:**
- Files: `packages/sdk/src/client.ts`, `packages/sdk/src/errors.ts`, `packages/sdk/src/index.ts`
- Package per Arch ADR-005 — thin wrapper over `fetch()`
- Re-export core types from `@agentlens/core`
- Works in Node.js and browser (uses native `fetch`)

**Dependencies:** Story 2.1, Story 4.5
**Estimate:** M

### Story 13.2: Implement CLI Entrypoint and Configuration

As a **developer**, I want a CLI tool (`agentlens`) for terminal-based querying,
So that I can inspect agent data without opening a browser.

**Acceptance Criteria:**
- Given `npx @agentlens/cli`, When run with no args, Then help text is displayed with available commands
- Given `agentlens config set url http://localhost:3400`, When run, Then the URL is saved to `~/.agentlens/config.json`
- Given `agentlens config set api-key als_xxx`, When run, Then the API key is saved to config
- Given `agentlens config get`, When run, Then current configuration is displayed (with key partially masked)

**Technical Notes:**
- Files: `packages/cli/src/index.ts`, `packages/cli/src/commands/config.ts`, `packages/cli/src/lib/config.ts`
- Commander.js ^12.x per Arch §12.1
- Config stored in `~/.agentlens/config.json`
- Uses `@agentlens/sdk` for all API access per Arch ADR-005

**Dependencies:** Story 13.1
**Estimate:** S

### Story 13.3: Implement CLI Events Command

As a **developer**, I want to query events from the terminal,
So that I can quickly check recent agent activity.

**Acceptance Criteria:**
- Given `agentlens events`, When run, Then the 20 most recent events are displayed in a table
- Given `agentlens events --session ses_abc`, When run, Then events for that session are shown
- Given `agentlens events --type tool_call --limit 50`, When run, Then up to 50 tool_call events are shown
- Given `agentlens events --json`, When run, Then raw JSON output is produced (for piping)

**Technical Notes:**
- File: `packages/cli/src/commands/events.ts`
- Table output using `console.table` or custom formatting per Arch §3.1 (`output.ts`)
- Use SDK's `client.queryEvents()` method

**Dependencies:** Story 13.2
**Estimate:** S

### Story 13.4: Implement CLI Sessions Command

As a **developer**, I want to list and inspect sessions from the terminal,
So that I can find and debug sessions without the dashboard.

**Acceptance Criteria:**
- Given `agentlens sessions`, When run, Then recent sessions are listed with: id, agent, status, started, duration, events
- Given `agentlens sessions show ses_abc`, When run, Then session details and a summary timeline are displayed
- Given `agentlens sessions --status error`, When run, Then only failed sessions are shown
- Given `agentlens sessions --agent my-agent`, When run, Then sessions are filtered by agent

**Technical Notes:**
- File: `packages/cli/src/commands/sessions.ts`
- Use SDK's `client.getSessions()` and `client.getSessionTimeline()`
- Timeline summary: show event type, name, timestamp in a compact format

**Dependencies:** Story 13.2
**Estimate:** S

### Story 13.5: Implement CLI Tail Command (Live Stream)

As a **developer**, I want to tail live events from the terminal,
So that I can monitor agent activity in real-time during development.

**Acceptance Criteria:**
- Given `agentlens tail`, When run, Then new events are streamed to the terminal as they arrive
- Given `agentlens tail --session ses_abc`, When run, Then only events for that session are streamed
- Given `agentlens tail --type error`, When run, Then only error events are streamed
- Given Ctrl+C, When pressed, Then the stream disconnects gracefully

**Technical Notes:**
- File: `packages/cli/src/commands/tail.ts`
- Connect to SSE endpoint `/api/stream` with EventSource (or `eventsource` npm package for Node.js)
- Format events as they arrive with timestamps and colors

**Dependencies:** Story 14.1, Story 13.2
**Estimate:** M

---

## Epic 14: Real-Time Updates (SSE)

**Goal:** Implement Server-Sent Events for live dashboard updates, replacing polling with push-based updates.

**Delivers:** Live-updating dashboard pages that show new events and session updates as they happen.

### Story 14.1: Implement SSE Endpoint and EventBus

As a **developer**, I want an SSE endpoint that streams events to connected clients,
So that the dashboard and CLI can receive real-time updates.

**Acceptance Criteria:**
- Given `GET /api/stream`, When connected via EventSource, Then SSE events are streamed
- Given filter params `?sessionId=X&agentId=Y&eventType=tool_call`, When connected, Then only matching events are streamed
- Given a new event is ingested, When the EventBus emits it, Then all connected SSE clients with matching filters receive it
- Given heartbeat interval (30s), When no events occur, Then `heartbeat` messages keep the connection alive
- Given an SSE client disconnects, When the connection is aborted, Then the event listener is cleaned up

**Technical Notes:**
- Files: `packages/server/src/lib/event-bus.ts`, `packages/server/src/lib/sse.ts`, `packages/server/src/routes/stream.ts`
- EventBus per Arch §11.1 — extends `EventEmitter` with `setMaxListeners(1000)`
- SSE implementation per Arch §11.3 — `ReadableStream` with `TextEncoder`
- SSE message types: `event`, `session_update`, `alert`, `heartbeat` per Arch §7.2

**Dependencies:** Story 4.4 (event ingestion emits to bus)
**Estimate:** M

### Story 14.2: Implement `useSSE` Hook for Dashboard

As a **developer**, I want a React hook for SSE connections in the dashboard,
So that pages can subscribe to real-time updates declaratively.

**Acceptance Criteria:**
- Given `useSSE({ url, params, onEvent })`, When the component mounts, Then an EventSource connection is established
- Given the hook, When `connected` state changes, Then the component can show a connection indicator
- Given the component unmounts, When cleanup runs, Then the EventSource is closed
- Given a connection error, When EventSource reconnects automatically, Then the hook handles the reconnection

**Technical Notes:**
- File: `packages/dashboard/src/hooks/useSSE.ts`
- Implementation per Arch §8.3
- Auto-reconnect is built into the browser's `EventSource` API
- Parameters serialized to URL query string

**Dependencies:** Story 14.1, Story 6.1
**Estimate:** S

### Story 14.3: Integrate SSE into Session Detail Page

As a **developer**, I want the session timeline to update live when new events arrive,
So that I can watch an active session's progress in real-time.

**Acceptance Criteria:**
- Given a session with status "active", When viewing its detail page, Then new events appear in the timeline as they are ingested
- Given a live session, When a new event arrives via SSE, Then it animates into the timeline at the correct position
- Given the session ends, When a `session_ended` event arrives, Then the status badge updates and the "running" indicator stops
- Given a connection indicator, When SSE is connected, Then a green dot is shown; when disconnected, a yellow warning

**Technical Notes:**
- Use `useSSE({ url: '/api/stream', params: { sessionId } })` in SessionDetail page
- Append new events to the timeline state on SSE `event` messages
- Update session metadata on `session_update` messages

**Dependencies:** Story 14.2, Story 7.3
**Estimate:** M

### Story 14.4: Integrate SSE into Overview and Events Pages

As an **engineering manager**, I want the overview page metrics and events page to update live,
So that I see current system activity without manual refreshing.

**Acceptance Criteria:**
- Given the Overview page, When new events arrive via SSE, Then the "Events Today" counter increments in real-time
- Given the Overview's "Recent Sessions" list, When a session update arrives, Then the list refreshes
- Given the Events page, When a new event arrives via SSE, Then it appears at the top of the event list (if matching current filters)
- Given a stale data condition, When the SSE connection drops, Then a "Connection lost — data may be stale" indicator appears

**Technical Notes:**
- Use `useSSE` on Overview and Events pages
- Optimistic counter increment on event receipt; periodic full refresh for accuracy
- Stale indicator per NFR15

**Dependencies:** Story 14.2, Story 6.5, Story 8.1
**Estimate:** M

---

## Epic 15: Documentation & Launch

**Goal:** Create comprehensive documentation, prepare npm packages for publishing, and produce demo content.

**Delivers:** VitePress docs site, published npm packages, README, and demo content for adoption.

### Story 15.1: Set Up VitePress Documentation Site

As a **developer**, I want a documentation site,
So that users can learn how to install, configure, and use AgentLens.

**Acceptance Criteria:**
- Given the docs directory, When `pnpm docs:dev` is run, Then a VitePress dev server starts
- Given the docs site, When navigated, Then it has sections: Getting Started, Guide, API Reference, Architecture
- Given the landing page, When viewed, Then it shows AgentLens branding, key features, and quick start command
- Given `pnpm docs:build`, When run, Then static docs are generated for deployment

**Technical Notes:**
- Directory: `docs/` per Arch §3.1
- VitePress ^1.x per Arch §12.1
- `.vitepress/config.ts` with sidebar, nav, and theme configuration

**Dependencies:** Story 1.1
**Estimate:** S

### Story 15.2: Write Getting Started Guide

As a **developer**, I want a quick start guide,
So that I can get AgentLens running in under 5 minutes.

**Acceptance Criteria:**
- Given the guide, When followed, Then a developer can: install the server, create an API key, configure an MCP agent, and see events in the dashboard
- Given the guide, When it includes code snippets, Then they are copy-pasteable and tested
- Given the guide sections, When listed, Then they include: Installation, Quick Start, Configuration, Adding to Your Agent
- Given the MCP configuration example, When copied, Then it works with Claude Desktop and Cursor

**Technical Notes:**
- File: `docs/guide/getting-started.md`
- Include: `npx @agentlens/server` for quick start
- MCP config example per Arch §5.4

**Dependencies:** Story 15.1, Story 5.1, Story 4.1
**Estimate:** M

### Story 15.3: Write API Reference Documentation

As a **developer**, I want complete API reference docs,
So that I can build integrations against the AgentLens API.

**Acceptance Criteria:**
- Given each API endpoint, When documented, Then it includes: method, path, description, request parameters, request body schema, response schema, example
- Given the Events API section, When read, Then all event endpoints are documented with examples
- Given the Sessions API section, When read, Then all session endpoints are documented
- Given the Integrations section, When read, Then webhook setup for AgentGate and FormBridge is documented

**Technical Notes:**
- File: `docs/reference/api.md`
- Document all endpoints from Arch §7.1
- Include curl examples and TypeScript SDK examples
- Reference Zod schemas for request validation

**Dependencies:** Story 15.1
**Estimate:** M

### Story 15.4: Prepare npm Publishing Configuration

As a **developer**, I want packages ready for npm publishing,
So that users can install AgentLens packages from npm.

**Acceptance Criteria:**
- Given each publishable package (core, mcp, server, sdk, cli), When `package.json` is inspected, Then it has: correct name, version, description, license (MIT), repository, keywords, files, main/types entries
- Given the `@agentlens/mcp` package, When inspected, Then it has a `bin` entry for `agentlens-mcp`
- Given the `@agentlens/cli` package, When inspected, Then it has a `bin` entry for `agentlens`
- Given `pnpm build`, When run, Then all packages compile and their dist directories contain the expected output

**Technical Notes:**
- Configure `"files"` field in each `package.json` to include only `dist/`
- `"type": "module"` for ESM
- `"bin"` entries for mcp and cli packages
- `"exports"` field for proper ESM resolution

**Dependencies:** Story 1.3
**Estimate:** S

### Story 15.5: Create README and Demo Content

As a **developer evaluating AgentLens**, I want a compelling README with demo screenshots,
So that I understand the value proposition and can decide to try it.

**Acceptance Criteria:**
- Given the root README.md, When read, Then it includes: project description, key features, screenshot/demo GIF, quick start, architecture overview, link to docs
- Given the demo content, When viewed, Then it shows the dashboard with realistic data (sessions, timeline, analytics)
- Given feature badges, When shown, Then they include: npm version, license, build status, GitHub stars
- Given the README, When it describes the AgentKit ecosystem, Then it links to AgentGate and FormBridge

**Technical Notes:**
- File: `README.md` in project root
- Demo GIF: capture a session of the dashboard showing a timeline
- Include ASCII architecture diagram
- Badges from shields.io

**Dependencies:** Story 6.5, Story 7.3
**Estimate:** M

---

## Requirements Coverage Map

### Functional Requirements Coverage

| Requirement | Story | Status |
|---|---|---|
| FR1: MCP tools (session_start, log_event, session_end) | 5.1, 5.2, 5.3, 5.4 | ✅ Covered |
| FR2: MCP auto-capture tool call/result events | 5.3 (via explicit log_event) | ✅ Covered (explicit mode per ADR-001) |
| FR3: Event fields (timestamp, type, sessionId, agentId, payload, duration) | 2.1 | ✅ Covered |
| FR4: MCP event buffering and batch flush | 5.6 | ✅ Covered |
| FR5: MCP stdio and SSE transport | 5.1 | ✅ Covered (stdio MVP; SSE future) |
| FR6: MCP config (API URL, agent name, version, env, tags) | 5.1, 5.2 | ✅ Covered |
| FR7: Append-only events table | 3.2, 3.4 | ✅ Covered |
| FR8: Sessions table with computed fields | 3.2, 3.4 | ✅ Covered |
| FR9: SQLite WAL mode | 3.3 | ✅ Covered |
| FR10: Automatic retention policy | 3.6 | ✅ Covered |
| FR11: Drizzle ORM with migrations | 3.2, 3.3 | ✅ Covered |
| FR12: POST /api/events (batch ingestion) | 4.4 | ✅ Covered |
| FR13: GET /api/events, GET /api/events/:id | 4.5 | ✅ Covered |
| FR14: Session endpoints (list, detail, events) | 4.6 | ✅ Covered |
| FR15: Query filtering (type, session, agent, time, status, tags) | 4.5, 4.6 | ✅ Covered |
| FR16: Cursor-based pagination | 4.5, 4.6 | ✅ Covered |
| FR17: API key authentication | 4.2, 4.3 | ✅ Covered |
| FR18: Sessions list page | 7.1 | ✅ Covered |
| FR19: Session detail page with timeline | 7.2, 7.3 | ✅ Covered |
| FR20: Events page (filterable) | 8.1 | ✅ Covered |
| FR21: Event detail panel (JSON viewer) | 7.4 | ✅ Covered |
| FR22: Dashboard served by Hono server | 8.5 | ✅ Covered |
| FR23: Responsive layout | 6.2 | ✅ Covered |
| FR24: AgentGate webhook receiver | 9.1 | ✅ Covered |
| FR25: AgentGate event mapping | 9.2 | ✅ Covered |
| FR26: Approval session correlation | 9.3 | ✅ Covered |
| FR27: Approval events distinct styling | 9.4 | ✅ Covered |
| FR28: Webhook HMAC-SHA256 verification | 9.1 | ✅ Covered |
| FR29: FormBridge webhook receiver | 10.1 | ✅ Covered |
| FR30: FormBridge event mapping | 10.2 | ✅ Covered |
| FR31: Form data flow tracking | 10.3 | ✅ Covered |
| FR32: FormBridge events in timeline | 10.4 | ✅ Covered |
| FR33: Optional cost field on events | 11.1 | ✅ Covered |
| FR34: Session cost summary | 11.1, 11.5 | ✅ Covered |
| FR35: Dashboard cost charts | 11.3, 11.4 | ✅ Covered |
| FR36: GET /api/analytics/costs | 11.2 | ✅ Covered |
| FR37: Alert rules (error rate, cost, duration) | 12.1, 12.2 | ✅ Covered |
| FR38: Alert channels (webhook, console) | 12.3 | ✅ Covered |
| FR39: Alert history in dashboard | 12.4 | ✅ Covered |
| FR40: Alert rule CRUD API | 12.1 | ✅ Covered |

### Non-Functional Requirements Coverage

| Requirement | Story | Status |
|---|---|---|
| NFR1: ≥ 1,000 events/sec throughput | 3.4, 4.4 (batch insert, WAL) | ✅ Covered |
| NFR2: P95 < 5ms ingestion latency | 3.4, 4.4 (batch transactions) | ✅ Covered |
| NFR3: Dashboard < 2s initial, < 500ms nav | 6.1, 8.5 (Vite SPA, code split) | ✅ Covered |
| NFR4: Query P95 < 100ms | 3.2, 3.5 (indexes, bounded queries) | ✅ Covered |
| NFR5: Timeline < 1s for 1,000 events | 7.6 (virtual scrolling) | ✅ Covered |
| NFR6: ~500 byte events, 10KB truncation | 2.5, 4.4 (payload truncation) | ✅ Covered |
| NFR7: 90-day retention, configurable | 3.6 | ✅ Covered |
| NFR8: API key auth, SHA-256 hash storage | 4.2, 4.3 | ✅ Covered |
| NFR9: Payload sanitization/redaction | 4.4 (configurable patterns) | ⚠️ Partial — FR exists, implementation deferred to post-MVP |
| NFR10: HMAC-SHA256 webhook verification | 9.1, 10.1 | ✅ Covered |
| NFR11: Configurable CORS | 4.1 | ✅ Covered |
| NFR12: No outbound calls except alert webhooks | 4.1, 12.3 | ✅ Covered |
| NFR13: MCP buffer 10K events if server unreachable | 5.6 | ✅ Covered |
| NFR14: Append-only, no DELETE on events | 3.2, 3.4 | ✅ Covered |
| NFR15: Dashboard stale data indicator | 14.4 | ✅ Covered |

### Additional Requirements Coverage

| Requirement | Story | Status |
|---|---|---|
| AR1: ULID for event IDs | 2.5, 4.4 | ✅ Covered |
| AR2: SHA-256 hash chain per session | 2.4, 4.4 | ✅ Covered |
| AR3: In-process EventBus | 14.1 | ✅ Covered |
| AR4: SSE endpoint for real-time updates | 14.1 | ✅ Covered |
| AR5: Dedicated MCP tools approach | 5.1–5.5 | ✅ Covered |
| AR6: agentlens_query_events MCP tool | 5.5 | ✅ Covered |
| AR7: SQLite-first with PostgreSQL alt | 3.3 | ✅ Covered |
| AR8: Hybrid schema (columns + JSON payload) | 3.2 | ✅ Covered |
| AR9: Six npm packages | 1.3 | ✅ Covered |
| AR10: Health endpoint (no auth) | 4.1 | ✅ Covered |
| AR11: Storage stats endpoint | 4.7 | ✅ Covered |
| AR12: Changesets for versioning | 1.6 | ✅ Covered |
| AR13: VitePress documentation | 15.1 | ✅ Covered |
| AR14: Env var configuration | 4.1 | ✅ Covered |
| AR15: Port 3400 default | 4.1 | ✅ Covered |
| AR16: Alert rule CRUD API | 12.1 | ✅ Covered |
| AR17: Alert history table/endpoint | 12.2, 12.4 | ✅ Covered |
| AR18: Retention enforcement (scheduled) | 3.6 | ✅ Covered |
| AR19: Generic webhook receiver | 9.1 (ingest endpoint handles generic) | ✅ Covered |
| AR20: Agents table auto-created | 3.4, 4.7 | ✅ Covered |

### Coverage Gaps

| Requirement | Status | Notes |
|---|---|---|
| NFR9: Payload sanitization/redaction | ⚠️ Partial | Infrastructure exists in ingestion (Story 4.4) via configurable patterns. Full implementation with configurable regex rules is a post-MVP enhancement. |
| FR5: SSE transport for MCP server | ⚠️ Partial | Stdio transport is the MVP. SSE transport for programmatic agents can be added after core MCP functionality is proven. |

---

## Summary

| Metric | Value |
|---|---|
| **Total Epics** | 15 |
| **Total Stories** | 82 |
| **Small (S) Stories** | 38 |
| **Medium (M) Stories** | 35 |
| **Large (L) Stories** | 1 (Timeline component) |
| **MVP Epics (1-8)** | 8 epics, 51 stories |
| **P1 Epics (9-14)** | 6 epics, 28 stories |
| **Launch Epic (15)** | 1 epic, 5 stories |
| **Requirements Covered** | 40 FR + 15 NFR + 20 AR = 75 total |
| **Requirements with Gaps** | 2 (partial coverage, not blockers) |

### Recommended Implementation Order

**Phase 1 — MVP (Epics 1-8, ~6 weeks):**
1. Epic 1: Project Foundation (Week 1)
2. Epic 2: Core Types (Week 1)
3. Epic 3: Storage Layer (Week 2)
4. Epic 4: REST API (Week 2-3)
5. Epic 5: MCP Server (Week 3)
6. Epic 6: Dashboard Layout & Overview (Week 4)
7. Epic 7: Dashboard Sessions & Timeline (Week 4-5)
8. Epic 8: Dashboard Events & Settings (Week 5-6)

**Phase 2 — Integrations (Epics 9-14, ~4 weeks):**
9. Epic 9: AgentGate Integration (Week 7)
10. Epic 10: FormBridge Integration (Week 7)
11. Epic 11: Cost Tracking & Analytics (Week 8)
12. Epic 12: Alerting System (Week 9)
13. Epic 14: Real-Time Updates/SSE (Week 9)
14. Epic 13: SDK & CLI (Week 10)

**Phase 3 — Launch (Epic 15, ~1 week):**
15. Epic 15: Documentation & Launch (Week 11)

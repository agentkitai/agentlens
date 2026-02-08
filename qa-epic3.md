# QA Report — Epic 3 (Stories 3.1–3.6)

Scope reviewed:
- Source: `packages/server/src/**`
- Criteria source: `_bmad-output/planning-artifacts/epics.md` (Epic 3 only)
- Verification run: `pnpm --filter @agentlensai/server test` → **PASS** (4 files, 77 tests)

## Story 3.1 — Define Storage Interface (IEventStore)

1. `IEventStore` includes required methods (`insertEvents`, `queryEvents`, `getEvent`, `getSessionTimeline`, `countEvents`, `upsertSession`, `querySessions`, `getSession`, `upsertAgent`, `listAgents`, `getAgent`, `getAnalytics`, `createAlertRule`, `updateAlertRule`, `deleteAlertRule`, `listAlertRules`, `getAlertRule`, `applyRetention`, `getStats`)  
   **PASS** — `SqliteEventStore` implements all listed methods in `packages/server/src/db/sqlite-store.ts`.
2. `AnalyticsResult` includes `buckets` and `totals`  
   **PASS** — `getAnalytics()` returns `{ buckets, totals }` shape in `packages/server/src/db/sqlite-store.ts`.
3. `StorageStats` includes `totalEvents`, `totalSessions`, `totalAgents`, `oldestEvent`, `newestEvent`, `storageSizeBytes`  
   **PASS** — `getStats()` returns all required fields in `packages/server/src/db/sqlite-store.ts`.

## Story 3.2 — Implement SQLite Schema with Drizzle ORM

1. `schema.sqlite.ts` defines tables `events`, `sessions`, `agents`, `alertRules`, `alertHistory`, `apiKeys`  
   **PASS** — present in `packages/server/src/db/schema.sqlite.ts`.
2. `events` table has required columns (id, timestamp, sessionId, agentId, eventType, severity, payload, metadata, prevHash, hash)  
   **PASS** — present in `packages/server/src/db/schema.sqlite.ts`.
3. `sessions` table has required columns (id, agentId, agentName, startedAt, endedAt, status enum, eventCount, toolCallCount, errorCount, totalCostUsd, tags)  
   **PASS** — present in `packages/server/src/db/schema.sqlite.ts`.
4. Required indexes exist (`idx_events_timestamp`, `idx_events_session_id`, `idx_events_agent_id`, `idx_events_type`, `idx_events_session_ts`, `idx_events_agent_type_ts`, `idx_sessions_agent_id`, `idx_sessions_started_at`, `idx_sessions_status`, `idx_api_keys_hash`)  
   **PASS** — defined in schema and verified by tests in `packages/server/src/db/__tests__/init.test.ts`.

## Story 3.3 — Implement Database Initialization and Migration Runner

1. Fresh start/no DB file → server startup creates DB at configured path with all tables/indexes  
   **FAIL** — DB creation/migration helpers exist (`createDb`, `runMigrations`), but server startup wiring is not implemented in `packages/server/src/index.ts` (only exports a constant).
2. `DB_DIALECT=sqlite` → `createDb()` returns Drizzle SQLite with WAL, NORMAL synchronous, 64MB cache, 5s busy timeout  
   **PASS** — pragmas are applied in `packages/server/src/db/index.ts`; verified in `packages/server/src/db/__tests__/init.test.ts`.
3. `DB_DIALECT=postgresql` → `createDb()` returns Drizzle PostgreSQL with pooling  
   **FAIL** — explicit runtime error: PostgreSQL “not yet implemented” in `packages/server/src/db/index.ts`.
4. Schema change migrations update DB without data loss  
   **FAIL** — migration runner only uses `CREATE TABLE/INDEX IF NOT EXISTS`; no versioned/alter migration mechanism for schema evolution in `packages/server/src/db/migrate.ts`.

## Story 3.4 — Implement SQLite Event Store — Write Operations

1. `insertEvents()` inserts batch in a single transaction  
   **PASS** — implemented via `this.db.transaction(...)` in `packages/server/src/db/sqlite-store.ts`; covered by tests.
2. Existing session aggregates increment (`eventCount`, `toolCallCount`, `errorCount`)  
   **PASS** — increment logic implemented in `_handleSessionUpdate()`; covered by tests.
3. New agent auto-created via `upsertAgent()`  
   **FAIL** — agent auto-creation exists, but is implemented via private `_handleAgentUpsert()` logic, not via `upsertAgent()` call path.
4. Batch of 100 events completes in `< 50ms`  
   **FAIL** — performance test asserts `< 500ms`, not `< 50ms`, in `packages/server/src/db/__tests__/sqlite-store-write.test.ts`.
5. `session_started` creates session with `active` status  
   **PASS** — implemented in `_handleSessionUpdate()` and validated by tests.
6. `session_ended` updates `endedAt` and `status`  
   **PASS** — implemented in `_handleSessionUpdate()` and validated by tests.

## Story 3.5 — Implement SQLite Event Store — Read Operations

1. `queryEvents()` with `sessionId` filter returns only that session, ordered by timestamp  
   **PASS** — filter + `orderBy(timestamp)` implemented and tested.
2. `queryEvents()` with `eventType` + `severity` applies both filters  
   **PASS** — combined conditions implemented and tested.
3. `queryEvents()` with `from`/`to` returns only in-range events  
   **PASS** — range filters implemented and tested.
4. `getSessionTimeline(sessionId)` returns all session events in ascending timestamp order  
   **PASS** — implemented with `orderBy(asc(timestamp))`; tested.
5. `querySessions()` with `agentId` and `status` returns matching sessions with total count  
   **PASS** — filters + total count implemented and tested.
6. `getAnalytics()` returns bucketed metrics (`eventCount`, `toolCallCount`, `errorCount`, `avgLatencyMs`, `totalCostUsd`)  
   **FAIL** — `avgLatencyMs` and `totalCostUsd` are hardcoded to `0` (not computed from event payloads) in `packages/server/src/db/sqlite-store.ts`.

## Story 3.6 — Implement Retention Policy Engine

1. `RETENTION_DAYS=90` deletes events older than 90 days  
   **PASS** — cutoff computation + deletion implemented in `packages/server/src/lib/retention.ts` and `packages/server/src/db/sqlite-store.ts`; tested.
2. `applyRetention()` returns `{ deletedCount: number }`  
   **PASS** — store method returns `{ deletedCount }`; wrapper includes this field (plus `skipped`).
3. `RETENTION_DAYS=0` keeps events forever (no deletion)  
   **PASS** — explicit skip path implemented and tested.
4. Retention run also cleans sessions with no remaining events  
   **PASS** — session cleanup SQL included in store `applyRetention()`; tested.

## Summary

- Total Epic 3 criteria checked: **27**
- **PASS:** 21
- **FAIL:** 6

Failing criteria are concentrated in Story 3.3 (startup/bootstrap, PostgreSQL path, schema-evolution migration strategy), Story 3.4 (strict upsertAgent call path and NFR threshold), and Story 3.5 (analytics latency/cost computation).

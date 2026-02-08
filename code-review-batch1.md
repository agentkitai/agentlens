# Code Review Batch 1

## Scope Reviewed
- `packages/core/src/storage.ts`
- `packages/core/src/constants.ts`
- `packages/core/src/types.ts`
- `packages/core/src/events.ts`
- `packages/core/src/index.ts`
- `packages/core/src/hash.ts`
- `packages/core/src/schemas.ts`
- `packages/server/src/index.ts`
- `packages/server/src/db/sqlite-store.ts`
- `packages/server/src/db/schema.sqlite.ts`
- `packages/server/src/db/migrate.ts`
- `packages/server/src/db/index.ts`
- `packages/server/src/lib/retention.ts`

## Findings

### CRITICAL

| Severity | File and line range | What's wrong | How to fix |
|---|---|---|---|
| CRITICAL | `packages/core/src/hash.ts:12-20`, `packages/core/src/hash.ts:31-40`, `packages/core/src/types.ts:233-246` | Hash coverage is incomplete. `severity` and `metadata` are part of `AgentLensEvent` but are not included in hash input, so those fields can be tampered with while chain verification still passes. | Expand `HashableEvent` and `computeEventHash()` to include every immutable event field (`severity`, `metadata`, and any future integrity-critical fields). Version the hash format to avoid silent incompatibility. |
| CRITICAL | `packages/core/src/hash.ts:47-77` | `verifyChain()` only checks `prevHash` pointers; it never recomputes each event hash from event contents. An attacker can alter payload + recompute hashes and still pass verification. | Change verification to accept full events, recompute each hash with `computeEventHash()`, verify `event.hash` equality for every row, and verify link continuity (`prevHash`). |
| CRITICAL | `packages/server/src/db/sqlite-store.ts:36-65` | `insertEvents()` persists caller-supplied `hash`/`prevHash` without validating chain continuity or hash correctness. Storage accepts forged/broken chains. | Enforce integrity at write-time inside the transaction: fetch latest hash per session, validate `prevHash`, recompute hash server-side, reject mismatches. Do not trust caller-supplied `hash`. |
| CRITICAL | `packages/server/src/db/sqlite-store.ts:43-56`, `packages/server/src/db/sqlite-store.ts:71-127`, `packages/server/src/db/sqlite-store.ts:181-213` | Write path uses select-then-insert patterns without upsert semantics. Under concurrent writers/processes this can race into uniqueness failures and roll back the whole batch (event loss at ingest boundary). | Use `onConflictDoUpdate`/`INSERT ... ON CONFLICT` for `sessions` and `agents`, and make event ingest idempotent (dedupe by event ID or conflict policy that preserves already-written events safely). |

### HIGH

| Severity | File and line range | What's wrong | How to fix |
|---|---|---|---|
| HIGH | `packages/server/src/db/index.ts:47-50`, `packages/server/src/db/schema.sqlite.ts:92-95` | `foreign_keys` pragma is never enabled. SQLite foreign key constraints are off by default, so `alert_history.rule_id -> alert_rules.id` is not actually enforced. | Add `sqlite.pragma('foreign_keys = ON')` during DB init and verify it in `verifyPragmas()`. |
| HIGH | `packages/server/src/db/sqlite-store.ts:720-727` | Tag filtering logic is incorrect: comment says "any tag", but implementation adds one condition per tag (AND semantics), and uses string `LIKE` which causes false positives (e.g., `prod` matches `production`). | Use JSON-aware exact matching with `json_each(tags)` and OR semantics for "any" (or explicit mode for any/all). |
| HIGH | `packages/server/src/db/sqlite-store.ts:442-447`, `packages/server/src/db/sqlite-store.ts:477-479` | `granularity: 'week'` is not implemented; code currently groups by day for week requests. | Use true week bucketing (`strftime('%Y-%W', ...)` + canonical week-start timestamp) or aggregate day buckets into weeks before returning. |
| HIGH | `packages/server/src/db/sqlite-store.ts:510-511`, `packages/server/src/db/sqlite-store.ts:518-519` | Analytics fields `avgLatencyMs` and `totalCostUsd` are always zero, yielding incorrect analytics despite events containing relevant data (`tool_response`, `cost_tracked`). | Compute these from payload JSON using SQLite JSON functions (`json_extract`) and include in both bucket and totals queries. |
| HIGH | `packages/server/src/db/sqlite-store.ts:90`, `packages/server/src/db/sqlite-store.ts:741-742`, `packages/server/src/db/sqlite-store.ts:760`, `packages/server/src/db/sqlite-store.ts:783-784` | Multiple `JSON.parse()` calls are unguarded; malformed JSON rows crash read paths and can abort writes (`existingSession.tags`). | Add a safe JSON parse helper with controlled fallback/error wrapping; validate JSON before persistence where possible. |
| HIGH | `packages/core/src/schemas.ts:38-47`, `packages/core/src/types.ts:196-210` | Zod ingestion schema is far looser than TypeScript event payload types. `payload: z.record(z.unknown())` accepts structures that are not valid `EventPayload` variants. | Implement event-type-aware discriminated payload schemas and infer `IngestEventInput` from those schemas so runtime validation matches TS contracts. |
| HIGH | `packages/server/src/db/sqlite-store.ts:252` | `upsertSession()` inserts `agentId: ''` when missing. This creates invalid domain data even though DB constraint is satisfied. | For inserts, require `agentId` and throw a typed validation error if absent; do not synthesize empty identifiers. |
| HIGH | `packages/server/src/db/sqlite-store.ts:546-570` | Alert rule update/delete paths do not check affected row count and silently succeed on missing IDs; callers cannot detect failed writes. | Inspect mutation result metadata and throw a domain "not found" error when zero rows are affected. |

### MEDIUM

| Severity | File and line range | What's wrong | How to fix |
|---|---|---|---|
| MEDIUM | `packages/server/src/db/migrate.ts:11-21`, `packages/server/src/db/migrate.ts:22-117` | Function claims to "create/update" schema, but only uses `CREATE ... IF NOT EXISTS`. Existing deployments will not receive column/index changes. | Use versioned migrations (Drizzle migration files) or explicit ALTER-path migrations with schema version tracking. |
| MEDIUM | `packages/server/src/db/sqlite-store.ts:593-614` | `applyRetention()` computes `deletedCount` before the deletion transaction. Concurrent writes/deletes can make returned count inaccurate. | Perform count + delete in a single transaction snapshot, or return SQLite `changes()` from the delete statement. |
| MEDIUM | `packages/core/src/events.ts:84-86`, `packages/core/src/constants.ts:11-12` | Payload size guard claims bytes but checks `serialized.length` (UTF-16 code units). Multi-byte content can exceed the byte budget while passing validation. | Measure with `Buffer.byteLength(serialized, 'utf8')` and keep constant comments aligned with actual units. |
| MEDIUM | `packages/server/src/lib/retention.ts:24-31` | Retention env parsing is permissive (`parseInt`), so invalid values like `"30days"` are silently accepted as `30`; negative values are silently skipped. | Use strict numeric parsing/validation (`/^-?\d+$/` + bounds) and emit explicit configuration errors for invalid values. |
| MEDIUM | `packages/server/src/db/sqlite-store.ts:228-238`, `packages/server/src/db/sqlite-store.ts:279-283`, `packages/server/src/db/sqlite-store.ts:550-558` | Update payloads are built with `Record<string, unknown>`, weakening compile-time safety for Drizzle updates. | Use typed update objects (`Partial<typeof table.$inferInsert>` or table-specific picked types) to preserve type guarantees. |

### LOW

| Severity | File and line range | What's wrong | How to fix |
|---|---|---|---|
| LOW | `packages/server/src/lib/retention.ts:18`, `packages/core/src/constants.ts:15` | `DEFAULT_RETENTION_DAYS` is duplicated across packages, risking drift. | Reuse `@agentlensai/core` constant in server retention code. |
| LOW | `packages/server/src/db/sqlite-store.ts:308` | Comment says read operations are "stubs" but methods are implemented; comment is stale and misleading. | Update/remove stale comment. |
| LOW | `packages/server/src/index.ts:1-4` | Package entrypoint is a placeholder constant only; no server bootstrap exports despite module docstring indicating HTTP server package surface. | Export actual public server bootstrap API (or correct the file-level docs if intentionally minimal). |

## Requested Verification Checks

| Check | Status | Evidence |
|---|---|---|
| All `IEventStore` interface methods implemented in `sqlite-store.ts` | PASS | `SqliteEventStore` includes all interface methods (`insertEvents`, `queryEvents`, `getEvent`, `getSessionTimeline`, `countEvents`, `upsertSession`, `querySessions`, `getSession`, `upsertAgent`, `listAgents`, `getAgent`, `getAnalytics`, alert CRUD, `applyRetention`, `getStats`). |
| Hash chain is cryptographically sound | FAIL | Hash excludes `severity`/`metadata`, verification does not recompute hashes, and storage does not enforce chain validity on write. |
| Zod schemas match TypeScript types | PARTIAL FAIL | Event/severity enums align, but payload validation is too permissive relative to `EventPayload` union. |
| SQLite pragmas correctly set | PARTIAL | `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size`, `busy_timeout` are set; `foreign_keys=ON` missing. |
| Batch inserts use transactions | PASS | `insertEvents()` wraps batch writes in `this.db.transaction(...)`. |
| All indexes from architecture are created | PASS (SQLite) | `idx_events_timestamp`, `idx_events_session_id`, `idx_events_agent_id`, `idx_events_type`, `idx_events_session_ts`, `idx_events_agent_type_ts`, `idx_sessions_agent_id`, `idx_sessions_started_at`, `idx_sessions_status`, `idx_alert_history_rule_id`, `idx_api_keys_hash` are defined in schema and migration SQL. (`idx_events_payload` is PostgreSQL-specific in architecture §6.3.) |

## Files With No Substantive Findings
- `packages/core/src/storage.ts`
- `packages/core/src/constants.ts`
- `packages/core/src/index.ts`
- `packages/server/src/db/schema.sqlite.ts` (structure/index definitions themselves are solid)

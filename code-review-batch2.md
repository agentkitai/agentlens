# Code Review — Batch 2 (Epics 4-5)
## Summary
I reviewed the requested REST API and MCP server files, plus their tests, and ran `pnpm typecheck` and `pnpm test` (both pass).

Main result: there are **blocking contract mismatches** between the MCP client and REST API that make core MCP write tools fail against the real server. I also found several high-risk correctness/security issues around fail-open auth configuration and pagination bounds.

## CRITICAL Issues
1. **MCP write path is incompatible with REST ingestion contract (Correctness, API Design).**
`AgentLensTransport.sendEventImmediate()` sends a single event object to `POST /api/events`, but REST expects `{ events: [...] }` (`packages/mcp/src/transport.ts:86`, `packages/mcp/src/transport.ts:91` vs `packages/server/src/routes/events.ts:24`, `packages/server/src/routes/events.ts:32`). This causes 400 validation failures for session start/log/end calls.

2. **Buffered flush endpoint does not exist on server (Correctness).**
Transport flush posts to `/api/events/batch` (`packages/mcp/src/transport.ts:130`), but there is no matching server route under `packages/server/src/routes/events.ts`. Buffered events cannot be delivered in real deployments.

3. **`agentlens_log_event` / `agentlens_session_end` emit invalid events (`agentId` empty) (Correctness, Type Safety).**
Both tools set `agentId: ''` (`packages/mcp/src/tools.ts:116`, `packages/mcp/src/tools.ts:179`), while server ingestion requires non-empty `agentId` (`packages/core/src/schemas.ts:168`). Even after request-shape fixes, these tools still fail validation.

## HIGH Issues
1. **Auth can silently fail open when `createApp()` is used without `db` (Security, Architecture).**
Auth middleware is only attached when `db` exists (`packages/server/src/index.ts:80`), but protected routes are still mounted (`packages/server/src/index.ts:93`). Any embedding that calls `createApp(store)` without `db` exposes unauthenticated `/api/events`, `/api/sessions`, `/api/agents`, `/api/stats`.

2. **Negative `limit`/`offset` values are accepted, enabling unbounded reads (Performance, API Design).**
Routes parse `limit`/`offset` without lower bounds (`packages/server/src/routes/events.ts:149`, `packages/server/src/routes/sessions.ts:37`). Store then applies `Math.min(limit, 500)` (`packages/server/src/db/sqlite-store.ts:372`, `packages/server/src/db/sqlite-store.ts:436`), so `limit=-1` remains `-1` (SQLite interprets this as no effective limit), enabling very large responses.

3. **Retention config contradicts documented behavior for `0` (Correctness).**
Comment says `0 = keep forever` (`packages/server/src/config.ts:14`), but parser uses `parseInt(...) || 90` (`packages/server/src/config.ts:28`), so `RETENTION_DAYS=0` is coerced to `90`.

4. **Batch ingest can partially commit then fail (Correctness).**
`POST /api/events` processes per-session groups and inserts each group independently (`packages/server/src/routes/events.ts:62`, `packages/server/src/routes/events.ts:106`). If a later session insert fails (e.g., hash continuity conflict), earlier groups remain committed while client receives error, violating all-or-nothing expectations.

5. **MCP module has import side effects: server starts on import (Architecture, Testability).**
`main()` is invoked unconditionally (`packages/mcp/src/index.ts:61`). Importing this module in another process/test can unexpectedly connect stdio and alter process behavior.

## MEDIUM Issues
1. **API key creation lacks input validation and relies on unsafe casts (Type Safety, Correctness).**
`POST /api/keys` reads JSON and casts `name`/`scopes` directly (`packages/server/src/routes/api-keys.ts:22`, `packages/server/src/routes/api-keys.ts:24`) with no schema checks. Invalid shapes can produce inconsistent stored data or runtime errors.

2. **Large-list endpoints are unpaginated (Performance, API Design).**
`GET /api/keys` and `GET /api/agents` return full tables (`packages/server/src/routes/api-keys.ts:52`, `packages/server/src/routes/agents.ts:17`). This does not scale with key/event volume.

3. **Signal handling in transport is not library-safe (Architecture).**
Each `AgentLensTransport` instance can install process-level handlers (`packages/mcp/src/transport.ts:53`) that call `process.exit(0)` (`packages/mcp/src/transport.ts:59`). In embedded hosts this can terminate unrelated workloads.

4. **No HTTP timeout/backoff in MCP transport (Correctness, Performance).**
All fetch calls (`packages/mcp/src/transport.ts:88`, `packages/mcp/src/transport.ts:110`, `packages/mcp/src/transport.ts:131`) have no timeout or retry policy, so hangs can block tool operations indefinitely.

## LOW Issues
1. **Loose query param validation yields silent bad inputs (API Design, Type Safety).**
`eventType`, `severity`, `status`, and timestamps are mostly pass-through casts/strings (`packages/server/src/routes/events.ts:127`, `packages/server/src/routes/sessions.ts:26`), returning empty data instead of explicit 400s for malformed filter values.

2. **Test suite misses server↔MCP contract integration coverage (Architecture, Testability).**
MCP tests mock `fetch` and assert local behavior (`packages/mcp/src/tools.test.ts:12`, `packages/mcp/src/transport.test.ts:8`), so critical endpoint/body mismatches shipped undetected.

## Positive Observations
- Auth middleware uses hashed API keys with revoked-key checks and updates `lastUsedAt` (`packages/server/src/middleware/auth.ts:64`, `packages/server/src/middleware/auth.ts:70`).
- Event ingestion validates payloads with shared schema and returns structured validation errors (`packages/server/src/routes/events.ts:38`).
- Server tests and MCP tests are extensive for happy-path behavior, and local CI health is good (`pnpm typecheck` + `pnpm test` both passed).
- Storage layer uses parameterized Drizzle queries and avoids raw string interpolation in route-level filters.

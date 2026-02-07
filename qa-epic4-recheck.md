# QA Re-check — Epic 4
## Story 4.1: Bootstrap Hono Server with Middleware
- [PASS] AC1: `startServer()` logs port and listening URL; default port is `3400` via `getConfig()` fallback.
- [PASS] AC2: CORS middleware is applied on `/api/*` with configured `corsOrigin`; covered by `health.test.ts` CORS assertion.
- [PASS] AC3: Request logger middleware is applied on `/api/*`; test run output shows method/path/status timing logs.
- [PASS] AC4: Global `app.onError()` returns JSON `{ error, status }` with propagated status code.
- [PASS] AC5: `GET /api/health` is unauthenticated and returns `{ status: "ok", version: "0.1.0" }` (covered by `health.test.ts`).

## Story 4.2: Implement API Key Authentication Middleware
- [PASS] AC1: Valid `Authorization: Bearer als_xxx` with matching hashed key proceeds (covered by `auth.test.ts`).
- [FAIL] AC2: 401 behavior exists, but response bodies/messages do not match AC text (`Missing API key` / `Invalid API key`); implementation returns `Missing Authorization header`, `Invalid Authorization header format...`, or `Invalid or revoked API key`.
- [PASS] AC3: Revoked API key returns 401 (covered by `auth.test.ts`).
- [PASS] AC4: `AUTH_DISABLED=true` skips auth (covered by `auth.test.ts`).
- [PASS] AC5: Successful auth updates `lastUsedAt` in best-effort fire-and-forget style (non-fatal update path; covered by `auth.test.ts`).

## Story 4.3: Implement API Key Management Endpoints
- [PASS] AC1: `POST /api/keys` creates key from `{ name, scopes }` and returns raw key only in create response (covered by `api-keys.test.ts`).
- [PASS] AC2: `GET /api/keys` returns metadata list and excludes raw key/keyHash (covered by `api-keys.test.ts`).
- [PASS] AC3: `DELETE /api/keys/:id` performs soft revoke by setting `revokedAt` (covered by `api-keys.test.ts`).
- [PASS] AC4: Created key format has `als_` prefix (`als_` + 64 hex chars), verified by test regex.

## Story 4.4: Implement Event Ingestion Endpoint
- [PASS] AC1: `POST /api/events` validates input, assigns ULIDs, computes hash chain, and persists via store insert (covered by `events-ingest.test.ts` + store tests).
- [PASS] AC2: Response includes `{ ingested, events: [{ id, hash }] }` (covered by `events-ingest.test.ts`).
- [PASS] AC3: Invalid/missing required fields return 400 with validation details (covered by `events-ingest.test.ts`).
- [PASS] AC4: Payloads are truncated via `truncatePayload()` with `_truncated: true` indicator when >10KB.
- [FAIL] AC5: No endpoint-level proof for `100 events < 50ms`; current tests assert store-level performance (`100 events < 500ms`) but not this AC target.

## Story 4.5: Implement Event Query Endpoints
- [PASS] AC1: `GET /api/events` defaults to most recent 50 descending (implemented via default page size/order; covered in `events-query.test.ts`).
- [PASS] AC2: Filtering supports combined query params including `sessionId` and `eventType`.
- [PASS] AC3: `from`/`to` time-range filtering works (covered by `events-query.test.ts`).
- [PASS] AC4: `GET /api/events/:id` returns single event when found (covered by `events-query.test.ts`).
- [PASS] AC5: `GET /api/events/:id` returns 404 when missing (covered by `events-query.test.ts`).
- [PASS] AC6: Pagination with `limit`/`offset` returns `{ events, total, hasMore }` (covered by `events-query.test.ts`).

## Story 4.6: Implement Session Endpoints
- [PASS] AC1: `GET /api/sessions` supports filters (`agentId`, `status`, `from`, `to`) and pagination (covered by `sessions.test.ts`).
- [PASS] AC2: `GET /api/sessions/:id` returns session detail including aggregates (`eventCount`, `errorCount`, `totalCostUsd`) from stored session fields.
- [PASS] AC3: `GET /api/sessions/:id/timeline` returns ascending events plus `chainValid` boolean (covered by `sessions.test.ts`).
- [PASS] AC4: Non-existent session returns 404 for detail/timeline (covered by `sessions.test.ts`).

## Story 4.7: Implement Agent and Stats Endpoints
- [PASS] AC1: `GET /api/agents` returns agents with required metadata (`id`, `name`, `firstSeenAt`, `lastSeenAt`, `sessionCount`) (covered by `agents-stats.test.ts`).
- [PASS] AC2: `GET /api/agents/:id` returns single agent and 404 when missing (covered by `agents-stats.test.ts`).
- [PASS] AC3: `GET /api/stats` returns storage stats fields (`totalEvents`, `totalSessions`, `totalAgents`, `oldestEvent`, `newestEvent`, `storageSizeBytes`) (covered by `agents-stats.test.ts`).

## Summary: 30 PASS / 2 FAIL

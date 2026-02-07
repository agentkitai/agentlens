# QA Report - Epic 4: REST API Server

## Story 4.1: Bootstrap Hono Server with Middleware
- [PASS] AC1: Given the server starts, When I check the console, Then it logs the port and URL it's listening on (default port 3400) — `startServer()` logs startup port and listening URL; `getConfig()` defaults `PORT` to `3400`.
- [PASS] AC2: Given a request to any `/api/*` route, When processed, Then CORS headers are included based on `CORS_ORIGIN` config — `app.use('/api/*', cors({ origin: resolvedConfig.corsOrigin }))`; covered by `health.test.ts` CORS assertion.
- [FAIL] AC3: Given a request to any route, When processed, Then the request is logged (method, path, status, duration) — logger middleware is mounted only on `/api/*`, not globally for all routes.
- [PASS] AC4: Given an unhandled error in a route, When it occurs, Then a JSON error response is returned with appropriate status code — global `app.onError()` returns JSON `{ error, status }` with derived status code.
- [PASS] AC5: Given `GET /api/health`, When called without auth, Then it returns `{ status: "ok", version: "0.1.0" }` — implemented directly and validated in `health.test.ts`.

## Story 4.2: Implement API Key Authentication Middleware
- [PASS] AC1: Given a request with valid `Authorization: Bearer als_xxx` header, When the key hash matches a stored key, Then the request proceeds — middleware hashes key and checks non-revoked DB row; covered by `auth.test.ts` valid-key case.
- [FAIL] AC2: Given a request with missing or invalid API key, When processed, Then a 401 response is returned with `{ error: "Missing API key" }` or `{ error: "Invalid API key" }` — status is 401, but error messages differ (`Missing Authorization header`, `Invalid Authorization header format...`, `Invalid or revoked API key`).
- [PASS] AC3: Given a revoked API key, When used in a request, Then a 401 response is returned — revoked keys are filtered and return 401; covered by `auth.test.ts`.
- [PASS] AC4: Given `AUTH_DISABLED=true`, When any request is made, Then authentication is skipped (development mode) — middleware bypasses auth and sets dev apiKey context; covered by `auth.test.ts`.
- [FAIL] AC5: Given a successful auth, When processed, Then `lastUsedAt` is updated asynchronously (fire-and-forget) — `lastUsedAt` is updated inline via synchronous DB call before `next()`, not asynchronously.

## Story 4.3: Implement API Key Management Endpoints
- [PASS] AC1: Given `POST /api/keys` with `{ name, scopes }`, When called, Then a new API key is created and returned (key shown ONLY in this response) — POST returns raw key; list/delete responses do not include raw key.
- [PASS] AC2: Given `GET /api/keys`, When called, Then all keys are listed with metadata (id, name, scopes, createdAt, lastUsedAt) but NOT the key itself — implemented and validated in `api-keys.test.ts`.
- [PASS] AC3: Given `DELETE /api/keys/:id`, When called, Then the key is marked as revoked (soft delete) — sets `revokedAt` timestamp (soft revoke), validated in tests.
- [PASS] AC4: Given a newly created key, When the response is inspected, Then the key starts with `als_` prefix — generated as `als_${randomBytes(32).toString('hex')}` and tested.

## Story 4.4: Implement Event Ingestion Endpoint
- [PASS] AC1: Given `POST /api/events` with `{ events: [...] }`, When called with valid events, Then all events are validated, assigned ULIDs, hashed, and persisted — zod validation + `ulid()` + `computeEventHash()` + `store.insertEvents()`.
- [PASS] AC2: Given a batch of events, When ingested, Then the response includes `{ ingested: number, events: [{ id, hash }] }` — response shape matches exactly, covered by `events-ingest.test.ts`.
- [PASS] AC3: Given an event with missing required fields, When ingested, Then a 400 response with validation errors is returned — returns `400` with `details[]`; covered by tests.
- [PASS] AC4: Given an event with payload > 10KB, When ingested, Then the payload is truncated with a `_truncated: true` indicator — route calls `truncatePayload()`; core truncation logic sets `_truncated: true` for oversized payloads.
- [FAIL] AC5: Given batch ingestion of 100 events, When measured, Then latency is < 50ms (per NFR2) — no explicit performance benchmark/assertion for 100-event latency in server tests.

## Story 4.5: Implement Event Query Endpoints
- [PASS] AC1: Given `GET /api/events` with no filters, When called, Then the most recent 50 events are returned (descending) — defaults to page size 50 and descending order.
- [PASS] AC2: Given `GET /api/events?sessionId=X&eventType=tool_call`, When called, Then only matching events are returned — filters are parsed and applied; covered by query tests.
- [PASS] AC3: Given `GET /api/events?from=X&to=Y`, When called, Then only events within the time range are returned — `from/to` conditions applied; covered by tests.
- [PASS] AC4: Given `GET /api/events/:id`, When called with a valid ID, Then the single event is returned — implemented and tested.
- [PASS] AC5: Given `GET /api/events/:id`, When called with an invalid ID, Then a 404 response is returned — implemented and tested.
- [PASS] AC6: Given pagination params `?limit=20&offset=40`, When called, Then the response includes `{ events, total, hasMore }` — response includes all fields; tested with limit/offset.

## Story 4.6: Implement Session Endpoints
- [PASS] AC1: Given `GET /api/sessions`, When called, Then sessions are returned with filters (agentId, status, from, to) and pagination — filters and pagination implemented and covered by `sessions.test.ts`.
- [PASS] AC2: Given `GET /api/sessions/:id`, When called, Then session details including aggregates (eventCount, errorCount, totalCostUsd) are returned — endpoint returns store session object with aggregate fields; tested.
- [PASS] AC3: Given `GET /api/sessions/:id/timeline`, When called, Then all events for the session are returned in ascending timestamp order with `chainValid` boolean — implemented via `getSessionTimeline()` + `verifyChain()`; tested.
- [PASS] AC4: Given `GET /api/sessions/:id` for a non-existent session, When called, Then a 404 response is returned — implemented and tested.

## Story 4.7: Implement Agent and Stats Endpoints
- [PASS] AC1: Given `GET /api/agents`, When called, Then all known agents are returned with: id, name, firstSeenAt, lastSeenAt, sessionCount — route delegates to store mapping these fields; tested.
- [PASS] AC2: Given `GET /api/agents/:id`, When called, Then a single agent's details are returned — implemented and tested (including 404 path).
- [PASS] AC3: Given `GET /api/stats`, When called, Then storage statistics are returned: totalEvents, totalSessions, totalAgents, oldestEvent, newestEvent, storageSizeBytes — implemented in `getStats()` and validated in tests.

## Summary: 28 PASS / 4 FAIL

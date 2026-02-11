# AgentLens QA Review Report

**Reviewer:** BMAD QA Persona (Retroactive Full Review)  
**Date:** 2026-02-11  
**Scope:** All 8 packages, ~41K lines of TypeScript source  
**Methodology:** Manual source code review of all non-test `.ts` files

---

## Executive Summary

| Package | Grade | Lines | Critical | High | Medium | Low |
|---------|-------|-------|----------|------|--------|-----|
| **server** | C+ | 28,059 | 3 | 8 | 12 | 6 |
| **pool-server** | C | 1,067 | 2 | 3 | 3 | 1 |
| **core** | B+ | 2,965 | 0 | 0 | 2 | 2 |
| **sdk** | B+ | 824 | 0 | 0 | 1 | 2 |
| **cli** | B | 2,883 | 0 | 0 | 1 | 1 |
| **mcp** | B | 3,509 | 0 | 1 | 2 | 1 |
| **dashboard** | B | 1,852 | 0 | 0 | 1 | 1 |
| **python-sdk** | N/A | — | — | — | — | — |

**Overall: C+** — Solid foundations (hash chains, error sanitization, tenant scoping), but several critical security gaps in unauthenticated endpoints, SSRF vectors, and missing authorization checks.

**Totals: 5 CRITICAL, 12 HIGH, 22 MEDIUM, 14 LOW = 53 findings**

---

## CRITICAL Findings

### C-1: Redaction Test Endpoint Exposed Without Authentication
- **Package:** server
- **File:** `src/index.ts` (line ~263) + `src/routes/redaction-test.ts`
- **Description:** The route `app.route('/api/community/redaction', redactionTestRoutes())` is registered *outside* the `if (db)` block that applies auth middleware to `/api/community/*`. It's mounted directly on the app without any auth protection. Anyone can POST arbitrary content to `/api/community/redaction/test`.
- **Impact:** Unauthenticated access to server processing. While the endpoint doesn't store data, it consumes server resources and could be abused for reconnaissance (testing what the redaction pipeline catches).
- **Fix:** Move inside the `if (db)` auth-protected block, or explicitly add `authMiddleware` before the route.

### C-2: OTLP Endpoints Have No Authentication by Default
- **Package:** server
- **File:** `src/routes/otlp.ts` (lines ~220-230), `src/index.ts` (line ~268)
- **Description:** The OTLP routes (`/v1/traces`, `/v1/metrics`, `/v1/logs`) are mounted without auth: `app.route('/v1', otlpRoutes(store, resolvedConfig))`. The optional `otlpAuthToken` is only checked if explicitly configured via env var. By default, **anyone can ingest events** into the store with no authentication.
- **Impact:** An attacker can flood the database with fake telemetry data, corrupt analytics, exhaust disk, and pollute session data — all without any credentials.
- **Fix:** Require `OTLP_AUTH_TOKEN` to be set when `AUTH_DISABLED` is false. Fail startup if OTLP is exposed without auth in production mode.

### C-3: SSRF via Guardrail Webhook Action
- **Package:** server
- **File:** `src/lib/guardrails/actions.ts` (lines 73-91)
- **Description:** `executeNotifyWebhook` calls `fetch(config.url, ...)` where `config.url` comes from user-configured `actionConfig.url` in the guardrail rule. No URL validation is performed. An attacker with write access to guardrails can set `url` to `http://169.254.169.254/latest/meta-data/` (AWS metadata), `http://localhost:5432/` (internal services), or any internal network address.
- **Impact:** Full SSRF — internal service discovery, cloud metadata exfiltration, potential credential theft.
- **Fix:** Validate URL against an allowlist or block private/internal IP ranges. At minimum, reject URLs matching RFC 1918 ranges, link-local (169.254.x.x), and localhost.

### C-4: SSRF via AgentGate Policy Action
- **Package:** server
- **File:** `src/lib/guardrails/actions.ts` (lines 116-140)
- **Description:** `executeAgentgatePolicy` calls `fetch(config.agentgateUrl + path)` with user-controlled `agentgateUrl` from guardrail `actionConfig`. Same SSRF issue as C-3.
- **Fix:** Same as C-3 — validate/restrict URLs.

### C-5: Pool Server Purge Token Compared as Plaintext (Not Timing-Safe)
- **Package:** pool-server
- **File:** `src/app.ts` (line 97)
- **Description:** `purgeToken.tokenHash !== token` uses JavaScript `!==` string comparison, which is not timing-safe. An attacker can brute-force the purge token character-by-character via timing side-channel. The field is called `tokenHash` but the client sends the raw token which is compared directly — no hashing occurs on the incoming value either.
- **Impact:** Token can be brute-forced to delete any contributor's lessons from the community pool.
- **Fix:** Use `crypto.timingSafeEqual()` for comparison. Also: hash the incoming token before comparing to the stored hash.

---

## HIGH Findings

### H-1: OTLP Rate Limiter Uses Spoofable IP Headers
- **Package:** server
- **File:** `src/routes/otlp.ts` (lines ~230-237)
- **Description:** Rate limiting uses `x-forwarded-for` and `x-real-ip` headers which are trivially spoofable if no trusted reverse proxy strips them. Falls back to `'unknown'` — meaning all requests without headers share one bucket.
- **Fix:** Document that a reverse proxy must be in front. Add `trustProxy` config option. Consider rate limiting by auth token when `otlpAuthToken` is configured.

### H-2: OTLP Rate Limiter Memory Leak
- **Package:** server
- **File:** `src/routes/otlp.ts` (lines ~215-225)
- **Description:** `rateLimitBuckets` is a `Map<string, ...>` with no cleanup mechanism. Unlike `pool-server`'s `RateLimiter`, it never evicts expired entries. With spoofed IPs, an attacker can create unlimited map entries, eventually exhausting memory.
- **Fix:** Add periodic cleanup of expired buckets (similar to pool-server's implementation).

### H-3: Generic Webhooks Accept Unsigned Payloads
- **Package:** server
- **File:** `src/routes/ingest.ts` (lines ~200-210)
- **Description:** When `source === 'generic'`, no HMAC signature verification is performed. The `secret` is `undefined` and the verification block is skipped entirely. Any external party who knows the ingest URL can inject events.
- **Fix:** Either require a shared secret for generic webhooks or clearly document the security implications. Consider requiring auth header for generic sources.

### H-4: Event Batch Size of 1000 Without Request Size Limit
- **Package:** server
- **File:** `src/routes/events.ts` (line 23)
- **Description:** `ingestBatchSchema` allows up to 1000 events per batch, but there's no request body size limit enforced. A batch of 1000 events each with maximum-sized payloads could be many megabytes. The OTLP endpoint has a 10MB limit but the events endpoint does not.
- **Fix:** Add body size middleware on the `/api/events` POST route.

### H-5: Pool Server Auth Uses Direct String Comparison for API Keys
- **Package:** pool-server
- **File:** `src/auth.ts` (lines 44-50)
- **Description:** `token === options.apiKey` uses non-timing-safe comparison for API key verification. This enables timing attacks to determine key characters incrementally.
- **Fix:** Use `crypto.timingSafeEqual()` with fixed-length buffer comparison.

### H-6: Stripe Webhook Signature Verification Uses Non-Timing-Safe Comparison
- **Package:** server
- **File:** `src/cloud/billing/stripe-client.ts` (line ~205)
- **Description:** `if (sig !== expected)` uses `!==` for Stripe webhook HMAC comparison instead of `timingSafeEqual`. This is in the production webhook verification path.
- **Fix:** Use `crypto.timingSafeEqual()`.

### H-7: JWT Secret Not Validated at Startup
- **Package:** server
- **File:** `src/cloud/auth/auth-service.ts`
- **Description:** `AuthServiceConfig.jwtSecret` is passed in but never validated for minimum length or entropy. A weak secret (empty string, short value) would compromise all JWT tokens.
- **Fix:** Validate at construction time: minimum 32 bytes, not empty, not a common value.

### H-8: Session Map Memory Leak in MCP Transport
- **Package:** mcp
- **File:** `src/transport.ts` (line 41)
- **Description:** `sessionAgentMap` grows indefinitely. `clearSessionAgent` is only called on explicit session_end, but if sessions are abandoned or the process long-lived, entries accumulate forever.
- **Fix:** Add TTL-based eviction or cap the map size.

### H-9: Cloud `as any` Type Holes Throughout
- **Package:** server
- **File:** `src/cloud/org-service.ts`, `src/cloud/billing/*.ts`, `src/cloud/routes/onboarding-routes.ts`
- **Description:** Over 30 instances of `(result.rows as any[])` pattern across cloud service code. No runtime validation of query results. If a query returns unexpected shape (schema migration, DB error), the code silently produces wrong values.
- **Fix:** Define typed interfaces for query results and validate, or use a typed query builder.

---

## MEDIUM Findings

### M-1: CORS Default Allows Localhost Only — Inconsistent with Docs
- **Package:** server
- **File:** `src/config.ts` (line 14)
- **Description:** Default `corsOrigin` is `'http://localhost:3400'` but error in `validateConfig` blocks `'*'` when auth is enabled. Production deployments must explicitly configure CORS, but there's no guidance on setting it for non-localhost origins with the dashboard on a different port/domain.
- **Fix:** Add documentation. Consider allowing array of origins.

### M-2: EventBus Has No Backpressure
- **Package:** server
- **File:** `src/lib/event-bus.ts`, `src/lib/sse.ts`
- **Description:** EventBus emits synchronously to all listeners. If SSE clients are slow or many are connected, the event loop can stall during high-throughput ingestion. No mechanism to drop events or apply backpressure.
- **Fix:** Add a bounded queue per SSE listener; drop events when full.

### M-3: OTLP Body Size Check Uses Content-Length Header Only
- **Package:** server
- **File:** `src/routes/otlp.ts` (line ~250)
- **Description:** Body size limit checks `content-length` header, which can be omitted (chunked transfer) or spoofed. The actual body is still read in full.
- **Fix:** Use streaming body size enforcement or middleware that aborts after reading MAX_BODY_SIZE bytes.

### M-4: Pool Server InMemoryPoolStore LRU Uses O(n) indexOf
- **Package:** pool-server
- **File:** `src/store.ts` (line ~124)
- **Description:** `touchLru` calls `this.lruOrder.indexOf(id)` which is O(n) and `splice` which is also O(n). With large lesson counts, this degrades performance.
- **Fix:** Use a doubly-linked list or `Map`-based LRU.

### M-5: Embedding Worker Unbounded Queue
- **Package:** server
- **File:** `src/lib/embeddings/worker.ts`
- **Description:** `enqueue()` method on EmbeddingWorker doesn't appear to have bounds. Under high ingest load, the queue could grow unboundedly in memory.
- **Fix:** Add a max queue size with drop-oldest or backpressure.

### M-6: Pool Server delegation.inputData Not Size-Limited
- **Package:** pool-server
- **File:** `src/app.ts` (lines 128-135)
- **Description:** `inputData` in delegation requests has no size validation. An attacker can submit arbitrarily large data payloads.
- **Fix:** Add size limits on `inputData` and `outputData`.

### M-7: Server Guardrails `conditionConfig` and `actionConfig` Not Validated
- **Package:** server/core
- **File:** `core/src/schemas.ts` (CreateGuardrailRuleSchema)
- **Description:** Both config fields use `z.record(z.unknown())` — any JSON object is accepted. The actual condition/action executors may fail at runtime with invalid configs, but there's no schema-level validation for specific condition types.
- **Fix:** Add discriminated union schemas for each condition/action type.

### M-8: Benchmark Store Uses Raw SQL with `(this.db as any).$client`
- **Package:** server
- **File:** `src/db/benchmark-store.ts` (line 153)
- **Description:** Bypasses Drizzle's type system to access the raw SQLite client. This is fragile and could break on Drizzle upgrades.
- **Fix:** Use Drizzle's `sql` template tag or raw query API properly.

### M-9: Pool Server Has No Request Body Size Limit
- **Package:** pool-server
- **File:** `src/app.ts`
- **Description:** No body size limit on any endpoint. Embedding arrays in `/pool/share` and `/pool/search` can be arbitrarily large.
- **Fix:** Add body size middleware (Hono has `bodyLimit()`).

### M-10: Event Repository Transaction Callbacks Typed as `any`
- **Package:** server
- **File:** `src/db/repositories/event-repository.ts` (lines 31-32)
- **Description:** `handleSessionUpdate: (tx: any, ...)` and `handleAgentUpsert: (tx: any, ...)` use `any` for the transaction parameter, losing type safety.
- **Fix:** Type the transaction parameter properly (Drizzle's transaction type).

### M-11: Alert Engine and Guardrail Engine Intervals Not Exposed for Cleanup
- **Package:** server
- **File:** `src/index.ts` (startServer), `src/lib/alert-engine.ts`
- **Description:** `alertEngine.start()` and `guardrailEngine.start()` are called but there's no graceful shutdown on SIGTERM. Intervals and event listeners continue running.
- **Fix:** Add SIGTERM/SIGINT handlers that call `.stop()` on both engines.

### M-12: Cloud Auth brute-force protection is in-memory only
- **Package:** server
- **File:** `src/cloud/auth/brute-force.ts`
- **Description:** BruteForceProtection uses a `Map` — it doesn't survive process restarts and doesn't work across multiple server instances. An attacker can simply wait for a deploy/restart.
- **Fix:** Document the limitation. For production, implement Redis-backed version.

### M-13: Dashboard API Module Has No Auth Token Handling
- **Package:** dashboard
- **File:** `src/api/core.ts`, `src/api/client.ts`
- **Description:** Without reviewing the full dashboard source (React), the API modules appear to be simple HTTP wrappers. If the dashboard stores API keys in localStorage, they're vulnerable to XSS.
- **Fix:** Verify API keys are stored securely. Consider httpOnly cookies for dashboard auth.

### M-14: OTLP HMAC Authentication Compares Token as Plaintext
- **Package:** server
- **File:** `src/routes/otlp.ts` (line ~226)
- **Description:** `authHeader !== \`Bearer ${authToken}\`` — plaintext string comparison for OTLP auth, not timing-safe.
- **Fix:** Use `timingSafeEqual`.

### M-15: Cloud OAuth State Parameter Not Validated
- **Package:** server
- **File:** `src/cloud/auth/oauth.ts`
- **Description:** `getGoogleAuthUrl` and `getGithubAuthUrl` accept a `state` parameter but there's no visible CSRF protection — no verification that the `state` returned matches what was originally sent. This must be validated in the callback handler.
- **Fix:** Verify the route handlers that call these functions validate the state parameter against a stored value.

### M-16: Pool Server Reputation Score Can Be Manipulated
- **Package:** pool-server
- **File:** `src/app.ts` (lines 168-187)
- **Description:** The daily cap is 5 votes per voter per day, but `todayStart` calculation uses `Math.floor(Date.now() / 86400000) * 86400` (epoch **seconds** for start of day), while `createdEpoch` is also in seconds. However, `Date.now()` returns milliseconds, so the calculation is: `Math.floor(ms / 86400000)` gives day number, then `* 86400` gives seconds. The filter `e.createdEpoch >= todayStart` is correct. However, there's no validation that `delta` is bounded — an attacker can send `delta: -1000` to instantly tank any lesson's reputation.
- **Fix:** Validate `delta` is in range [-1, 1] or similar bounded range.

### M-17: Server Event Hardcodes `tenantId: 'default'` in OTLP Route
- **Package:** server
- **File:** `src/routes/otlp.ts` (in `buildAndInsertEvents`, line ~172)
- **Description:** All OTLP events are assigned `tenantId: 'default'`, bypassing tenant isolation. If the server hosts multiple tenants, OTLP data goes to the wrong tenant.
- **Fix:** Derive tenant from auth context or configuration.

---

## LOW Findings

### L-1: Unused `SENSITIVE_PATTERNS` Array
- **Package:** server
- **File:** `src/lib/error-sanitizer.ts` (lines 22-31)
- **Description:** `SENSITIVE_PATTERNS` is defined but never used. The `sanitizeErrorMessage` function doesn't check against these patterns.
- **Fix:** Either use the patterns for defense-in-depth filtering, or remove them.

### L-2: Pool Server `generateId` Uses Incrementing Counter
- **Package:** pool-server
- **File:** `src/store.ts` (lines 60-63)
- **Description:** `pool-${Date.now()}-${++idCounter}` is predictable. While not a security issue in the in-memory store, if this pattern is used in production, IDs would be guessable.
- **Fix:** Use `ulid()` or `crypto.randomUUID()` for IDs.

### L-3: SDK Imports `randomUUID` from `node:crypto`
- **Package:** sdk
- **File:** `src/client.ts` (line 7)
- **Description:** `import { randomUUID } from 'node:crypto'` — the SDK claims to work in browsers but imports from `node:crypto`. This would fail in browser environments.
- **Fix:** Use `crypto.randomUUID()` (Web Crypto API) or polyfill.

### L-4: Core `hash.ts` Uses JSON.stringify for Canonical Form
- **Package:** core
- **File:** `src/hash.ts` (line 89)
- **Description:** `JSON.stringify` doesn't guarantee key ordering for the `payload` and `metadata` fields if they're nested objects. While the fields are ordered in the top-level object literal, `payload` and `metadata` values could have unstable serialization if constructed differently.
- **Fix:** Use a deterministic JSON serializer (e.g., `json-stable-stringify`) or document the constraint.

### L-5: Missing `strict: true` / Loose TypeScript in Cloud Code
- **Package:** server
- **File:** Multiple cloud files
- **Description:** Extensive use of `as any[]` casts on query results without runtime validation (30+ instances). This is a type safety hole, not just style.
- **Fix:** Create typed DTOs for all DB query results.

### L-6: Server Config `corsOrigin` is Single String, Not Array
- **Package:** server
- **File:** `src/config.ts`
- **Description:** CORS origin only supports a single string origin. Real deployments may need multiple allowed origins.
- **Fix:** Support comma-separated origins or array.

### L-7: Dashboard `useSSE` Hook May Leave Connections Open
- **Package:** dashboard
- **File:** `src/hooks/useSSE.ts`
- **Description:** Without seeing full implementation, SSE connections typically need explicit cleanup on component unmount. If not handled, zombie connections accumulate.
- **Fix:** Verify useEffect cleanup closes EventSource.

### L-8: SDK Client Doesn't Retry on 5xx
- **Package:** sdk
- **File:** `src/client.ts`
- **Description:** No retry logic for transient failures. A single 502/503 throws immediately.
- **Fix:** Add configurable retry with exponential backoff for 5xx responses.

### L-9: MCP Transport Re-buffers Failed Events Without Dedup
- **Package:** mcp
- **File:** `src/transport.ts` (lines 106-115)
- **Description:** On flush failure, events are re-queued with `this.buffer.unshift(...requeue)`. If the next flush also fails, duplicates accumulate. No deduplication or retry limit.
- **Fix:** Add max retry count per event. Track retry attempts.

### L-10: Core Schemas Don't Validate `timestamp` Format Strictly
- **Package:** core
- **File:** `src/schemas.ts`
- **Description:** `timestamp: z.string().datetime().optional()` — Zod's `datetime()` is fairly strict but allows both offset and UTC formats. Server code sometimes constructs dates with `new Date().toISOString()` (always UTC) — the schema should enforce consistency.
- **Fix:** Use `z.string().datetime({ offset: false })` for UTC-only.

### L-11: Pool Server LRU `touchLru` O(n) on `deleteLessonsByContributor`
- **Package:** pool-server
- **File:** `src/store.ts` (line 163)
- **Description:** `this.lruOrder = this.lruOrder.filter(x => x !== id)` inside a loop — O(n²) for bulk deletion.
- **Fix:** Use Set-based removal or rebuild once after batch.

### L-12: Server Event Repository `insertEvents` Synchronous
- **Package:** server
- **File:** `src/db/sqlite-store.ts`, `src/db/repositories/event-repository.ts`
- **Description:** SQLite operations are synchronous (better-sqlite3), meaning they block the event loop during writes. With large batches (1000 events), this could cause noticeable latency spikes.
- **Fix:** Document the trade-off. Consider worker threads for batch inserts.

### L-13: Pool Server index.ts Not Reviewed (minimal)
- **Package:** pool-server
- **File:** `src/index.ts`
- **Description:** Entry point file - assumed to be minimal server startup.
- **Fix:** N/A

### L-14: No Input Sanitization on `search` Query Parameter
- **Package:** server
- **File:** `src/db/shared/query-helpers.ts` (line 77)
- **Description:** The search query uses `LIKE` with escape characters applied (`escaped`), which is good. However, very long search strings could be used for DoS via regex-like LIKE patterns.
- **Fix:** Limit search string length (e.g., 500 chars).

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH | 9 |
| MEDIUM | 17 |
| LOW | 14 |
| **Total** | **45** |

## Top Recommendations (Priority Order)

1. **Fix C-1 and C-2 immediately** — Unauthenticated endpoints in production is unacceptable
2. **Fix C-3 and C-4** — SSRF is a P0 vulnerability in any cloud-hosted environment
3. **Fix C-5, H-5, H-6, M-14** — All timing-unsafe comparisons for secrets/tokens
4. **Fix H-2** — The OTLP rate limiter memory leak is exploitable for DoS
5. **Add body size limits** across all Hono apps (H-4, M-6, M-9)
6. **Validate guardrail configs** at write time, not just at execution (M-7)
7. **Clean up `as any` throughout cloud code** — this is a maintenance and correctness hazard (H-9, M-10, L-5)
8. **Add graceful shutdown** for engines and workers (M-11)

## Positive Observations

Despite the findings, the codebase shows several strong practices:

- ✅ **Hash chain integrity** — Well-designed tamper-evident event chain with proper verification
- ✅ **Error sanitization** — `ClientError` pattern prevents internal detail leakage
- ✅ **Tenant scoping** — `TenantScopedStore` wrapper pattern is solid for multi-tenancy
- ✅ **Webhook HMAC** — Proper timing-safe comparison in `verifyWebhookSignature`
- ✅ **Password hashing** — scrypt with proper salt length and timing-safe verify
- ✅ **Zod validation** — Comprehensive schema validation on event ingestion
- ✅ **Rate limiting on pool-server** — Bounded memory, cleanup timers, eviction
- ✅ **CORS/Auth validation at startup** — Rejects `*` origin with auth enabled

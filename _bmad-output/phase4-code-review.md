# Phase 4 (v0.9.0) Code Review — Agent Memory Sharing + Agent-to-Agent Discovery

**Reviewer:** BMAD Code Reviewer (automated)
**Date:** 2026-02-09
**Scope:** All Phase 4 additions across core, server, pool-server, mcp, dashboard packages

---

## Summary

Overall the implementation is solid: branded types enforce compile-time separation, the redaction pipeline is fail-closed, tenant isolation via Drizzle `eq()` filters is consistent, and the anonymous ID rotation works correctly. However, there are several findings ranging from a critical data leakage path to medium-severity gaps.

---

## Findings

### CRITICAL-01: Raw `lesson.context` Leaked to Pool as `qualitySignals`

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Location** | `packages/server/src/services/community-service.ts:647` |
| **Description** | In `share()`, after redaction of title+content, the raw `lesson.context` object is passed directly to `transport.share()` as `qualitySignals`. The `lesson.context` field is a `Record<string, unknown>` that may contain tenant-specific data, agent IDs, user information, file paths, API endpoints, or other sensitive metadata. The redaction pipeline only processes `title` and `content` — it never touches `context`. This is a direct data leakage path to the pool. |
| **Recommendation** | Either (a) strip `context`/`qualitySignals` entirely before sending to the pool (pass `{}` instead of `lesson.context`), or (b) run the redaction pipeline over serialized context fields as well. Note that the pipeline already strips context on line 130 (`context always stripped`), but this is bypassed by passing the raw context on line 647. |

### CRITICAL-02: Purge Token Never Set — Purge Always Fails

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Location** | `packages/pool-server/src/app.ts:66-72`, `packages/server/src/services/community-service.ts:527-528` |
| **Description** | The pool server's `/pool/purge` endpoint validates the purge token via `store.getPurgeToken(anonymousContributorId)`. However, `setPurgeToken()` is never called anywhere in the codebase — no code path ever registers a purge token with the pool. The `purgeToken` stored in the server's `SharingConfig` is a local UUID, but the pool server's `InMemoryPoolStore` has an independent `purgeTokens` map that is always empty. This means **purge will always fail with "Invalid purge token"** — the kill switch is broken. |
| **Recommendation** | When sharing is first enabled (or on first share), call `store.setPurgeToken(contributorId, token)` on the pool side. The server's `community-service` should send the purge token to the pool during setup. |

---

### HIGH-01: `createRedactedLessonContent` Exported as Public API — Bypasses Pipeline

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `packages/core/src/redaction-types.ts:93-99` |
| **Description** | `createRedactedLessonContent()` is exported publicly with the comment "only used by the pipeline," but nothing enforces this. Any consumer can call `createRedactedLessonContent(rawTitle, rawContent, {})` to mint a `RedactedLessonContent` without actually running redaction. The branded type safety is compile-time only, and this factory function provides a legitimate bypass. |
| **Recommendation** | Move `createRedactedLessonContent` to a non-exported internal module, or at minimum add `@internal` JSDoc and re-export only from the pipeline package. Consider a more robust approach like a unique symbol brand that only the pipeline can create. |

### HIGH-02: Pool Server Accepts Arbitrary Content Without Validation

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `packages/pool-server/src/app.ts:24-36` |
| **Description** | The pool server's `/pool/share` endpoint accepts `title`, `content`, `category`, and `qualitySignals` without any content validation, size limits, or sanitization. A malicious or misconfigured client could send unredacted content, XSS payloads, or arbitrarily large payloads. The pool is treated as trusted storage. |
| **Recommendation** | Add: (1) max size limits for title/content/qualitySignals, (2) category validation against allowed set, (3) basic content sanitization. The pool should not blindly trust that content is properly redacted. |

### HIGH-03: Anonymous ID Correlation Risk — Same Contributor ID for Sharing + Voting + Flagging

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `packages/server/src/services/community-service.ts:631,649,667` |
| **Description** | The same `anonymousContributorId` (from `getOrRotateContributorId(tenantId)`) is used for sharing lessons, voting on reputation, and flagging content. This means the pool can correlate all activities by a single tenant: their shared lessons, their votes, and their flags — effectively deanonymizing the tenant's behavior patterns even though the ID is anonymous. |
| **Recommendation** | Use separate anonymous IDs for different operations (e.g., a `__voter__` and `__flagger__` identity), or at minimum document this as an accepted risk. The 24h rotation helps but doesn't eliminate the correlation within a window. |

### HIGH-04: Delegation Input Data Sent Unredacted to Pool

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `packages/server/src/services/delegation-service.ts:175-183` |
| **Description** | The delegation `input` field (arbitrary user data for the delegated task) is sent directly to the pool transport without any redaction or sanitization. The pool-server `types.ts` comments note this "would be encrypted in production" but currently it's plaintext. Sensitive task data (code, documents, PII) could flow through the pool unprotected. |
| **Recommendation** | At minimum, apply the redaction pipeline to the serialized input before sending. Ideally implement end-to-end encryption between requester and target agent so the pool never sees plaintext task data. |

### HIGH-05: `checkTrustThreshold` is a No-Op — Always Returns True

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `packages/server/src/services/delegation-service.ts:301-305` |
| **Description** | `checkTrustThreshold()` always returns `true` with a comment saying "full trust scoring comes in B5." However, the delegation service is being shipped in v0.9.0 — any agent can delegate to any other agent regardless of trust score. The `minTrustThreshold` config is only enforced at discovery time, not at delegation time. |
| **Recommendation** | Implement the trust check or block delegation until it's implemented. A malicious agent could bypass discovery (knowing the target's anonymous ID) and delegate directly without trust validation. |

---

### MEDIUM-01: Rate Limiter is In-Memory — Lost on Restart, Not Shared Across Instances

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/services/community-service.ts` (SharingRateLimiter), `packages/server/src/services/discovery-service.ts` (RateLimiter), `packages/pool-server/src/rate-limiter.ts` |
| **Description** | All rate limiters are in-memory Maps. They reset on process restart and are per-instance in a multi-process deployment. A rapid restart or horizontal scaling would bypass rate limits entirely. |
| **Recommendation** | Acceptable for v0.9.0/single-instance, but document the limitation and plan for a persistent rate limiter (Redis/SQLite-backed) before production multi-instance deployment. |

### MEDIUM-02: Human Review Stores Original Content in `redactedContent` Field

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/lib/redaction/human-review-layer.ts:51-60` |
| **Description** | The `HumanReviewLayer` stores `input` (which is the partially-redacted text from previous pipeline layers) into the `redactedContent` field, but also has `originalTitle` and `originalContent` fields in the queue entry, both set to empty strings. The naming is misleading. More importantly, when `approveReviewItem()` sends content to the pool (community-service.ts:683), it uses `item.redactedTitle` and `item.redactedContent` — these were set by the pipeline's partially-processed text, but the `context` field is never available in the review queue, which is good. |
| **Recommendation** | Clarify the data flow by populating `originalTitle`/`originalContent` properly (for reviewer comparison) or removing those unused fields. Verify that the review queue is properly tenant-scoped in the DB. |

### MEDIUM-03: Pool Server `/pool/moderation/queue` Uses Search with Empty Embedding

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/pool-server/src/app.ts:180-184` |
| **Description** | The moderation queue endpoint calls `store.searchLessons({ embedding: [], limit: 100 })` then filters client-side. With an empty embedding, `cosineSimilarity` returns 0 for all results, but `searchLessons` filters out hidden lessons (`if (lesson.hidden) continue`). So hidden lessons (which are the ones needing moderation) are excluded from search results. The moderation queue will always return an empty list. |
| **Recommendation** | Add a dedicated `getModerationQueue()` method to `PoolStore` that returns hidden/flagged lessons without the hidden filter. |

### MEDIUM-04: Semantic Deny List Regex Injection

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/lib/redaction/semantic-denylist-layer.ts:25-31` |
| **Description** | Users can add deny-list patterns including regex via the API. The `addDenyListRule` validates regex syntax but doesn't limit complexity. A malicious/careless admin could add a ReDoS pattern (e.g., `/(a+)+$/`) that causes the redaction pipeline to hang, effectively DoS-ing the sharing feature. |
| **Recommendation** | Add regex complexity limits: max length, disallow nested quantifiers, or run regex matching with a timeout. The `safe-regex` npm package can detect vulnerable patterns. |

### MEDIUM-05: `approveReviewItem` Swallows Pool Transport Errors

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/services/community-service.ts:690-692` |
| **Description** | In `approveReviewItem()`, after marking the review as approved in the DB, the pool transport `share()` call is wrapped in a try/catch that swallows errors silently. If the pool is down, the lesson is marked as "approved" locally but never actually shared. There's no retry mechanism or indication of failure. |
| **Recommendation** | At minimum log the error. Consider a separate status like `approved_pending_sync` with a retry mechanism, or return the pool error to the caller. |

### MEDIUM-06: Missing `agentId` in Delegation Route

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/routes/delegation.ts:37` |
| **Description** | The `POST /delegate` endpoint takes `agentId` from the request body rather than from the authenticated context or URL path. A caller could specify any `agentId` and delegate on behalf of another agent within the same tenant. While tenant isolation holds, intra-tenant agent impersonation is possible. |
| **Recommendation** | Either derive `agentId` from the authentication context or validate that the authenticated API key has permission to act on behalf of the specified agent. |

### MEDIUM-07: No Pagination on Audit Logs and Delegation Logs

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `packages/server/src/services/community-service.ts:709`, `packages/server/src/services/delegation-service.ts:338-345` |
| **Description** | `getAuditLog` has a hard limit of 50 but no offset/pagination. `getDelegationLogs` returns ALL logs for a tenant with no limit. For active tenants, this could return thousands of rows, causing performance issues and large response payloads. |
| **Recommendation** | Add proper pagination (offset/limit or cursor-based) to both methods and their corresponding routes. |

---

### LOW-01: Azure Subscription UUID Pattern Has Very Low Confidence

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Location** | `packages/server/src/lib/redaction/secret-patterns.ts:21,27` |
| **Description** | Both `azure_subscription` and `heroku_api_key` patterns match any UUID with confidence 0.3, which is below the 0.5 active threshold. However, these patterns are still in the `SECRET_PATTERNS` array and could confuse code readers. The same UUID format is caught by `TenantDeidentificationLayer` (layer 4) anyway. |
| **Recommendation** | Remove or clearly mark these as intentionally inactive. |

### LOW-02: `poolEndpoint` Config Not Used

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Location** | `packages/server/src/services/community-service.ts` (SharingConfig) |
| **Description** | The `poolEndpoint` field exists in `SharingConfig` and can be set via the API, but it's never read by any code to configure the actual pool transport. The transport is always injected via constructor. |
| **Recommendation** | Either wire up `poolEndpoint` to the HTTP transport configuration, or remove it from the config to avoid confusion. |

### LOW-03: Delegation `waitForResult` Busy-Polls at 50ms

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Location** | `packages/server/src/services/delegation-service.ts:309-325` |
| **Description** | The delegation polling loop uses a 50ms interval with `setTimeout`, which will consume a significant amount of CPU and event-loop time for long-running delegations (30s default timeout = 600 polls). |
| **Recommendation** | Use exponential backoff (e.g., 50ms → 100ms → 200ms → 500ms → 1s) or switch to a notification-based approach (WebSocket/SSE). |

### LOW-04: `cleanupOldLogs` Loads All Logs Then Filters In-Memory

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Location** | `packages/server/src/services/delegation-service.ts:374-385` |
| **Description** | `cleanupOldLogs` loads ALL delegation logs for a tenant into memory, filters by date in JS, then deletes individually. For large log sets this is very inefficient. |
| **Recommendation** | Use a single SQL `DELETE ... WHERE created_at < cutoff AND tenant_id = ?` statement. |

### LOW-05: Dashboard Pages Not Reviewed in Detail

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Location** | `packages/dashboard/src/pages/` (6 new pages) |
| **Description** | Dashboard pages are client-side React components that consume the API. They don't handle sensitive data directly (server enforces all access controls). Not reviewed in detail for this privacy-focused review. |
| **Recommendation** | Ensure any displayed anonymous IDs, redacted content, or audit logs don't include unredacted data in tooltips/debug views. Standard XSS protections via React's default escaping should suffice. |

---

## Positive Observations

1. **Branded types are well-designed** — `RawLessonContent` and `RedactedLessonContent` have distinct `__brand` fields, preventing accidental assignment. No `as` casts bypassing this were found.
2. **Fail-closed pipeline** — The `RedactionPipeline.process()` correctly catches all errors and returns `status: 'error'`, preventing unredacted content from proceeding. Plugin errors are handled identically to built-in layers.
3. **Tenant isolation** — All DB queries consistently use `eq(table.tenantId, tenantId)` scoping. No cross-tenant query paths found.
4. **Anonymous ID rotation** — 24h rotation with audit trail retention is well-implemented. Old IDs are preserved for auditing but not reused.
5. **Hierarchical toggles** — Tenant OFF overrides agent ON, and agent-level category filtering works correctly.
6. **Redaction pipeline is thorough** — 6 layers covering secrets, PII, URLs/paths, tenant terms, deny lists, and human review. The secret pattern library is comprehensive.
7. **Context always stripped** — The pipeline output explicitly creates `RedactedLessonContent` with empty context `{}` (line 130), ensuring context metadata doesn't leak through the branded type path.

---

## Priority Remediation Order

1. **CRITICAL-01** — Fix `qualitySignals` data leakage (immediate)
2. **CRITICAL-02** — Fix purge token registration (immediate)
3. **HIGH-04** — Address delegation input redaction
4. **HIGH-01** — Restrict `createRedactedLessonContent` access
5. **HIGH-02** — Add pool server input validation
6. **HIGH-03** — Separate anonymous IDs per operation type
7. **HIGH-05** — Implement trust threshold check in delegation
8. MEDIUM items in listed order

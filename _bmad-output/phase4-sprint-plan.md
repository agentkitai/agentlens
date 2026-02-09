# AgentLens v0.9.0 — Sprint Plan

## Agent Memory Sharing & Agent-to-Agent Discovery

**Date:** 2026-02-09
**Author:** Bob (Scrum Master, BMAD Pipeline)
**Source:** Phase 4 PRD (77 FRs, 44 PRs), Architecture Doc
**Version:** 1.0

---

## Execution Strategy

32 stories across 7 epics, organized into **8 batches**. Three tracks run after foundations:

- **Track A (Redaction):** Pipeline core → adversarial tests → integration
- **Track B (Community Sharing):** Store schema → sharing protocol → query → reputation → moderation
- **Track C (Discovery & Delegation):** Registry → discovery → delegation → trust → dashboard

**Privacy-first ordering enforced:** The redaction pipeline (Epic 2) and shared store schema (Epic 3) MUST complete before any cross-tenant data flow features.

**Estimated total duration:** 14–18 working days (3–3.5 weeks) with parallel execution.

---

## Epic Breakdown

| Epic | Name | Stories | Critical Path? |
|------|------|---------|---------------|
| E1 | Core Types & Schema Foundation | 4 | ✅ Yes — everything depends on this |
| E2 | Redaction Pipeline | 5 | ✅ Yes — must complete before sharing |
| E3 | Shared Pool Server & Store | 3 | ✅ Yes — must complete before sharing |
| E4 | Community Sharing Protocol | 5 | Depends on E2 + E3 |
| E5 | Agent Discovery & Capability Registry | 4 | Parallel with E4 after E1 |
| E6 | Delegation Protocol & Trust | 5 | Depends on E5 |
| E7 | Dashboard, MCP Tools & Documentation | 6 | Depends on E4 + E6 |

**Total stories: 32**

---

## Critical Path Diagram

```
B0: Code Review Gate
 │
 ▼
B1: E1 (Core Types + Schemas)
 │
 ├──────────────────────────────┐
 ▼                              ▼
B2: E2 (Redaction Pipeline)    B2: E5.1-5.2 (Capability Types + Registry)
 │                              │
 ▼                              ▼
B3: E2 (Adversarial Tests)     B3: E5.3-5.4 (Discovery Protocol)
 │                              │
 ├──────────┐                   ▼
 ▼          ▼                  B4: E6.1-6.2 (Delegation Core)
B4: E3     E2.5 (Plugin API)   │
 │                              ▼
 ▼                             B5: E6.3-6.5 (Trust + Fallback + Audit)
B5: E4.1-4.3 (Share + Query)   │
 │                              │
 ▼                              │
B6: E4.4-4.5 (Reputation +     │
    Kill Switch + Moderation)   │
 │                              │
 └──────────────────────────────┘
                │
                ▼
B7: E7 (Dashboard + MCP Tools + Docs)
```

---

## Batch 0: Code Review Gate 🚧

**Goal:** Review Phase 3 final state, verify clean baseline for Phase 4 work.

**Duration:** 0.5 day

| Story | Description | Depends On |
|-------|-------------|------------|
| 0.1 | Review: Existing types, DB schema, test suite health | — |

**Exit Criteria:**
- [ ] All existing tests pass
- [ ] DB schema documented, migration system working
- [ ] MCP tool registration patterns confirmed
- [ ] Lesson/reflect infrastructure validated (Phase 4 builds on it)

---

## Batch 1: Foundation (Epic 1)

**Goal:** Establish branded types, tenant-local schema additions, and core enums. Everything in Phase 4 depends on this batch.

**Duration:** 1 day

### Epic 1: Core Types & Schema Foundation

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 1.1 | **Branded Types:** Create `RawLessonContent` and `RedactedLessonContent` branded types in `@agentlensai/core`. Add `RedactionFinding`, `RedactionLayerName`, `RedactionResult`, `RedactionLayer` interface, `RedactionContext`. Verify compile-time: `RawLessonContent` NOT assignable to `RedactedLessonContent`. | 12 | B0 | Types compile; assignment test fails; all interfaces exported |
| 1.2 | **Community & Discovery Types:** Create `community-types.ts` (`LessonSharingCategory` enum, `SharingConfig`, `AgentSharingConfig`, `SharedLesson`, `CommunitySearchResult`, `FlagReason`, `ModerationAction`, `SharingAuditEvent`) and `discovery-types.ts` (`TaskType` enum, `CapabilityRegistration`, `DiscoveryQuery`, `DiscoveryResult`, `DelegationRequest`, `DelegationResult`, `DelegationPhase`). | 15 | 1.1 | All types exported; enums have correct values; JSON schema validates |
| 1.3 | **Tenant-Local Schema:** Add 8 new Drizzle tables: `sharing_config`, `agent_sharing_config`, `deny_list_rules`, `sharing_audit_log`, `sharing_review_queue`, `anonymous_id_map`, `capability_registry`, `delegation_log`. Create migration. | 20 | 1.1 | Migration runs; tables created; indexes exist; no existing tables modified; rollback drops cleanly |
| 1.4 | **Anonymous ID Manager:** Implement `getOrRotateAnonymousId()` with 24h rotation, lazy creation, audit trail. Implement anonymous contributor ID generation for tenants. | 15 | 1.3 | New ID generated on first call; same ID returned within 24h; new ID after expiry; old IDs kept for audit; contributor ID generated and stored |

**Parallelism:** 1.1 first → 1.2 parallel with 1.3 → 1.4 after 1.3

```
[== 1.1 ==]
           [== 1.2 ==]
           [== 1.3 ==]
                      [== 1.4 ==]
```

**Batch 1 test count: ~62**

---

## Batch 2: Redaction Pipeline + Capability Foundation

**Goal:** Build the 6-layer redaction pipeline (critical path) and, in parallel, start capability registry types and store.

**Duration:** 2–3 days

### Epic 2: Redaction Pipeline (Stories 2.1–2.3)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 2.1 | **Layers 1-3:** Implement `SecretDetectionLayer` (40+ regex patterns + Shannon entropy calculator), `PIIDetectionLayer` (regex patterns for email, phone, SSN, CC, IP + optional Presidio integration point), `UrlPathScrubbingLayer` (internal URL detection, file path detection, private IP detection, public domain allowlist). Each layer implements `RedactionLayer` interface, returns findings. | 80 | 1.1 | All 40+ secret patterns detected; all PII regex patterns match; internal URLs replaced, public URLs preserved; private IPs caught; file paths replaced; findings logged per layer |
| 2.2 | **Layers 4-6:** Implement `TenantDeidentificationLayer` (strips tenant/agent/user IDs, org names, configurable terms), `SemanticDenyListLayer` (plain text + regex patterns, blocks entire lesson on match), `HumanReviewLayer` (queue management, pass-through when disabled). | 45 | 1.1, 1.3 | Tenant terms stripped; UUID patterns caught; deny-list blocks lesson entirely; human review queues lesson when enabled; pass-through when disabled; review approval/rejection works |
| 2.3 | **Pipeline Orchestrator:** Implement `RedactionPipeline` class. Chain all 6 layers in order. Fail-closed on any error. Support custom layer injection. Process `RawLessonContent` → `RedactedLessonContent`. Context field always stripped. | 30 | 2.1, 2.2 | Full pipeline processes lesson; error in any layer blocks sharing; custom layers inserted at correct order; context always empty in output; branded type output correct |

### Epic 5: Discovery — Foundation (Stories 5.1–5.2)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 5.1 | **Capability Registry Store:** CRUD operations for `capability_registry` table. Validate `taskType` enum, `customType` format (max 64 chars, alphanumeric + hyphens), JSON Schema validation for input/output schemas. Scope defaults to `internal`. | 35 | 1.2, 1.3 | Create/read/update/delete capabilities; validation rejects bad taskType, bad customType format, invalid schemas; scope defaults to internal; agent can have multiple capabilities |
| 5.2 | **Capability Registration REST API:** `PUT /api/agents/:id/capabilities` and `DELETE /api/agents/:id/capabilities/:capabilityId`. Register, update, remove capabilities. Return anonymous agent ID. | 25 | 5.1, 1.4 | Registration returns anonymous ID; update replaces; delete removes; 400 on invalid schema; agent must exist; tenant isolation enforced |

**Parallelism:** Track A (2.1, 2.2, 2.3) and Track C (5.1, 5.2) run in parallel.

```
Track A: [======= 2.1 =======]
         [====== 2.2 ======]
                             [=== 2.3 ===]

Track C: [==== 5.1 ====]
                       [==== 5.2 ====]
```

**Batch 2 test count: ~215**

**⚠️ Risk:** Layer 1 (secret detection) is the highest-risk component. Shannon entropy calculator needs careful tuning to avoid false positives on legitimate hex/base64 content while catching real secrets.

---

## Batch 3: Adversarial Tests + Discovery Protocol

**Goal:** Lock down redaction pipeline with adversarial test suite (CI gate). Build discovery protocol.

**Duration:** 2 days

### Epic 2: Redaction Pipeline (Story 2.4)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 2.4 | **Adversarial Test Suite + Red-Team Tests:** Create `adversarial-patterns.test.ts` with 200+ patterns across 6 categories (API keys 40+, PII 40+, URLs/paths 30+, secrets 30+, tenant terms 20+, evasion attempts 40+). Create `red-team.test.ts` with automated de-anonymization attempts. Add `POST /api/community/redaction/test` endpoint. | 250 | 2.3 | 100% detection rate on all 200+ patterns; red-team tests pass (0% de-anonymization success); test endpoint returns redacted output without sharing; evasion patterns (base64-encoded, URL-encoded, unicode confusables, split-across-lines) all caught |

### Epic 5: Discovery (Stories 5.3–5.4)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 5.3 | **Discovery Protocol:** Implement `DiscoveryService.discover()` with local query (internal scope) and composite ranking formula (0.5 trust + 0.3 cost + 0.2 latency). `GET /api/agents/discover` REST endpoint. Max 20 results. Filter by taskType, trust, cost, latency. | 40 | 5.2 | Internal discovery returns matching capabilities; ranking formula correct; max 20 results; filters work independently and combined; empty result for no matches; scope=internal never hits pool |
| 5.4 | **Permission Model:** Implement opt-in discovery (`capabilityRegistry.enabled`), opt-in delegation acceptance (`acceptDelegations`), admin controls for delegation initiation, tenant-wide minimum trust threshold (default 60), inbound/outbound rate limits (defaults 10/min, 20/min). | 35 | 5.3 | Default: not discoverable, no delegations accepted; toggle enables/disables; rate limits enforced with 429; trust threshold blocks low-trust targets; admin can configure per-agent |

**Parallelism:** 2.4 (Track A) runs in parallel with 5.3 + 5.4 (Track C).

```
Track A: [=========== 2.4 (adversarial tests) ===========]

Track C: [======= 5.3 =======]
                              [====== 5.4 ======]
```

**Batch 3 test count: ~325**

**⚠️ Risk:** The adversarial test suite is the largest single testing effort. Evasion patterns (base64-encoded secrets, unicode confusables) may reveal gaps requiring pipeline fixes before proceeding.

---

## Batch 4: Pool Server + Delegation Core

**Goal:** Stand up the shared pool server (PostgreSQL + pgvector). Start delegation protocol.

**Duration:** 2 days

### Epic 3: Shared Pool Server

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 3.1 | **Pool Server Scaffold:** Create `packages/pool-server/` with Express/Fastify. PostgreSQL + pgvector schema (5 tables: `shared_lessons`, `reputation_events`, `moderation_flags`, `purge_tokens`, `registered_capabilities`, `delegation_requests`). Health endpoint. mTLS skeleton. | 25 | 1.2 | Server starts; tables created; health endpoint responds; pgvector extension enabled; mTLS config loads |
| 3.2 | **Pool Lesson API:** `POST /pool/share` (accept redacted lesson + embedding), `POST /pool/search` (cosine similarity search), `DELETE /pool/purge` (delete by contributor ID + token auth), `GET /pool/count` (verify purge). Rate limiting at pool level. | 40 | 3.1 | Share stores lesson; search returns by similarity; purge deletes all for contributor; count returns 0 after purge; purge authenticates via token; rate limiting works |
| 3.3 | **Pool Discovery & Delegation API:** `POST /pool/register`, `POST /pool/discover`, `DELETE /pool/unregister`, `POST /pool/delegate`, `GET /pool/delegate/inbox`. Delegation request storage, polling, status updates. | 40 | 3.1 | Register stores capability; discover returns matching; unregister removes; delegate creates request; inbox returns pending; status updates work; idempotency enforced |

### Epic 6: Delegation Protocol (Stories 6.1–6.2)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 6.1 | **Delegation Core:** Implement `DiscoveryService.delegate()` with 4-phase protocol (REQUEST→ACCEPT→EXECUTE→RETURN). Outbound rate limit check, trust threshold check. Route through `PoolTransport`. Timeout enforcement. `POST /api/agents/delegate` REST endpoint. | 45 | 5.4, 3.3 | Full 4-phase cycle completes; timeout returns error within timeout+1s; rate limit enforced; trust threshold blocks low-trust; idempotency on requestId; delegation logged |
| 6.2 | **Delegation Inbox & Acceptance:** Implement inbound delegation handling. Agent receives requests via polling. Accept/reject within 5s configurable timeout. Execute task and return result. `acceptDelegations` toggle enforcement. Inbound rate limiting. | 40 | 6.1 | Inbound requests received via polling; accept triggers execution; reject returns to requester; 5s accept timeout enforced; inbound rate limit enforced; toggle-off rejects all |

**Parallelism:** Track B (3.1 → 3.2, 3.3) and Track C (6.1, 6.2) — 6.1 depends on 3.3, so partial serialization.

```
Track B: [=== 3.1 ===]
                     [=== 3.2 ===]
                     [=== 3.3 ===]

Track C:                          [=== 6.1 ===]
                                               [=== 6.2 ===]
```

**Batch 4 test count: ~190**

**⚠️ Risk:** Pool server is a new package. PostgreSQL + pgvector setup complexity. Delegation polling adds latency — verify <200ms overhead target.

---

## Batch 5: Community Sharing + Trust & Fallback

**Goal:** Wire up the full sharing flow (redaction → pool → query) and complete delegation with trust scoring and fallback.

**Duration:** 2 days

### Epic 4: Community Sharing Protocol (Stories 4.1–4.3)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 4.1 | **CommunityService.share():** Full share flow — check toggles (tenant/agent/category), load lesson, run redaction pipeline, generate anonymous ID, compute embedding, send to pool via `PoolTransport`, write audit log. `POST /api/community/share` REST endpoint. Rate limiting (50/hr). | 50 | 2.3, 3.2 | Lesson shared end-to-end; toggle-off blocks at each level; rate limit enforced (429); audit log written with all fields; blocked lessons logged; redaction findings included |
| 4.2 | **CommunityService.search():** Query shared pool via `PoolTransport`. Embedding similarity search. Category filter. Min reputation filter. Audit log every query. `GET /api/community/search` REST endpoint. | 30 | 3.2 | Search returns relevant lessons; category filter works; reputation filter works; no identifying metadata in results; audit log written; max 50 results |
| 4.3 | **Sharing Configuration API:** `GET/PUT /api/community/config` for tenant-level config. Per-agent toggles. Category toggles. Deny-list CRUD (`deny_list_rules`). Toggle-off takes effect within 1s. UI sharing status data. | 30 | 1.3 | Config CRUD works; toggle-off immediate; deny-list CRUD; categories toggle per-agent; hierarchical enforcement (tenant OFF overrides agent ON) |

### Epic 6: Delegation — Trust & Fallback (Stories 6.3–6.4)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 6.3 | **Trust Scoring:** Implement `computeRawTrustScore()` from health score history + delegation success rate. Percentile conversion (pool-side hourly computation). Provisional status for <10 delegations. Trust score updates after delegation outcomes. | 35 | 6.2 | Raw score formula correct; percentile computed; provisional flag at <10 delegations; score updates on success/failure; flag penalty applied |
| 6.4 | **Delegation Fallback:** When `fallbackEnabled=true`, on failure/timeout try next-ranked discovery result. Max `maxRetries` (default 3). Log all attempts. Return final result with `retriesUsed` count. | 25 | 6.1, 5.3 | Fallback triggers on failure; tries next ranked; stops after maxRetries; all attempts logged; retriesUsed correct; disabled by default |

**Parallelism:** Track B (4.1, 4.2, 4.3) and Track C (6.3, 6.4) run in parallel.

```
Track B: [=== 4.1 ===]
         [=== 4.2 ===]
                      [=== 4.3 ===]

Track C: [=== 6.3 ===]
                      [=== 6.4 ===]
```

**Batch 5 test count: ~170**

---

## Batch 6: Kill Switch, Reputation, Moderation & Delegation Audit

**Goal:** Complete the sharing safety features and delegation audit trail.

**Duration:** 1.5 days

### Epic 4: Community Sharing (Stories 4.4–4.5)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 4.4 | **Kill Switch & Reputation:** Implement `CommunityService.purge()` — delete all tenant lessons from pool within 60s, retire anonymous contributor ID, generate new ID+purge token. `DELETE /api/community/purge`, `GET /api/community/purge/verify`. Implement reputation system: score init at 50, implicit +/- from task outcomes, explicit rate action, per-voter daily cap (±5), auto-hide below threshold (20). | 50 | 4.1, 3.2 | Purge completes <60s; verify returns 0; ID retired; new ID generated; reputation increases on success; decreases on failure; explicit rate works; daily cap enforced; auto-hide at <20 |
| 4.5 | **Moderation & Flagging:** `POST /api/community/flag` (flag with reason enum). Auto-hide at 3+ flags from distinct tenants. Pool-side moderation endpoints: queue, approve, remove, ban-source. Human review queue: dashboard data, approve/reject, 7-day expiry. | 35 | 4.1, 3.2 | Flag stores correctly; auto-hide at 3 flags; moderator can approve/remove/ban; ban prevents future shares from anonymous ID; review queue holds lessons; approve sends to pool; reject blocks; 7-day expiry works |

### Epic 6: Delegation — Audit (Story 6.5)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 6.5 | **Delegation Audit & Logging:** Full delegation audit trail in `delegation_log` — both inbound and outbound. Include: direction, agent, anonymous target/source, taskType, status, timing, cost. `GET /api/agents/:id/delegations` endpoint. `GET /api/audit/export?type=delegation`. 90-day retention (configurable). Volume alerts for delegation. | 30 | 6.2 | Audit log captures all delegation events; both directions logged; export as JSON works; retention enforced; volume alerts fire |

### Epic 2: Redaction Pipeline (Story 2.5)

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 2.5 | **Redaction Plugin API:** Implement custom `RedactionLayer` registration. Plugin receives content + context, returns redacted content + findings. Plugin ordering via `order` field. Plugin errors trigger fail-closed. Documentation of plugin interface. | 15 | 2.3 | Custom layer runs in correct order; findings aggregated; error blocks sharing; multiple custom layers supported; interface documented |

**Parallelism:** All three tracks can run in parallel.

```
Track A: [== 2.5 ==]
Track B: [===== 4.4 =====][=== 4.5 ===]
Track C: [=== 6.5 ===]
```

**Batch 6 test count: ~130**

---

## Batch 7: Dashboard, MCP Tools & Integration Tests

**Goal:** Build all dashboard pages, register MCP tools, run full integration test suites.

**Duration:** 3 days

### Epic 7: Dashboard, MCP Tools & Documentation

| # | Story | Est. Tests | Depends On | AC |
|---|-------|-----------|------------|-----|
| 7.1 | **MCP Tools:** Register `agentlens_community` (share/search/rate actions), `agentlens_discover` (capability discovery), `agentlens_delegate` (task delegation). Follow existing `agentlens_*` patterns. Zod schemas for all params. Route to CommunityService/DiscoveryService. | 40 | 4.1, 5.3, 6.1 | All 3 tools registered; share via MCP works end-to-end; search via MCP returns results; discover via MCP returns capabilities; delegate via MCP completes cycle; rate via MCP updates reputation; error handling matches existing tool patterns |
| 7.2 | **Dashboard — Sharing Controls & Community Browser:** "Sharing Controls" page (tenant/agent/category toggles, deny-list management, sharing status panel). "Community Knowledge" page (search, category filter, reputation sort). "Sharing Activity" feed. Redaction diff viewer for review queue. Kill Switch button with confirmation. | 35 | 4.3, 4.4, 4.5 | All controls functional; toggle changes take effect; deny-list CRUD; community browser searches and displays; reputation sort works; redaction diff shown; kill switch with confirmation |
| 7.3 | **Dashboard — Discovery & Delegation:** "Agent Network" page (graph visualization of delegations, filter by time/taskType/agent). "Capability Registry" page (list registered capabilities, show public if enabled). "Delegation Log" page (all delegations with status/timing/cost). | 30 | 6.5, 5.2 | Network graph renders with nodes/edges; filters work; capability list shows all registered; delegation log shows all events; cross-tenant capabilities shown when enabled |
| 7.4 | **Sharing Audit & Export:** `GET /api/community/audit` with type/date filters. `GET /api/audit/export?type=sharing` JSON export. Volume alert configuration (threshold, notification method). Dashboard audit viewer. | 25 | 4.1 | Audit query returns filtered results; export produces valid JSON; volume alerts configurable; dashboard shows audit events |
| 7.5 | **End-to-End Integration Tests:** Full share→query→rate cycle across two simulated tenants. Full register→discover→delegate→return cycle. Kill switch purge+verify cycle. Toggle enforcement at all levels. Rate limiting across all endpoints. Anonymous ID rotation verification. Pool unavailability graceful degradation. | 60 | All | All integration test suites pass; cross-tenant sharing works with no identity leakage; delegation cycle completes; kill switch purges within 60s; graceful degradation on pool failure |
| 7.6 | **Documentation:** Sharing setup guide. Privacy controls reference. Discovery & delegation quickstart. Privacy & Security architecture page. API documentation (OpenAPI spec for all new endpoints). Redaction plugin development guide. | 5 | All | All docs written; API spec auto-generates; examples for every endpoint; privacy page explains pipeline; plugin guide with example |

**Parallelism:** 7.1, 7.2, 7.3 can run in parallel → 7.4, 7.5 after → 7.6 last.

```
[=== 7.1 ===]
[=== 7.2 ===]
[=== 7.3 ===]
             [=== 7.4 ===]
             [======= 7.5 =======]
                                  [=== 7.6 ===]
```

**Batch 7 test count: ~195**

---

## Summary

### Estimated Total Test Count

| Epic | Tests |
|------|-------|
| E1: Core Types & Schema | 62 |
| E2: Redaction Pipeline | 420 |
| E3: Pool Server | 105 |
| E4: Community Sharing | 195 |
| E5: Discovery | 135 |
| E6: Delegation | 175 |
| E7: Dashboard, MCP, Docs, Integration | 195 |
| **Total** | **~1,287** |

### Batch Execution Summary

| Batch | Duration | Parallel Agents | Stories | Tests | Key Deliverable |
|-------|----------|----------------|---------|-------|----------------|
| B0 | 0.5d | 1 | 0.1 | — | Clean baseline confirmed |
| B1 | 1d | 2 | 1.1–1.4 | 62 | Branded types + schema + anon IDs |
| B2 | 2.5d | 2 | 2.1–2.3, 5.1–5.2 | 215 | Redaction pipeline + capability store |
| B3 | 2d | 2 | 2.4, 5.3–5.4 | 325 | Adversarial tests locked + discovery protocol |
| B4 | 2d | 2→3 | 3.1–3.3, 6.1–6.2 | 190 | Pool server + delegation core |
| B5 | 2d | 2 | 4.1–4.3, 6.3–6.4 | 170 | Sharing live + trust scoring |
| B6 | 1.5d | 3 | 2.5, 4.4–4.5, 6.5 | 130 | Kill switch + reputation + audit |
| B7 | 3d | 3→2→1 | 7.1–7.6 | 195 | Dashboard + MCP + integration + docs |
| **Total** | **~14.5d** | | **32** | **~1,287** | |

### Risk Flags

| Batch | Risk | Severity | Mitigation |
|-------|------|----------|------------|
| B2 | Shannon entropy tuning — false positives on legitimate content | High | Calibrate against real lesson data; add allowlist for known safe patterns |
| B3 | Adversarial evasion patterns may reveal pipeline gaps | High | Budget extra time; fix pipeline before proceeding; this is the quality gate |
| B4 | Pool server is a new package — pgvector setup, mTLS complexity | Medium | Use Docker for PostgreSQL+pgvector in tests; defer full mTLS to B7 |
| B4 | Delegation polling latency vs <200ms overhead target | Medium | Measure early; consider WebSocket upgrade path if polling too slow |
| B5 | Sharing flow has many moving parts (toggles + redaction + pool + audit) | Medium | Integration test immediately after wiring |
| B6 | Kill switch 60s SLA with large lesson counts | Low | Pool uses indexed DELETE; test with 100K lessons |
| B7 | Dashboard has 3 new pages — largest UI batch | Medium | Scaffold early; use existing component patterns; 3 parallel agents |
| All | NER/Presidio dependency — optional but improves PII detection | Low | Default to regex-only; Presidio integration as optional enhancement |

### Dependency Graph (Story Level)

```
1.1 ──→ 1.2
  │  ╲   
  │   ╲──→ 2.1 ──→ 2.3 ──→ 2.4 ──→ (B5 gate for 4.1)
  │        2.2 ──↗     ╲──→ 2.5
  │
  ├──→ 1.3 ──→ 1.4
  │      │        ╲──→ 5.2
  │      │──→ 4.3
  │      ╲──→ 5.1 ──→ 5.2 ──→ 5.3 ──→ 5.4 ──→ 6.1 ──→ 6.2 ──→ 6.3
  │                    │                  ╲──→ 6.4
  │                    │                         ╲──→ 6.5
  │                    │
  ╰──→ 3.1 ──→ 3.2 ──→ 4.1 ──→ 4.2
               3.3 ╱        ╲──→ 4.4 ──→ 4.5
                              ╲──→ 7.1
                                   7.2 ←── 4.3, 4.4, 4.5
                                   7.3 ←── 6.5, 5.2
                                   7.4 ←── 4.1
                                   7.5 ←── ALL
                                   7.6 ←── ALL
```

---

*End of Sprint Plan. 32 stories, 7 epics, 8 batches, ~1,287 estimated tests. Privacy-first ordering enforced throughout.*

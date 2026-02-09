# AgentLens v0.9.0 — Product Requirements Document

## Phase 4: Agent Memory Sharing & Agent-to-Agent Discovery

**Date:** 2026-02-09
**Author:** John (Product Manager, BMAD Pipeline)
**Source:** Phase 4 Product Brief (Paige, 2026-02-09)
**Status:** Draft
**Version:** 0.1

---

## Table of Contents

1. [Overview](#1-overview)
2. [Personas](#2-personas)
3. [User Stories](#3-user-stories)
4. [Functional Requirements — Agent Memory Sharing](#4-functional-requirements--agent-memory-sharing)
5. [Functional Requirements — Agent-to-Agent Discovery](#5-functional-requirements--agent-to-agent-discovery)
6. [Privacy Requirements](#6-privacy-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Risks & Mitigations](#9-risks--mitigations)
10. [Dependencies](#10-dependencies)
11. [Success Metrics](#11-success-metrics)
12. [Open Questions](#12-open-questions)

---

## 1. Overview

AgentLens v0.9.0 introduces two network-effect features that evolve the platform from single-tenant observability into a collaborative agent ecosystem:

- **Agent Memory Sharing** — Opt-in, anonymized cross-tenant lesson sharing. Agents contribute redacted lessons to a shared knowledge pool and query it for relevant insights.
- **Agent-to-Agent Discovery** — MCP-native service mesh enabling capability-based agent delegation with trust scoring derived from AgentLens health data.

**Guiding principle:** Privacy is the #1 requirement. Every sharing feature has a corresponding privacy requirement. The shared pool is assumed hostile. All data leaving a tenant boundary is multi-layer redacted. Opt-in is granular. Kill switch is instant.

---

## 2. Personas

### P1: Platform Engineer (Maya)
- Runs 10–30 agents across multiple teams in a mid-size company
- Wants to reduce redundant learning across agents and enable inter-agent delegation
- Needs strong privacy controls to satisfy compliance team before enabling sharing
- Power user of the AgentLens dashboard

### P2: Solo AI Developer (Alex)
- Runs 1–3 agents for side projects or a small product
- Wants access to community knowledge without contributing much (asymmetric value)
- Would register agent capabilities to gain access to specialized peers
- Values simplicity — sharing should be < 5 minutes to enable

### P3: Enterprise Security Lead (Jordan)
- Approves or blocks feature adoption based on data privacy risk
- Needs to audit exactly what leaves the tenant boundary
- Wants kill switch, purge verification, and deny-lists before signing off
- Will red-team the redaction pipeline

### P4: AI Agent (automated)
- Calls MCP tools (`agentlens_community`, `agentlens_discover`, `agentlens_delegate`)
- Must operate within permission boundaries set by its admin
- Delegates tasks to discovered peers and consumes shared lessons
- Has no concept of privacy — that's the platform's job

### P5: Community Moderator (Sam)
- Reviews flagged shared lessons for quality and safety
- Removes poisoned or low-quality content from the shared pool
- Monitors discovery registry for abusive capability registrations

---

## 3. User Stories

### Agent Memory Sharing

| ID | As a... | I want to... | So that... |
|----|---------|-------------|------------|
| US-01 | Platform Engineer | enable memory sharing for specific agents and categories | I control exactly what knowledge leaves my tenant |
| US-02 | AI Agent | query the shared knowledge pool for lessons relevant to my current task | I avoid repeating mistakes other agents have already solved |
| US-03 | Platform Engineer | review lessons before they enter the shared pool | I can catch anything the redaction pipeline missed |
| US-04 | Enterprise Security Lead | see an audit log of every lesson shared and every query made | I can prove compliance and detect anomalies |
| US-05 | Enterprise Security Lead | instantly purge all my tenant's contributions from the shared pool | I can respond to a data incident in seconds, not hours |
| US-06 | Solo Developer | browse community lessons on the dashboard | I can learn from the ecosystem without writing code |
| US-07 | Platform Engineer | configure deny-list patterns (e.g., "Project X", specific domains) | content matching those patterns is never shared regardless of other settings |
| US-08 | AI Agent | receive relevance-ranked lessons with reputation scores | I can prioritize high-quality community knowledge |
| US-09 | Community Moderator | flag, review, and remove lessons from the shared pool | I can keep the knowledge pool clean and trustworthy |
| US-10 | Platform Engineer | see the redaction diff (before/after) for each shared lesson | I can verify the pipeline is working correctly |

### Agent-to-Agent Discovery

| ID | As a... | I want to... | So that... |
|----|---------|-------------|------------|
| US-11 | Platform Engineer | register my agent's capabilities with structured metadata | other agents (internal or external) can discover it |
| US-12 | AI Agent | query for agents that can perform a specific task type | I can delegate work I'm not equipped to handle |
| US-13 | AI Agent | delegate a task to a discovered agent and receive results | I can compose multi-agent workflows at runtime |
| US-14 | Platform Engineer | restrict discovery to tenant-internal only (default) | my agents are not exposed to external tenants unless I opt in |
| US-15 | Platform Engineer | set a minimum trust score threshold for delegation targets | my agents only delegate to peers above my quality bar |
| US-16 | Enterprise Security Lead | see a full audit trail of all delegations (who, what, when, result) | I can trace every cross-agent interaction |
| US-17 | Platform Engineer | visualize the agent network graph on the dashboard | I can understand delegation patterns and dependencies |
| US-18 | AI Agent | receive delegation requests, decide to accept/reject, and return results | I can serve as a capability provider in the mesh |
| US-19 | Platform Engineer | set rate limits on inbound delegation requests per agent | my agents aren't overwhelmed by external demand |
| US-20 | Community Moderator | review and remove abusive capability registrations | the discovery registry stays trustworthy |

---

## 4. Functional Requirements — Agent Memory Sharing

### 4.1 Sharing Protocol

| ID | Requirement |
|----|------------|
| FR-01 | The system SHALL allow agents to mark individual lessons as "shareable" via the `agentlens_community` MCP tool with a `share` action. |
| FR-02 | The system SHALL allow admins to configure rule-based auto-sharing: share all lessons matching specified categories, agents, or tags. |
| FR-03 | The system SHALL support a manual sharing mode where lessons are queued for admin review before entering the redaction pipeline. |
| FR-04 | The system SHALL expose `POST /api/community/share` to submit a lesson for sharing (triggers redaction pipeline). |
| FR-05 | Shared lessons SHALL include: redacted content, category tags, embedding vector, anonymized quality signals (success rate, usage count), and a lesson hash. |
| FR-06 | The system SHALL reject sharing attempts when the tenant-level or agent-level sharing toggle is disabled. |
| FR-07 | Each shared lesson SHALL be assigned a globally unique anonymous ID with no correlation to the source tenant. |

### 4.2 Query Interface

| ID | Requirement |
|----|------------|
| FR-08 | The system SHALL expose `agentlens_community` MCP tool with a `search` action accepting a natural-language query and optional category filter. |
| FR-09 | The system SHALL expose `GET /api/community/search` with parameters: `query` (text), `category` (enum), `minReputation` (number), `limit` (number, default 10). |
| FR-10 | Search SHALL use embedding similarity (cosine distance) against the shared pool's vector index. |
| FR-11 | Search results SHALL include: lesson content, category, reputation score, and retrieval rank. |
| FR-12 | Search results SHALL NOT include any metadata that could identify the contributing tenant. |
| FR-13 | The system SHALL log every search query and the IDs of returned lessons for audit purposes. |

### 4.3 Reputation System

| ID | Requirement |
|----|------------|
| FR-14 | Each shared lesson SHALL have a reputation score (0–100), initialized at 50. |
| FR-15 | Reputation SHALL increase when a lesson is retrieved and the retrieving agent's subsequent task succeeds (implicit positive signal). |
| FR-16 | Reputation SHALL decrease when a lesson is retrieved and the retrieving agent's subsequent task fails (implicit negative signal). |
| FR-17 | The system SHALL support explicit feedback: agents can call `agentlens_community` with a `rate` action (helpful / not helpful) on a retrieved lesson. |
| FR-18 | Lessons with reputation below a configurable threshold (default: 20) SHALL be auto-hidden from search results. |
| FR-19 | The reputation algorithm SHALL be resistant to gaming: a single tenant's feedback SHALL NOT move a score by more than 5 points per day. |

### 4.4 Shared Knowledge Store

| ID | Requirement |
|----|------------|
| FR-20 | The shared pool SHALL be implemented as a PostgreSQL database with pgvector extension for MVP. |
| FR-21 | The shared pool SHALL support self-hosted deployment (org-internal pool) and community-hosted deployment (public pool) using the same protocol. |
| FR-22 | The shared pool endpoint SHALL be configurable per tenant (`community.poolEndpoint` in config). |
| FR-23 | The system SHALL support connecting to multiple pools simultaneously (e.g., org-internal + community). |

### 4.5 Dashboard — Community Knowledge

| ID | Requirement |
|----|------------|
| FR-24 | The dashboard SHALL include a "Community Knowledge" page listing shared lessons with search, category filter, and reputation sort. |
| FR-25 | The dashboard SHALL include a "Sharing Controls" page with tenant-level, agent-level, and category-level toggles. |
| FR-26 | The dashboard SHALL show a "Sharing Activity" feed: recent shares, queries, and reputation changes. |
| FR-27 | The dashboard SHALL display the redaction diff (original → redacted) for lessons pending human review. |
| FR-28 | The dashboard SHALL include a "Kill Switch" button with confirmation dialog that triggers `DELETE /api/community/purge`. |

### 4.6 Kill Switch & Opt-Out

| ID | Requirement |
|----|------------|
| FR-29 | `DELETE /api/community/purge` SHALL remove ALL of a tenant's shared lessons from the pool within 60 seconds. |
| FR-30 | The purge operation SHALL be idempotent — calling it multiple times produces the same result. |
| FR-31 | The system SHALL expose `GET /api/community/purge/verify` that confirms zero lessons from the tenant remain in the pool. |
| FR-32 | Disabling the tenant-level sharing toggle SHALL immediately stop all future sharing AND prevent the tenant's agents from sharing (but does not auto-purge existing shared lessons — purge is a separate action). |
| FR-33 | The system SHALL display a clear distinction in the UI between "stop sharing" (future) and "purge" (remove existing). |

### 4.7 Moderation

| ID | Requirement |
|----|------------|
| FR-34 | The shared pool SHALL support flagging lessons (by any querying tenant) with a reason enum: `spam`, `harmful`, `low-quality`, `sensitive-data`. |
| FR-35 | Lessons receiving flags from 3+ distinct tenants SHALL be auto-hidden pending moderator review. |
| FR-36 | The system SHALL expose moderation endpoints: `GET /api/community/moderation/queue`, `POST /api/community/moderation/:id/action` (approve, remove, ban-source). |
| FR-37 | The `ban-source` action SHALL prevent a specific anonymous contributor from sharing future lessons (without revealing their tenant identity to the moderator). |

---

## 5. Functional Requirements — Agent-to-Agent Discovery

### 5.1 Capability Registry

| ID | Requirement |
|----|------------|
| FR-38 | Agents SHALL register capabilities via `PUT /api/agents/:id/capabilities` with a structured schema: `taskType` (enum), `inputSchema` (JSON Schema), `outputSchema` (JSON Schema), `qualityMetrics` (object). |
| FR-39 | The system SHALL define a standard `taskType` enum with initial values: `translation`, `summarization`, `code-review`, `data-extraction`, `classification`, `generation`, `analysis`, `transformation`, `custom`. |
| FR-40 | The `custom` task type SHALL accept a `customType` string field (max 64 chars, alphanumeric + hyphens only). |
| FR-41 | Capability registrations SHALL include: supported input/output MIME types, estimated latency range, cost range, and maximum input size. |
| FR-42 | The system SHALL validate capability registrations against the schema and reject malformed entries. |
| FR-43 | Agents SHALL be able to update or remove their capability registrations at any time. |
| FR-44 | Capability registrations SHALL default to `scope: internal` (visible only within the tenant). Cross-tenant visibility requires explicit `scope: public` and tenant-level opt-in. |

### 5.2 Discovery Protocol

| ID | Requirement |
|----|------------|
| FR-45 | The system SHALL expose `agentlens_discover` MCP tool accepting: `taskType`, `inputType`, `outputType`, `minTrustScore`, `maxCost`, `maxLatency`, `scope` (internal/public/all). |
| FR-46 | The system SHALL expose `GET /api/agents/discover` with the same parameters as the MCP tool. |
| FR-47 | Discovery results SHALL include: anonymous agent ID, task type, quality metrics, trust score (percentile), estimated cost, estimated latency. |
| FR-48 | Discovery results SHALL be ranked by a composite score: `0.5 * trustScore + 0.3 * costEfficiency + 0.2 * latencyScore`. |
| FR-49 | Discovery results SHALL NOT include: agent name, tenant ID, internal agent ID, prompt content, system instructions, or any identifying metadata. |
| FR-50 | The system SHALL return a maximum of 20 discovery results per query. |
| FR-51 | Discovery for `scope: public` SHALL proxy through the AgentLens shared pool — agents never receive direct connection details of peers. |

### 5.3 Delegation Protocol

| ID | Requirement |
|----|------------|
| FR-52 | The system SHALL expose `agentlens_delegate` MCP tool accepting: `targetAgentId` (anonymous), `taskType`, `input` (JSON), `timeoutMs` (default 30000), `callbackUrl` (optional). |
| FR-53 | The system SHALL expose `POST /api/agents/delegate` with the same parameters. |
| FR-54 | Delegation SHALL follow a four-phase protocol: REQUEST → ACCEPT/REJECT → EXECUTE → RETURN. |
| FR-55 | The target agent SHALL receive the delegation request via a webhook or polling endpoint and respond with ACCEPT or REJECT within 5 seconds (configurable). |
| FR-56 | If the target agent does not respond within the accept timeout, the system SHALL return a TIMEOUT error to the requesting agent. |
| FR-57 | Upon ACCEPT, the target agent executes the task and returns the result. The system SHALL enforce the caller's `timeoutMs` — if exceeded, return TIMEOUT. |
| FR-58 | Delegation results SHALL include: `status` (success/error/timeout), `output` (JSON), `executionTimeMs`, `costIncurred`. |
| FR-59 | The system SHALL record the delegation outcome and update the target agent's trust score accordingly (success → increase, failure → decrease). |
| FR-60 | All delegation communication SHALL be proxied through AgentLens — requesting and target agents SHALL NOT communicate directly. |
| FR-61 | The delegation protocol SHALL be idempotent: the same request ID produces the same result (no duplicate execution). |
| FR-62 | The system SHALL support delegation fallback: if the primary target fails, automatically try the next-ranked discovery result (opt-in, max 3 retries). |

### 5.4 Trust Scoring

| ID | Requirement |
|----|------------|
| FR-63 | Trust scores SHALL be derived from health score history: rolling 30-day average of health score, weighted by delegation success rate. |
| FR-64 | Trust scores SHALL be expressed as percentiles (0–100) relative to all agents in the same task type. |
| FR-65 | New agents (< 10 completed delegations) SHALL receive a "provisional" trust score of 50 with a `provisional: true` flag. |
| FR-66 | Trust scores for public-scope agents SHALL be calculated independently from internal-scope scores. |

### 5.5 Permission Model

| ID | Requirement |
|----|------------|
| FR-67 | Agents SHALL explicitly opt-in to being discoverable (default: not discoverable). |
| FR-68 | Agents SHALL explicitly opt-in to accepting delegation requests (default: reject all). |
| FR-69 | Admins SHALL configure which agents may initiate delegation requests (default: none). |
| FR-70 | Admins SHALL configure a tenant-wide minimum trust score for delegation targets (default: 60). |
| FR-71 | Admins SHALL configure rate limits on inbound delegation requests per agent (default: 10/minute). |
| FR-72 | Admins SHALL configure rate limits on outbound delegation requests per agent (default: 20/minute). |

### 5.6 Dashboard — Discovery & Delegation

| ID | Requirement |
|----|------------|
| FR-73 | The dashboard SHALL include an "Agent Network" page showing a graph visualization of agent-to-agent delegations. |
| FR-74 | The dashboard SHALL include a "Capability Registry" page listing all registered capabilities for the tenant's agents. |
| FR-75 | The dashboard SHALL include a "Delegation Log" page showing all delegation requests with status, timing, and cost. |
| FR-76 | The agent network graph SHALL support filtering by time range, task type, and agent. |
| FR-77 | The capability registry browser SHALL show public capabilities from other tenants (if cross-tenant discovery is enabled). |

---

## 6. Privacy Requirements

> 🔒 **This section is mandatory reading for implementation. Every requirement here is P0.**

### 6.1 Redaction Pipeline

| ID | Requirement |
|----|------------|
| PR-01 | ALL lesson content SHALL pass through the multi-layer redaction pipeline BEFORE leaving the tenant boundary. No exceptions. |
| PR-02 | **Layer 1 — Secret detection:** The pipeline SHALL detect and redact API keys, tokens, passwords, and high-entropy strings using pattern matching. Minimum patterns: `sk-*`, `ghp_*`, `AKIA*`, `xoxb-*`, `Bearer *`, `Basic *`, passwords in URLs, and strings with entropy > 4.5 bits/char and length > 16. |
| PR-03 | **Layer 2 — PII detection:** The pipeline SHALL detect and redact personal names, email addresses, phone numbers, physical addresses, SSNs, and credit card numbers using a combination of NER (spaCy/Presidio) and regex patterns. |
| PR-04 | **Layer 3 — URL/path scrubbing:** The pipeline SHALL detect and replace internal URLs (non-public hostnames), file system paths, IP addresses (private ranges), and internal hostnames with placeholders (`[INTERNAL_URL]`, `[FILE_PATH]`, `[IP_ADDRESS]`). |
| PR-05 | **Layer 4 — Tenant de-identification:** The pipeline SHALL strip all tenant IDs, user IDs, organization names, project names, and agent names. Replaced with anonymous tokens. |
| PR-06 | **Layer 5 — Semantic deny-list:** The pipeline SHALL check content against a tenant-configurable deny-list of terms, phrases, and regex patterns. Any match blocks the lesson from sharing entirely (not redacted — blocked). |
| PR-07 | **Layer 6 — Human review gate:** The pipeline SHALL support an optional admin approval queue. When enabled, lessons are held until an admin approves or rejects them. Default: disabled. |
| PR-08 | The redaction pipeline SHALL run locally within the tenant's AgentLens instance. Raw (pre-redaction) content SHALL NEVER be transmitted to the shared pool or any external service. |
| PR-09 | Each redaction layer SHALL log what it found and redacted (category, position, replacement) to the tenant-local audit log. |
| PR-10 | The redaction pipeline SHALL be pluggable: tenants can add custom redaction layers via a plugin interface (function receiving content, returning redacted content + redaction log). |
| PR-11 | The pipeline SHALL operate in "fail-closed" mode: if any layer errors, the lesson is NOT shared. Errors are logged and the admin is notified. |
| PR-12 | The system SHALL include a redaction test suite of 200+ known sensitive patterns (API keys, PII, URLs) that runs in CI. Pipeline changes require 100% detection rate on this suite. |
| PR-13 | The system SHALL provide a `POST /api/community/redaction/test` endpoint that runs the pipeline on sample content and returns the redacted output WITHOUT sharing it — for admin verification. |

### 6.2 Opt-In / Opt-Out Controls

| ID | Requirement |
|----|------------|
| PR-14 | Sharing SHALL be opt-in at every level. Default state for all sharing toggles: OFF. |
| PR-15 | **Tenant level:** Master toggle. When OFF, no agent in the tenant can share and no sharing UI is visible. |
| PR-16 | **Agent level:** Per-agent toggle. Independent of other agents. Requires tenant-level toggle to also be ON. |
| PR-17 | **Category level:** Per-category toggle per agent. Categories: `model-performance`, `error-patterns`, `tool-usage`, `cost-optimization`, `prompt-engineering`, `general`. Default: all OFF. |
| PR-18 | **Content rules:** Deny-list patterns (PR-06) override all other settings — a matching lesson is never shared even if all toggles are ON. |
| PR-19 | Changing any toggle from ON to OFF SHALL take effect within 1 second — no in-flight shares after toggle-off. |
| PR-20 | The UI SHALL clearly display the current sharing state at each level (tenant, agent, category) in a single "Sharing Status" panel. |

### 6.3 Discovery Metadata Privacy

| ID | Requirement |
|----|------------|
| PR-21 | Capability descriptions SHALL use only the structured `taskType` enum and JSON Schema — no free-text description fields. |
| PR-22 | Discovery results SHALL NOT contain: agent names, tenant identifiers, internal IDs, prompt templates, system instructions, model names, or any field not explicitly listed in FR-47. |
| PR-23 | Health scores exposed in discovery SHALL be expressed as percentiles, not raw values, to prevent fingerprinting. |
| PR-24 | The system SHALL assign a rotating anonymous ID to each discoverable agent. IDs rotate every 24 hours. The mapping (anonymous ID → real agent) is stored only in the source tenant's local database. |
| PR-25 | Delegation requests and responses SHALL be proxied through the AgentLens shared pool — no direct network connections between agents of different tenants. |

### 6.4 Audit Trail

| ID | Requirement |
|----|------------|
| PR-26 | Every share event SHALL be logged locally: timestamp, lesson hash (SHA-256), redaction layers applied, redaction findings summary, destination pool, and resulting anonymous lesson ID. |
| PR-27 | Every query event SHALL be logged locally: timestamp, query text, results returned (anonymous IDs), and user/agent that initiated the query. |
| PR-28 | Every delegation event SHALL be logged locally (both sides): timestamp, task type, anonymous target/source ID, request size, response size, status, execution time, cost. |
| PR-29 | Audit logs SHALL be retained for a minimum of 90 days (configurable, max unlimited). |
| PR-30 | Audit logs SHALL be exportable as JSON via `GET /api/audit/export?type=sharing&from=DATE&to=DATE`. |
| PR-31 | The system SHALL alert admins (configurable: email, webhook, dashboard notification) when sharing volume exceeds a configurable threshold (default: 100 lessons/day) — potential exfiltration signal. |

### 6.5 Kill Switch

| ID | Requirement |
|----|------------|
| PR-32 | `DELETE /api/community/purge` SHALL remove all of the tenant's shared lessons from the pool within 60 seconds. |
| PR-33 | The purge SHALL be verified by `GET /api/community/purge/verify` which returns a count of remaining lessons (expected: 0) and a verification timestamp. |
| PR-34 | The shared pool SHALL NOT cache shared lessons on the client side. All queries go to the pool server. This ensures purge is effective. |
| PR-35 | The shared pool SHALL use a single-writer model per tenant — no replicas or caches that could retain purged data. |
| PR-36 | After purge, the tenant's anonymous contributor ID SHALL be retired — if the tenant re-enables sharing, a new anonymous ID is generated. |
| PR-37 | The kill switch SHALL work even if the AgentLens instance is offline — the purge request goes directly to the pool and authenticates via a pre-shared purge token. |

### 6.6 Zero-Trust & Compliance

| ID | Requirement |
|----|------------|
| PR-38 | All communication between tenant instances and the shared pool SHALL use mTLS. |
| PR-39 | The shared pool SHALL store zero metadata that could identify the source tenant. The only link is the anonymous contributor ID, which maps to the real tenant only in the tenant's local database. |
| PR-40 | Rate limiting SHALL be enforced on share operations: maximum 50 lessons per hour per tenant (configurable). Exceeding the limit blocks further sharing until the window resets. |
| PR-41 | The system SHALL support data residency configuration: pool endpoint selection by region (EU, US, self-hosted). |
| PR-42 | The system SHALL support right-to-deletion: `DELETE /api/community/purge` satisfies this. Purge verification (PR-33) provides proof of deletion. |
| PR-43 | The system SHALL implement data minimization: shared lessons contain only the redacted content, category, embedding, and reputation score. No timestamps, no usage metadata, no behavioral data. |
| PR-44 | The redaction pipeline SHALL be auditable: the full pipeline code is open source, and the tenant can inspect exactly what transformations are applied. |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| ID | Requirement |
|----|------------|
| NFR-01 | Shared pool search latency SHALL be < 200ms at p95 for pools up to 1M lessons. |
| NFR-02 | Redaction pipeline processing time SHALL be < 500ms per lesson at p95. |
| NFR-03 | Discovery query latency SHALL be < 100ms at p95 for registries up to 10K agents. |
| NFR-04 | Delegation overhead (request routing, not task execution) SHALL be < 200ms at p95. |
| NFR-05 | Kill switch purge SHALL complete within 60 seconds regardless of the number of lessons (up to 100K per tenant). |

### 7.2 Scalability

| ID | Requirement |
|----|------------|
| NFR-06 | The shared pool SHALL support up to 10M lessons without architectural changes. |
| NFR-07 | The capability registry SHALL support up to 100K registered capabilities. |
| NFR-08 | The delegation proxy SHALL support up to 1000 concurrent delegations per pool instance. |

### 7.3 Reliability

| ID | Requirement |
|----|------------|
| NFR-09 | Shared pool unavailability SHALL NOT affect tenant-local AgentLens functionality. All core features work offline. |
| NFR-10 | Failed sharing attempts SHALL be retried up to 3 times with exponential backoff (only if the failure is transient, e.g., network). Redaction failures are never retried. |
| NFR-11 | Delegation timeouts SHALL return a clear error to the requesting agent with the option to fallback (FR-62). |

### 7.4 Testing

| ID | Requirement |
|----|------------|
| NFR-12 | Redaction pipeline test coverage SHALL be ≥ 95% (line coverage). |
| NFR-13 | Overall Phase 4 code test coverage SHALL be ≥ 85%. |
| NFR-14 | The project SHALL include an adversarial redaction test suite (PR-12) that is run on every CI build. |
| NFR-15 | Integration tests SHALL cover the full share → query → retrieve → rate cycle. |
| NFR-16 | Integration tests SHALL cover the full register → discover → delegate → return cycle. |
| NFR-17 | A red-team test suite SHALL attempt to extract tenant identity from shared pool data — 0% success rate required. |

### 7.5 Compatibility

| ID | Requirement |
|----|------------|
| NFR-18 | All new MCP tools SHALL follow the existing `agentlens_*` naming convention and tool registration patterns. |
| NFR-19 | All new REST endpoints SHALL follow existing API conventions (JSON request/response, standard error format, OpenAPI spec). |
| NFR-20 | Dashboard pages SHALL follow existing React + Tailwind patterns and be accessible (WCAG 2.1 AA). |
| NFR-21 | Both features SHALL work in fully self-hosted mode with no external service dependency. The shared pool can be local (same instance), org-hosted, or community-hosted. |

### 7.6 Documentation

| ID | Requirement |
|----|------------|
| NFR-22 | User-facing documentation SHALL cover: sharing setup guide, privacy controls reference, discovery & delegation quickstart. |
| NFR-23 | API documentation SHALL be auto-generated from OpenAPI spec and include examples for every endpoint. |
| NFR-24 | A "Privacy & Security" documentation page SHALL explain the redaction pipeline, zero-trust model, and audit capabilities. |

---

## 8. Acceptance Criteria

### 8.1 Agent Memory Sharing

| AC | Criterion |
|----|-----------|
| AC-01 | A tenant with sharing enabled can share a lesson via MCP tool and it appears in the shared pool (redacted). |
| AC-02 | A different tenant can search the shared pool and retrieve the lesson. No identifying information is present. |
| AC-03 | The redaction pipeline correctly strips all 200+ test patterns from the adversarial test suite. |
| AC-04 | Disabling the tenant-level toggle immediately prevents new shares (verified within 1 second). |
| AC-05 | Kill switch purges all tenant lessons from the pool within 60 seconds. Verification endpoint confirms 0 remaining. |
| AC-06 | Human review gate holds lessons until admin approval; rejected lessons are never shared. |
| AC-07 | Deny-list patterns block matching lessons from sharing entirely. |
| AC-08 | Reputation scores update based on implicit and explicit feedback. |
| AC-09 | Auto-hidden lessons (reputation < threshold) do not appear in search results. |
| AC-10 | Audit log captures every share and query event with required fields. |
| AC-11 | Dashboard shows sharing controls, community browser, activity feed, and redaction diffs. |
| AC-12 | Pipeline fails closed: a broken redaction layer prevents sharing and notifies admin. |

### 8.2 Agent-to-Agent Discovery

| AC | Criterion |
|----|-----------|
| AC-13 | An agent can register capabilities via REST API and MCP tool. |
| AC-14 | A discovering agent finds registered capabilities filtered by task type and trust score. |
| AC-15 | Discovery results contain no identifying metadata (verified by inspection and red-team test). |
| AC-16 | Delegation completes the full REQUEST → ACCEPT → EXECUTE → RETURN cycle. |
| AC-17 | Delegation timeout returns a clear error within the specified timeout + 1 second. |
| AC-18 | Delegation fallback (FR-62) retries with the next-ranked agent on failure (when enabled). |
| AC-19 | Internal-scope discovery returns only tenant-local agents. Public scope returns cross-tenant. |
| AC-20 | Trust scores update after delegation outcomes. |
| AC-21 | Rate limits on inbound/outbound delegations are enforced. Exceeding returns 429. |
| AC-22 | Dashboard shows agent network graph, capability registry, and delegation log. |
| AC-23 | Anonymous IDs rotate every 24 hours; old IDs resolve to nothing. |
| AC-24 | All delegation traffic is proxied — no direct agent-to-agent network connections. |

---

## 9. Risks & Mitigations

| # | Risk | Severity | Probability | Mitigation |
|---|------|----------|-------------|------------|
| R1 | Redaction pipeline misses sensitive data | Critical | Medium | Multi-layer defense (6 layers), fail-closed mode, adversarial test suite (200+ patterns), optional human review gate, conservative defaults, regular red-team exercises |
| R2 | Shared pool poisoning (malicious/misleading lessons) | High | Medium | Reputation scoring with gaming resistance (PR-19), community flagging (FR-34), auto-hide threshold (FR-18), moderator tools (FR-36), ban capability (FR-37) |
| R3 | Discovery metadata leaks internal architecture | High | Low | Structured schema only (no free text), proxy all communication, rotating anonymous IDs, red-team test suite |
| R4 | Low adoption → thin pool → no value | High | Medium | Seed pool with synthetic/public lessons (e.g., known model behaviors), show value before asking for contribution (read-only access first), frictionless opt-in (<5 min) |
| R5 | Kill switch fails to fully purge | Critical | Low | Single-writer architecture, no client-side caching (PR-34), verification endpoint (PR-33), retire anonymous ID on purge (PR-36) |
| R6 | Delegation to untrusted agents produces bad results | Medium | Medium | Trust threshold defaults (FR-70), provisional flag for new agents (FR-65), delegation fallback (FR-62), result validation by requesting agent |
| R7 | Performance degradation from redaction pipeline | Low | Low | Async processing, not on hot path, <500ms SLA (NFR-02) |
| R8 | Legal/compliance concerns with cross-tenant data | Medium | Medium | Zero metadata in pool (PR-39), data minimization (PR-43), right-to-deletion via purge (PR-42), data residency options (PR-41), open-source pipeline for auditability (PR-44) |
| R9 | Rate-limit bypass for data exfiltration via sharing | Medium | Low | Rate limiting (PR-40), volume alerts (PR-31), audit trail (PR-26) |
| R10 | Anonymous ID correlation attacks (de-anonymization) | High | Low | 24-hour ID rotation (PR-24), no timestamps in shared data (PR-43), no behavioral metadata |

---

## 10. Dependencies

| Dependency | Type | Status | Notes |
|-----------|------|--------|-------|
| v0.8.0 features (guardrails, plugins) | Internal | Required | Phase 4 builds on Phase 3 infrastructure |
| Health scores (v0.6.0) | Internal | Required | Trust scoring derives from health scores |
| Reflect/lessons infrastructure (v0.5.0) | Internal | Required | Memory sharing builds on existing lesson storage |
| Embeddings/vector search (v0.5.0) | Internal | Required | Shared pool search uses embedding similarity |
| MCP tool infrastructure (v0.5.0) | Internal | Required | New MCP tools follow existing patterns |
| PostgreSQL + pgvector | External | Available | Shared pool storage for MVP |
| spaCy or Presidio | External | Available | PII detection in redaction pipeline (Layer 2) |
| mTLS certificate infrastructure | External | Required | Secure pool communication |

---

## 11. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Redaction pipeline leak rate | **0%** on adversarial test suite | CI test suite (200+ patterns) + quarterly red-team |
| Kill switch purge latency | **< 60 seconds** | Integration test, monitored in production |
| Time to first shared lesson (new tenant) | **< 10 minutes** from enabling sharing | User testing / product analytics |
| Shared pool search latency | **< 200ms** p95 | Performance benchmark |
| Discovery query latency | **< 100ms** p95 | Performance benchmark |
| Delegation round-trip overhead | **< 200ms** p95 (excluding task execution) | Performance benchmark |
| Lesson retrieval usefulness | **> 60%** "helpful" (implicit + explicit signals) | Usage analytics |
| Tenant opt-in rate | **> 20%** of active tenants within 3 months | Product analytics |
| Capability registrations | **> 50 task types** within 3 months | Registry analytics |
| Test coverage — redaction pipeline | **≥ 95%** | CI coverage report |
| Test coverage — overall Phase 4 | **≥ 85%** | CI coverage report |
| Red-team de-anonymization success | **0%** | Quarterly red-team exercise |

---

## 12. Open Questions

| # | Question | Impact | Owner |
|---|----------|--------|-------|
| OQ-1 | Who hosts the community shared pool? AgentLens project? Community-run? Multiple pools? | Architecture | Amit |
| OQ-2 | How do we seed the pool with initial value before network effects? Synthetic lessons from public model evaluations? | Adoption | Product |
| OQ-3 | Should v0.9.0 support cross-language delegation (Python ↔ TypeScript)? | Scope | Architecture |
| OQ-4 | Should discovery/delegation usage be instrumented for future premium features? | Business | Product |
| OQ-5 | Should guardrails (v0.8.0) auto-block delegation to agents below a trust threshold? | Integration | Architecture |
| OQ-6 | What is the governance model for the community shared pool moderators? | Operations | Amit |
| OQ-7 | Should lessons have an expiry/TTL in the shared pool (e.g., model-specific lessons become stale)? | Data quality | Product |

---

*End of PRD. This document contains 77 functional requirements, 44 privacy requirements, and 24 non-functional requirements.*

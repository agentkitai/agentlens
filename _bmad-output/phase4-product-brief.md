# AgentLens v0.9.0 — Product Brief

## Phase 4 Features: Agent Memory Sharing & Agent-to-Agent Discovery

**Date:** 2026-02-09
**Author:** BMAD Product Strategy (Paige)
**Status:** Draft

---

## 1. Executive Summary

AgentLens v0.8.0 delivers a complete single-tenant observability stack: event tracking, session replay, A/B benchmarking, health scores, cost optimization, proactive guardrails, and framework plugins. An organization can deeply understand and control its own agents.

But agents today operate in isolation. Each agent rediscovers the same lessons, makes the same mistakes, and has no way to leverage the collective intelligence of the broader agent ecosystem. Meanwhile, multi-agent architectures are exploding — yet there's no standard way for agents to find and delegate to each other across organizational boundaries.

v0.9.0 introduces two network-effect features that transform AgentLens from a single-tenant tool into a **platform**:

1. **Agent Memory Sharing** — Opt-in cross-tenant lesson sharing. Agents contribute anonymized lessons to a shared knowledge pool and query it for relevant insights. "Stack Overflow for agents."

2. **Agent-to-Agent Discovery** — MCP-native service mesh for agent delegation. Agents register capabilities, discover peers, and delegate tasks — with trust scores derived from AgentLens health data.

Both features are designed around a **zero-trust privacy model**: the shared pool is assumed hostile, all data is multi-layer redacted, opt-in is granular, and a kill switch enables instant purge.

---

## 2. Problem Statements

### 2.1 Agent Memory Sharing

**The problem:** Every agent starts from zero. When an agent learns that "GPT-4o hallucinates on multi-step math" or "retrying Anthropic 529s with exponential backoff works best," that lesson stays locked in one tenant's data. A thousand other agents will independently discover the same thing — burning tokens, time, and user trust.

**The impact:**
- Duplicated learning across the ecosystem (massive collective waste)
- No mechanism for agents to benefit from community experience
- AgentLens captures rich lesson data (via `reflect`) but it stays siloed
- Competitors with cloud-first architectures (LangSmith, Helicone) could build shared intelligence first

**What success looks like:**
- An agent encountering a new task type can query: "What have other agents learned about this?"
- Lessons are anonymized — no tenant identity, no user data, no secrets
- High-quality lessons surface via reputation scoring (think Stack Overflow upvotes)
- Tenants control exactly what categories of knowledge they share
- The shared pool becomes a defensible moat: the more agents contribute, the smarter everyone gets

### 2.2 Agent-to-Agent Discovery

**The problem:** Multi-agent systems today are statically wired. If Agent A needs to summarize a PDF, it must already know about Agent B's PDF capability. There's no runtime discovery, no capability negotiation, no trust-based delegation. Cross-organizational agent collaboration doesn't exist.

**The impact:**
- Building multi-agent workflows requires hardcoded agent references
- No marketplace or registry for agent capabilities
- Agents can't leverage specialized peers (translation, code review, data analysis)
- MCP defines tool protocols but not agent-level service discovery
- No trust signal for delegation — how good is this agent, really?

**What success looks like:**
- Agents register capabilities with AgentLens (e.g., "I can translate EN→FR with 95% accuracy")
- An agent needing translation queries: "Find me an agent that translates EN→FR"
- Discovery returns candidates ranked by health score, cost, and trust reputation
- Delegation follows a request → accept → execute → return protocol
- All delegations are tracked, auditable, and permission-controlled
- Capability metadata is abstract — no leakage of internal prompts, configs, or architecture

---

## 3. Target Users

| Persona | Memory Sharing | Discovery |
|---------|---------------|-----------|
| **Platform teams** running 10+ agents | Primary: reduce redundant learning | Primary: enable inter-agent delegation |
| **Solo developers** with 1-3 agents | Secondary: benefit from community knowledge | Secondary: access specialized capabilities they haven't built |
| **Enterprise AI teams** | Interested but privacy-sensitive — need granular controls | Need: internal-only discovery (within org, not public) |
| **Open-source community** | Contributors to the shared knowledge pool | Providers of niche agent capabilities |

---

## 4. Scope

### 4.1 MVP — In Scope

#### Agent Memory Sharing
- **Sharing protocol:** Agents/admins mark lessons as "shareable" (manual or rule-based)
- **Anonymization pipeline:** Multi-layer redaction before any data leaves the tenant (see §6)
- **Shared knowledge store:** Centralized or federated pool of anonymized lessons
- **Query interface:** `agentlens_community` MCP tool — search shared lessons by topic/embedding similarity
- **Reputation system:** Lessons scored by usefulness (implicit signals: was the lesson retrieved? did it help?)
- **Granular opt-in:** Per-agent, per-category, per-tenant controls
- **Kill switch:** Instant opt-out that purges all contributed lessons from the shared pool
- **Audit trail:** Full log of what was shared, when, and what was retrieved
- **REST API:** `POST /api/community/share`, `GET /api/community/search`, `DELETE /api/community/purge`
- **Dashboard:** Community knowledge browser + sharing controls page

#### Agent-to-Agent Discovery
- **Capability registry:** Agents declare capabilities with structured metadata (task type, input/output schema, quality metrics)
- **Discovery protocol:** `agentlens_discover` MCP tool — query by capability type, constraints, trust threshold
- **Delegation protocol:** `agentlens_delegate` MCP tool — request → accept → execute → return, with timeout and fallback
- **Trust scoring:** Discovery results ranked by health score history, success rate, cost efficiency
- **Permission model:** Agents explicitly opt-in to being discoverable; delegation requires mutual consent
- **Scope control:** Tenant-internal discovery (default) vs. cross-tenant discovery (opt-in)
- **REST API:** `GET /api/agents/discover`, `POST /api/agents/delegate`, `PUT /api/agents/:id/capabilities`
- **Dashboard:** Agent network graph visualization + capability registry browser

### 4.2 Out of Scope (v0.9.0)
- Paid/premium shared knowledge tiers (all open source for now)
- Real-time streaming delegation (request/response only, not streaming)
- Monetary compensation for delegation (no billing between agents)
- Public agent marketplace UI (API/MCP only for MVP)
- Federated/decentralized shared pool architecture (centralized for MVP; federate in v1.0)
- Natural language capability descriptions (structured schema only)
- Cross-language delegation (Python ↔ TypeScript agent calls — same-language only for MVP)

---

## 5. Competitive Differentiation

| Capability | AgentLens v0.9.0 | LangSmith | Helicone | Arize Phoenix |
|------------|-------------------|-----------|----------|---------------|
| Cross-tenant knowledge sharing | ✅ Privacy-first, opt-in | ❌ | ❌ | ❌ |
| Agent-to-agent discovery | ✅ MCP-native | ❌ | ❌ | ❌ |
| Trust-based delegation | ✅ Health score integration | ❌ | ❌ | ❌ |
| Open source | ✅ | ❌ | Partial | ✅ |
| Zero-trust privacy model | ✅ Architectural guarantee | N/A | N/A | N/A |

**Moat:** Network effects compound. Every agent that joins the shared knowledge pool makes the pool more valuable. Every agent that registers capabilities makes the discovery mesh more useful. Competitors would need to build both the observability platform AND the network — AgentLens has the observability foundation already.

---

## 6. Privacy Architecture Requirements

> 🔒 This is the most critical section. Amit's #1 constraint: **NO sensitive data leakage.**

### 6.1 Zero-Trust Model
- The shared pool is assumed hostile. All data entering it is treated as public.
- No trust relationship between tenants. Discovery metadata reveals only abstract capabilities.
- All shared data is write-once from the tenant's perspective — the tenant controls the redacted output.

### 6.2 Multi-Layer Redaction Pipeline
Before any lesson leaves a tenant boundary, it passes through:

| Layer | What It Catches | Method |
|-------|----------------|--------|
| 1. Pattern redaction | API keys, secrets, tokens, passwords | Regex library (high-entropy strings, known key formats: `sk-*`, `ghp_*`, `AKIA*`, etc.) |
| 2. PII detection | Names, emails, phone numbers, addresses | NER model or rule-based (spaCy / presidio) |
| 3. URL/path scrubbing | Internal URLs, file paths, hostnames | URL/path pattern matching, replace with placeholders |
| 4. Tenant de-identification | Tenant IDs, user IDs, org names | Strip all identifiers; assign random anonymous IDs per sharing session |
| 5. Semantic review | Domain-specific sensitive content | Configurable deny-list per tenant (e.g., "never share anything mentioning Project X") |
| 6. Human review gate (optional) | Anything the pipeline missed | Admin approval queue before lessons enter the shared pool |

### 6.3 Granular Opt-In Controls
- **Tenant level:** Master switch — enable/disable all sharing for the tenant
- **Agent level:** Per-agent toggle — which agents may share
- **Category level:** Per-category control — share "model performance" lessons but not "business logic" lessons
- **Content rules:** Deny-list patterns that block sharing even if category is enabled

### 6.4 Discovery Metadata Privacy
- Capability descriptions use a **structured schema** (task type enum + input/output type enum), not free text
- No agent names, internal IDs, prompt content, or system instructions exposed
- Health scores shared as relative percentiles, not raw values
- Delegation requests go through AgentLens as proxy — agents never communicate directly

### 6.5 Audit & Kill Switch
- **Audit log:** Every share event recorded: timestamp, lesson hash, redaction layers applied, destination
- **Every retrieval logged:** Who queried, what was returned, was it useful
- **Kill switch:** `DELETE /api/community/purge` — removes ALL of a tenant's shared lessons from the pool within 60 seconds
- **Kill switch is idempotent and irreversible** — purged data cannot be restored from the shared pool
- **Opt-out kills future sharing immediately** — no grace period, no "are you sure"

### 6.6 Implementation Constraints
- Redaction pipeline runs **locally within the tenant's AgentLens instance** — raw data never leaves
- Only redacted output is transmitted to the shared pool
- Shared pool stores no metadata that could identify the source tenant
- All shared pool communication over mTLS
- Rate limiting on share operations to prevent data exfiltration via high-frequency sharing

---

## 7. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Redaction pipeline misses sensitive data** | Critical | Multi-layer defense, optional human review gate, conservative defaults (block if uncertain), red-team testing |
| **Shared pool poisoning** (malicious lessons) | High | Reputation scoring, anomaly detection, community flagging, admin moderation tools |
| **Discovery metadata leaks internal architecture** | High | Structured schema only (no free text), proxy all communication, metadata review |
| **Low adoption → thin shared pool → no value** | High | Seed pool with synthetic/public lessons, make opt-in frictionless, show value before asking for contribution |
| **Delegation to untrusted agents produces bad results** | Medium | Trust threshold defaults, result validation, automatic health score impact |
| **Kill switch doesn't fully purge** (cached/replicated data) | Medium | Single-writer architecture for shared pool, no client-side caching of shared lessons, purge verification endpoint |
| **Legal/compliance concerns with cross-tenant data** | Medium | Clear ToS for shared pool, data residency options, SOC 2 alignment in design |
| **Performance impact of redaction pipeline** | Low | Async processing, redaction is not on the hot path (batch, not real-time) |

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Redaction pipeline leak rate | 0% in adversarial testing | Red-team test suite with known sensitive patterns |
| Kill switch purge latency | < 60 seconds | Integration test |
| Time to first shared lesson (new tenant) | < 10 minutes | User testing |
| Shared pool query latency | < 200ms p95 | Benchmark |
| Discovery query to delegation result | < 5 seconds (excluding task execution) | Integration test |
| Shared lesson retrieval usefulness | > 60% "helpful" (implicit signal) | Usage analytics |
| Opt-in rate among active tenants | > 20% within 3 months of launch | Product analytics |
| Capability registry coverage | > 50 registered capability types within 3 months | Registry stats |
| Test coverage | > 90% for redaction pipeline, > 85% overall | CI |

---

## 9. Technical Notes

- Memory sharing builds on existing `reflect` and embeddings infrastructure (lessons + vector search)
- Discovery builds on existing health score and MCP tool infrastructure
- Shared pool for MVP: centralized SQLite/PostgreSQL with vector extension (pgvector) — federate later
- Redaction pipeline should be pluggable (users can add custom redaction layers)
- Delegation protocol should be idempotent and timeout-safe
- All new MCP tools follow existing patterns: `agentlens_community`, `agentlens_discover`, `agentlens_delegate`
- Dashboard pages follow existing React + Tailwind patterns
- Both features must work in fully self-hosted mode (no external service dependency for core functionality)
- Shared pool can be self-hosted (org-internal) or community-hosted (public) — same protocol, different endpoint

---

## 10. Open Questions

1. **Shared pool hosting:** Who hosts the community shared pool? AgentLens project? Community-run? Multiple pools?
2. **Lesson quality bootstrap:** How do we seed the pool with enough value before network effects kick in?
3. **Cross-language delegation:** Should v0.9.0 support TypeScript agents delegating to Python agents (or vice versa)?
4. **Monetization signal:** Should discovery/delegation usage be tracked for future premium features?
5. **AgentGate integration:** Should guardrails auto-block delegation to agents below a trust threshold?

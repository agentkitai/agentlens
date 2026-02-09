# AgentLens Cloud — Product Brief

## Phase 6: Hosted Multi-Tenant SaaS Platform

**Date:** 2026-02-09
**Author:** BMAD Product Strategy (Paige)
**Status:** Draft

---

## 1. Executive Summary

AgentLens is a mature open-source observability platform for AI agents — with auto-instrumentation for 9 LLM providers, session replay, health scores, cost optimization, benchmarking, guardrails, and agent memory. It's powerful, but self-hosted only. Every user must deploy and maintain their own AgentLens server, database, and infrastructure.

**AgentLens Cloud** eliminates that burden. Teams sign up, get an API key, change one URL in their SDK config, and they're live. Zero infrastructure, zero maintenance, same full feature set.

The SDK already sends events to a configurable server URL. Switching from self-hosted to cloud is a one-line config change — the protocol is identical. This architectural advantage means Cloud is not a rewrite; it's a deployment and multi-tenancy layer on top of the existing platform.

**Why now:**
- Real demand: Amit's own team runs Python + Anthropic on AWS App Runner and doesn't want to deploy a separate AgentLens server
- Self-hosted is a barrier to adoption — most teams evaluating observability tools want a hosted option
- Competitors (LangSmith, Helicone, Arize) are all cloud-first — AgentLens's open-source-only positioning leaves value on the table
- The SDK/server protocol is already clean enough to support multi-tenancy with minimal changes

**Business model:** Usage-based pricing with a generous free tier. Open source remains fully functional and free forever — Cloud is a convenience layer, not a feature gate.

---

## 2. Problem Statement

### 2.1 The Self-Hosting Tax

**The problem:** To use AgentLens today, you must:
1. Provision a server (VM, container, or serverless)
2. Run `npx @agentlensai/server` and keep it running
3. Manage the SQLite database (backups, disk space, migrations)
4. Handle networking (expose the server to your agents, secure it)
5. Monitor the monitoring tool (ironic but real)

For teams already managing production AI workloads, adding another service to deploy and maintain is friction. Many teams evaluate AgentLens, love the features, and then don't adopt because they can't justify the ops overhead.

**The impact:**
- Lost adoption: teams that would use AgentLens choose a hosted competitor instead
- No recurring revenue: open source generates community but not sustainability
- No network effects: every installation is an island (relevant for Phase 4's memory sharing and discovery features)
- Amit's own team can't use AgentLens without deploying infrastructure they'd rather not manage

### 2.2 What Success Looks Like

- A developer installs `pip install agentlensai`, sets `AGENTLENS_URL=https://api.agentlens.ai` and `AGENTLENS_API_KEY=al_...`, calls `agentlensai.init()`, and sees events flowing in the dashboard within 60 seconds
- Teams manage members, API keys, and billing through a web dashboard
- Data is isolated per organization — no cross-tenant leakage, ever
- Self-hosted remains a first-class option; Cloud is additive, not a replacement
- Migration between self-hosted and Cloud is straightforward (export/import)

---

## 3. Target Users

| Persona | Pain Point | Cloud Value |
|---------|-----------|-------------|
| **Startup AI teams (2-10 engineers)** | No DevOps capacity to run observability infra | Zero-setup, pay-as-you-go |
| **Enterprise platform teams** | Need SOC 2, SSO, audit trails without building them | Managed compliance + RBAC |
| **Solo AI developers** | Just want to see what their agent is doing | Free tier, instant onboarding |
| **Existing self-hosted users** | Tired of maintaining the server | Migration path to Cloud |
| **Amit's team (dogfood)** | Python + Anthropic on App Runner, no server budget | First customer |

---

## 4. Scope

### 4.1 MVP — In Scope

#### Ingestion Layer
- **Cloud endpoint:** `https://api.agentlens.ai/v1/events` (same protocol as self-hosted)
- **API key authentication:** Every SDK request includes `Authorization: Bearer al_...`
- **Tenant routing:** API key maps to org → all events scoped to that org
- **High-throughput intake:** Buffered async ingestion — accept events fast, process later
- **Rate limiting:** Per-key and per-org limits (generous defaults, configurable per tier)
- **Event validation:** Schema validation at the edge, reject malformed events early

#### Multi-Tenancy
- **Org-based isolation:** Every org gets logically isolated data (see §6 for architecture)
- **Org management:** Create org, invite members, manage roles
- **API key management:** Create/revoke keys, key-per-environment (dev/staging/prod), scoped permissions
- **Data isolation guarantee:** No query can ever return another org's data — enforced at the data layer, not just application logic

#### Dashboard & Auth
- **OAuth login:** Google and GitHub OAuth for dashboard access
- **Email/password:** As fallback auth method
- **Team management:** Invite by email, roles (Owner, Admin, Member, Viewer)
- **RBAC:** Role-based access to settings, billing, API keys, data
- **Org switcher:** Users can belong to multiple orgs
- **Same dashboard features as self-hosted:** Session timeline, LLM analytics, health scores, cost tracking, replay, benchmarking, guardrails, memory — all scoped to the org

#### Billing & Pricing
- **Free tier:** 10,000 events/month, 7-day retention, 1 org, 3 members
- **Pro tier ($29/mo base):** 500,000 events/month, 30-day retention, unlimited members, priority support
- **Team tier ($99/mo base):** 5,000,000 events/month, 90-day retention, SSO, RBAC, dedicated support
- **Enterprise:** Custom pricing, custom retention, data residency, SLA, on-prem hybrid option
- **Overage:** Per-event pricing beyond tier limits (not hard-cutoff — warn and bill, don't drop data)
- **Billing integration:** Stripe for payment processing, usage metering, invoicing

#### Data Layer
- **PostgreSQL** with row-level security (RLS) for tenant isolation
- **pgvector** for embedding storage (memory/search features)
- **Event partitioning** by org and time for query performance
- **Automated retention:** Purge events beyond retention window per tier
- **Backups:** Automated daily backups with point-in-time recovery

#### SDK Changes (Minimal)
- **API key support:** SDK sends API key in auth header (already partially supported via headers config)
- **Cloud URL default:** Optional convenience — `agentlensai.init(cloud=True, api_key="al_...")` as sugar for setting the URL
- **Graceful degradation:** If Cloud is unreachable, buffer events locally and retry (already exists for self-hosted)
- **No feature differences:** Cloud SDK and self-hosted SDK are the same package

### 4.2 Post-MVP — Planned
- SSO/SAML for Enterprise tier
- Data residency options (US, EU, APAC regions)
- Webhook integrations (Slack, PagerDuty, OpsGenie alerts)
- Usage analytics dashboard (track your own AgentLens usage)
- Export/import for self-hosted ↔ Cloud migration
- Custom domains for dashboard (`agentlens.yourcompany.com`)
- SOC 2 Type II certification

### 4.3 Out of Scope
- Feature-gating between self-hosted and Cloud (all features available in both)
- Custom/private cloud deployments (Enterprise can discuss, but not MVP)
- Mobile dashboard app
- Multi-region active-active (single region for MVP)

---

## 5. Competitive Positioning

| Capability | AgentLens Cloud | LangSmith | Helicone | Arize Phoenix |
|------------|----------------|-----------|----------|---------------|
| Open-source core | ✅ Full MIT | ❌ Proprietary | Partial | ✅ |
| Self-hosted option | ✅ Always available | ❌ | ❌ | ✅ |
| Auto-instrumentation (Python) | ✅ 9 providers, 1 line | Partial (LangChain focus) | Proxy-based | Manual |
| MCP-native | ✅ | ❌ | ❌ | ❌ |
| Free tier | ✅ 10K events/mo | ✅ 5K traces/mo | ✅ 10K req/mo | ✅ |
| Health scores | ✅ 5-dimension | ❌ | ❌ | Partial |
| A/B benchmarking | ✅ Statistical | ✅ | ❌ | ❌ |
| Agent memory | ✅ Semantic recall | ❌ | ❌ | ❌ |
| Guardrails | ✅ Automated actions | ❌ | ❌ | ❌ |
| Self-hosted → Cloud migration | ✅ Same protocol | N/A | N/A | N/A |

**Unique advantage:** AgentLens Cloud is the only platform where you can start self-hosted, validate the tool with zero vendor lock-in, and upgrade to managed hosting by changing one URL. The open-source core is a trust signal that no proprietary competitor can match.

---

## 6. Architecture

### 6.1 High-Level Overview

```
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│   Python SDK    │────▶│              AgentLens Cloud                  │
│ agentlensai     │     │                                              │
│ (same package)  │     │  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│                 │     │  │  Edge /  │  │  Event   │  │ PostgreSQL │  │
│ AGENTLENS_URL=  │────▶│  │  API GW  │─▶│  Queue   │─▶│  (per-org  │  │
│ api.agentlens.ai│     │  │  (auth)  │  │ (Redis/  │  │   RLS)     │  │
│                 │     │  │         │  │  SQS)    │  │            │  │
└─────────────────┘     │  └─────────┘  └──────────┘  └────────────┘  │
                        │       │                           │          │
                        │       ▼                           ▼          │
                        │  ┌─────────┐              ┌────────────┐    │
                        │  │Dashboard│              │  pgvector   │    │
                        │  │ (React) │              │ (embeddings)│    │
                        │  └─────────┘              └────────────┘    │
                        └──────────────────────────────────────────────┘
```

### 6.2 Multi-Tenancy Strategy

**Approach: Shared database with Row-Level Security (RLS)**

- Single PostgreSQL cluster, all orgs in the same tables
- Every table has an `org_id` column; RLS policies enforce isolation at the database level
- Application layer sets `SET app.current_org = 'org_xxx'` on every connection — RLS does the rest
- This is battle-tested (Supabase, Neon, PostHog all use this pattern)
- Advantages: simpler ops, easier migrations, cost-efficient
- If an Enterprise customer requires physical isolation: provision a dedicated schema or database (post-MVP)

**Why not database-per-tenant:**
- Operational complexity scales linearly with tenants (migrations, backups, connection pools)
- Not needed for MVP scale; RLS provides equivalent isolation guarantees
- Can always migrate high-value tenants to dedicated DBs later

### 6.3 Ingestion Pipeline

```
SDK → HTTPS POST → API Gateway (auth + rate limit) → Event Queue → Workers → PostgreSQL
```

1. **API Gateway:** Validates API key, extracts org_id, enforces rate limits, returns 202 Accepted immediately
2. **Event Queue:** Redis Streams or AWS SQS — buffers events for async processing
3. **Workers:** Consume from queue, validate schema, enrich (cost calculation, hash chain), write to Postgres
4. **Backpressure:** If queue depth exceeds threshold, return 429 to SDK (SDK already handles retry with backoff)

**Why async:** LLM observability is write-heavy (10-100x more writes than reads). Accepting events synchronously and writing them to the DB would bottleneck at scale. The queue decouples intake from processing.

### 6.4 API Key Design

- Format: `al_live_<random32>` (live) and `al_test_<random32>` (test/dev)
- Stored as bcrypt hash in DB (never stored in plaintext after creation)
- Key metadata: org_id, created_by, created_at, last_used_at, scopes, rate_limit_override
- Keys are displayed once at creation, then only the prefix is shown
- Revocation is instant (key lookup is cached with short TTL; revocation invalidates cache)

### 6.5 Database Schema Changes (from self-hosted)

The self-hosted SQLite schema maps cleanly to Postgres with these additions:

| New Table | Purpose |
|-----------|---------|
| `orgs` | Organization metadata, plan, settings |
| `org_members` | User ↔ org membership with role |
| `users` | User accounts (OAuth + email) |
| `api_keys` | API key hashes, scopes, metadata |
| `usage_records` | Hourly event counts per org for billing |
| `invoices` | Billing records linked to Stripe |

Existing tables (`sessions`, `events`, `llm_calls`, `health_scores`, etc.) gain an `org_id` column with RLS policy.

### 6.6 Infrastructure (MVP)

- **Cloud provider:** AWS (App Runner or ECS Fargate for API + workers)
- **Database:** AWS RDS PostgreSQL with pgvector extension
- **Queue:** Redis (ElastiCache) or SQS
- **CDN/Edge:** CloudFront for dashboard static assets
- **Auth:** NextAuth.js or Auth.js (already React-based dashboard)
- **Monitoring:** AgentLens monitoring itself (dogfooding) + CloudWatch for infra
- **Domain:** `agentlens.ai` — dashboard at `app.agentlens.ai`, API at `api.agentlens.ai`

---

## 7. Privacy & Compliance

### 7.1 Data Handling

- **Encryption at rest:** AES-256 (RDS default encryption)
- **Encryption in transit:** TLS 1.3 for all connections
- **Data residency (MVP):** US-East-1 only; EU region post-MVP
- **Data retention:** Automatic purge per tier (7/30/90 days); Enterprise custom
- **Data deletion:** Org deletion purges all data within 24 hours (hard delete, not soft)
- **No data sharing between tenants:** RLS + application-level enforcement + integration tests that verify isolation

### 7.2 Sensitive Data in Events

LLM observability inherently captures prompts and completions, which may contain sensitive data. AgentLens Cloud handles this through:

1. **SDK-side redaction:** Existing `privacy` config in the SDK allows users to redact fields before they leave the client
2. **Server-side redaction rules:** Per-org configurable patterns (regex/keyword) applied at ingestion
3. **Prompt masking toggle:** Per-org setting to hash or omit prompt/completion content entirely (keep only metadata: model, tokens, cost, latency)
4. **No training on customer data:** AgentLens Cloud never uses customer event data for any purpose other than serving it back to the customer

### 7.3 Compliance Roadmap

| Milestone | Timeline |
|-----------|----------|
| Privacy policy + ToS | Launch |
| GDPR data processing agreement | Launch |
| SOC 2 Type I | 6 months post-launch |
| SOC 2 Type II | 12 months post-launch |
| HIPAA BAA (Enterprise) | On demand |
| Data residency (EU) | 3 months post-launch |

---

## 8. Migration: Self-Hosted → Cloud

The migration path must be frictionless — users shouldn't feel locked into either option.

### 8.1 Self-Hosted to Cloud
1. Sign up at `app.agentlens.ai`, create org, get API key
2. Change SDK config: `AGENTLENS_URL=https://api.agentlens.ai` + `AGENTLENS_API_KEY=al_...`
3. New events flow to Cloud immediately
4. **(Optional)** Export historical data from self-hosted SQLite → import to Cloud via CLI tool: `npx @agentlensai/server export --format jsonl | curl -X POST https://api.agentlens.ai/v1/import -H "Authorization: Bearer al_..." --data-binary @-`

### 8.2 Cloud to Self-Hosted
1. Export from Cloud dashboard or API: `GET /v1/export?format=jsonl`
2. Import to local instance: `npx @agentlensai/server import --file export.jsonl`
3. Change SDK config back to local URL
4. No lock-in, no data hostage

---

## 9. Pricing Details

### 9.1 Tier Comparison

| | Free | Pro ($29/mo) | Team ($99/mo) | Enterprise |
|---|---|---|---|---|
| Events/month | 10,000 | 500,000 | 5,000,000 | Custom |
| Retention | 7 days | 30 days | 90 days | Custom |
| Team members | 3 | 10 | Unlimited | Unlimited |
| Orgs | 1 | 3 | 10 | Unlimited |
| API keys | 2 | 10 | 50 | Unlimited |
| SSO/SAML | ❌ | ❌ | ✅ | ✅ |
| Dedicated support | ❌ | Email | Slack | Dedicated CSM |
| SLA | Best effort | 99.5% | 99.9% | Custom |
| Data residency | US | US | US/EU | Custom |
| Overage rate | Hard cutoff | $0.10/1K events | $0.08/1K events | Custom |

### 9.2 Pricing Philosophy

- **Free tier is generous enough to be useful** — not a teaser that forces upgrade after day one
- **No feature gating** — every feature available at every tier; tiers differ only in volume, retention, and support
- **Self-hosted is always free** — Cloud pricing is for the managed service, not the software
- **Predictable billing** — overage charges are transparent and capped (no surprise $10K bills)
- **Annual discount:** 20% off for annual commitment on Pro and Team

---

## 10. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Multi-tenant data leak** | Critical | RLS at DB level + application enforcement + automated isolation tests on every deploy + penetration testing |
| **Ingestion pipeline bottleneck at scale** | High | Queue-based async processing, horizontal worker scaling, load testing before launch |
| **SQLite → Postgres migration breaks features** | High | Comprehensive integration test suite run against both backends; feature parity CI |
| **Free tier abuse (crypto miners, spam)** | Medium | Rate limiting, abuse detection, require email verification, IP reputation |
| **Low conversion from free to paid** | Medium | Usage-based nudges, clear value at paid tiers, dogfood to validate paid value |
| **Self-hosted community feels abandoned** | Medium | Open-source-first messaging, Cloud is additive, same codebase, same release cadence |
| **Compliance demands slow down shipping** | Medium | Start with reasonable defaults (encryption, ToS, DPA), pursue certifications post-launch |
| **Operational burden of running a SaaS** | Medium | Use managed AWS services (RDS, ElastiCache, App Runner), minimize custom infra |

---

## 11. Success Metrics

| Metric | Target | Timeframe |
|--------|--------|-----------|
| Time to first event (new signup) | < 5 minutes | Launch |
| Ingestion latency (API → stored) | < 2 seconds p95 | Launch |
| Dashboard query latency | < 500ms p95 | Launch |
| Monthly signups | 100+ | Month 1 |
| Free → Paid conversion | > 5% | Month 3 |
| Monthly recurring revenue | $5K | Month 6 |
| Uptime | 99.9% | Ongoing |
| Data isolation test pass rate | 100% | Every deploy |
| Customer churn (paid) | < 5% monthly | Month 6+ |
| Self-hosted → Cloud migrations | 20+ | Month 3 |

---

## 12. Implementation Phasing

### Phase 6a: Foundation (4 weeks)
- PostgreSQL schema with RLS (migrate from SQLite)
- API key auth middleware
- Org/user/member management (API + basic dashboard)
- OAuth login (Google + GitHub)
- Deploy to AWS (App Runner + RDS)

### Phase 6b: Ingestion Pipeline (3 weeks)
- Event queue (Redis Streams)
- Async workers for event processing
- Rate limiting middleware
- SDK changes (API key header, cloud convenience init)
- End-to-end: SDK → Cloud → Dashboard working

### Phase 6c: Dashboard & Billing (3 weeks)
- Team management UI (invite, roles, org switcher)
- API key management UI
- Stripe integration (subscriptions, usage metering, invoicing)
- Usage dashboard (events consumed, remaining quota)
- Tier enforcement (limits, overage handling)

### Phase 6d: Hardening & Launch (2 weeks)
- Penetration testing (focus on tenant isolation)
- Load testing (target: 10K events/sec sustained)
- Data export/import CLI tools
- Documentation (Cloud quickstart, migration guide, pricing page)
- Landing page at agentlens.ai
- Launch: Product Hunt, Hacker News, Twitter, r/MachineLearning

**Total estimated timeline: 12 weeks**

---

## 13. Open Questions

1. **Single codebase or fork?** Should the server package support both SQLite (self-hosted) and Postgres (cloud) via a storage adapter, or should Cloud be a separate deployment artifact?
   - *Recommendation:* Storage adapter pattern. Same codebase, different backend. Keeps feature parity guaranteed.

2. **Managed Postgres or serverless?** RDS vs. Neon/Supabase for the database layer?
   - *Recommendation:* Start with RDS for control and predictability. Evaluate Neon for cost optimization later.

3. **Queue technology?** Redis Streams vs. SQS vs. Kafka?
   - *Recommendation:* Redis Streams for MVP (simple, fast, already familiar). Move to SQS/Kafka only if scale demands it.

4. **Free tier limits?** 10K events/month — is this too generous or too stingy?
   - *Recommendation:* Start generous, tighten later if needed. Better to have engaged free users than no users.

5. **Phase 4 features (memory sharing, discovery) in Cloud:** Should these be Cloud-exclusive or available in self-hosted too?
   - *Recommendation:* The shared pool/discovery mesh is inherently a hosted service. Self-hosted can participate as clients, but the hub is Cloud. This is a natural Cloud value-add without feature-gating the core.

6. **Domain:** `agentlens.ai` available? Fallback options?
   - *Needs resolution before launch.*

7. **Legal entity:** Who operates AgentLens Cloud? Personal project vs. company?
   - *Needs resolution for Stripe, ToS, DPA.*

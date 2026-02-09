# AgentLens Cloud v0.11.0 — Product Requirements Document

## Phase 6: Hosted Multi-Tenant SaaS Platform

**Date:** 2026-02-09
**Author:** John (Product Manager, BMAD Pipeline)
**Source:** Phase 6 Product Brief (Paige, 2026-02-09)
**Status:** Draft
**Version:** 0.1

---

## Table of Contents

1. [Overview](#1-overview)
2. [Personas](#2-personas)
3. [User Stories](#3-user-stories)
4. [Functional Requirements — Account & Org Management](#4-functional-requirements--account--org-management)
5. [Functional Requirements — API Key Management](#5-functional-requirements--api-key-management)
6. [Functional Requirements — Ingestion Pipeline](#6-functional-requirements--ingestion-pipeline)
7. [Functional Requirements — Multi-Tenant Data Isolation](#7-functional-requirements--multi-tenant-data-isolation)
8. [Functional Requirements — Dashboard Auth & RBAC](#8-functional-requirements--dashboard-auth--rbac)
9. [Functional Requirements — Usage Tracking & Billing](#9-functional-requirements--usage-tracking--billing)
10. [Functional Requirements — Data Retention & Lifecycle](#10-functional-requirements--data-retention--lifecycle)
11. [Functional Requirements — Migration Tooling](#11-functional-requirements--migration-tooling)
12. [Functional Requirements — Existing Features (Multi-Tenant Adaptation)](#12-functional-requirements--existing-features-multi-tenant-adaptation)
13. [Functional Requirements — SDK Changes](#13-functional-requirements--sdk-changes)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [Privacy & Compliance](#15-privacy--compliance)
16. [Pricing Model](#16-pricing-model)
17. [Acceptance Criteria](#17-acceptance-criteria)
18. [Success Metrics & KPIs](#18-success-metrics--kpis)
19. [Risks & Mitigations](#19-risks--mitigations)
20. [Out of Scope for v0.11.0](#20-out-of-scope-for-v0110)
21. [Dependencies](#21-dependencies)
22. [Open Questions](#22-open-questions)

---

## 1. Overview

AgentLens Cloud (v0.11.0) is a hosted multi-tenant SaaS deployment of the AgentLens observability platform. It provides the same full feature set as the open-source self-hosted version — auto-instrumentation for 9 LLM providers, session replay, health scores, cost optimization, benchmarking, guardrails, and agent memory — but eliminates all infrastructure burden.

**Core value proposition:** Teams sign up, get an API key, change one URL in their SDK config, and they're live. Zero infrastructure, zero maintenance.

**Key architectural advantage:** The SDK already sends events to a configurable server URL. Switching from self-hosted to Cloud is a one-line config change — the protocol is identical. Cloud is not a rewrite; it's a multi-tenancy and deployment layer on top of the existing platform.

**Business model:** Usage-based pricing with a generous free tier. Open source remains fully functional and free forever — Cloud is a convenience layer, not a feature gate.

**Target release:** v0.11.0
**Estimated timeline:** 12 weeks (4 sub-phases)

---

## 2. Personas

### P1: Startup AI Team Lead (Priya)
- Leads a 2–10 person engineering team building AI-powered products
- No dedicated DevOps capacity; every minute on infra is a minute not on product
- Needs observability today, not after a weekend of server provisioning
- Values pay-as-you-go pricing with no upfront commitment

### P2: Enterprise Platform Engineer (Marcus)
- Manages AI infrastructure for a large organization with multiple teams
- Requires SOC 2 compliance signals, SSO, RBAC, and audit trails
- Needs multi-org support for separate business units
- Will evaluate AgentLens Cloud against LangSmith, Helicone, and Arize

### P3: Solo AI Developer (Sam)
- Runs 1–3 personal or side-project agents
- Wants to see what agents are doing without deploying anything
- Free tier must be genuinely useful, not a 2-day trial
- Values instant onboarding — signup to first event in < 5 minutes

### P4: Existing Self-Hosted User (Dana)
- Currently runs AgentLens self-hosted and is tired of maintaining the server
- Wants to migrate to Cloud without losing historical data
- Needs confidence that the migration path is smooth and reversible
- Feature parity is non-negotiable — no regressions

### P5: Amit's Team (Dogfood)
- Python + Anthropic on AWS App Runner; no server budget for observability infra
- First customer — validates the end-to-end experience before public launch
- Will stress-test ingestion throughput and dashboard performance at real scale

---

## 3. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|-------------|------------|
| US-01 | Startup Lead | sign up with Google OAuth and get an API key in < 2 minutes | I can start sending events immediately |
| US-02 | Solo Developer | use the free tier with 10K events/month | I can monitor my agents without paying anything |
| US-03 | Enterprise Engineer | create multiple orgs for different business units | teams have isolated data and independent settings |
| US-04 | Enterprise Engineer | assign roles (Owner, Admin, Member, Viewer) to team members | access is scoped appropriately per responsibility |
| US-05 | Startup Lead | create separate API keys for dev/staging/prod | environments are isolated and keys can be revoked independently |
| US-06 | Self-Hosted User | export my SQLite data and import it to Cloud | I don't lose historical observability data when migrating |
| US-07 | Self-Hosted User | switch back to self-hosted by exporting from Cloud | I'm never locked in to the hosted service |
| US-08 | Enterprise Engineer | see a usage dashboard showing events consumed vs. quota | I can plan upgrades before hitting limits |
| US-09 | Solo Developer | change only `AGENTLENS_URL` and add `AGENTLENS_API_KEY` in my SDK config | migration requires minimal code changes |
| US-10 | Enterprise Engineer | view audit logs of who accessed what and when | I can satisfy compliance requirements |
| US-11 | Startup Lead | receive warnings before hitting my event quota | I'm not surprised by overages or data drops |
| US-12 | Enterprise Engineer | configure data retention per org settings | older data is automatically purged per our policy |
| US-13 | Any User | see all existing AgentLens features (replay, health scores, benchmarking, guardrails, memory) on Cloud | the hosted version is feature-complete |

---

## 4. Functional Requirements — Account & Org Management

| ID | Requirement |
|----|------------|
| FR-01 | The system SHALL support user registration via Google OAuth, GitHub OAuth, and email/password. |
| FR-02 | Email/password registration SHALL require email verification before account activation. |
| FR-03 | The system SHALL support creating organizations. Each user is assigned the Owner role for orgs they create. |
| FR-04 | The system SHALL enforce org limits per pricing tier: Free=1, Pro=3, Team=10, Enterprise=unlimited. |
| FR-05 | Org owners SHALL be able to invite members by email. Invitations expire after 7 days. |
| FR-06 | The system SHALL support four roles per org: Owner, Admin, Member, Viewer (see §8 for permissions). |
| FR-07 | Users SHALL be able to belong to multiple organizations and switch between them via an org switcher in the dashboard. |
| FR-08 | Org owners SHALL be able to transfer ownership to another Admin. |
| FR-09 | Org owners SHALL be able to delete the organization. Deletion purges all associated data (see §10). |
| FR-10 | The system SHALL enforce member limits per tier: Free=3, Pro=10, Team=unlimited, Enterprise=unlimited. |
| FR-11 | The system SHALL store the following org metadata: name, slug, plan, created_at, settings (retention, redaction rules). |
| FR-12 | Users SHALL be able to update their profile (display name, avatar) and delete their account. Account deletion removes the user from all orgs and purges their data. |

---

## 5. Functional Requirements — API Key Management

| ID | Requirement |
|----|------------|
| FR-13 | The system SHALL support creating API keys scoped to a specific organization. |
| FR-14 | API keys SHALL follow the format `al_live_<random32>` for production and `al_test_<random32>` for test/development environments. |
| FR-15 | API keys SHALL be displayed in full exactly once at creation. After creation, only the key prefix (first 8 characters) SHALL be visible. |
| FR-16 | API keys SHALL be stored as bcrypt hashes in the database — never in plaintext after creation. |
| FR-17 | The system SHALL support per-key metadata: name, environment label, created_by, created_at, last_used_at, scoped permissions. |
| FR-18 | The system SHALL support API key revocation. Revocation is instant — revoked keys are rejected within 5 seconds (cached lookups invalidated). |
| FR-19 | The system SHALL enforce API key limits per tier: Free=2, Pro=10, Team=50, Enterprise=unlimited. |
| FR-20 | Only Owner and Admin roles SHALL be permitted to create, view, or revoke API keys. |
| FR-21 | The system SHALL track `last_used_at` for each API key, updated on every authenticated request (batched, not blocking). |
| FR-22 | The system SHALL support optional rate limit overrides per API key (within the org's tier limits). |

---

## 6. Functional Requirements — Ingestion Pipeline

| ID | Requirement |
|----|------------|
| FR-23 | The system SHALL expose a Cloud ingestion endpoint at `https://api.agentlens.ai/v1/events` using the same event protocol as self-hosted. |
| FR-24 | Every SDK request SHALL include an `Authorization: Bearer al_...` header. Requests without a valid API key SHALL receive a `401 Unauthorized` response. |
| FR-25 | The API gateway SHALL validate the API key, extract the associated `org_id`, and attach it to the event payload before queuing. |
| FR-26 | The API gateway SHALL return `202 Accepted` immediately upon successful authentication and basic validation — events are processed asynchronously. |
| FR-27 | The system SHALL validate event payloads against the AgentLens event schema at the edge. Malformed events SHALL receive a `400 Bad Request` response with a descriptive error. |
| FR-28 | The system SHALL implement an event queue (Redis Streams or SQS) to decouple event intake from processing. |
| FR-29 | Queue workers SHALL consume events, perform enrichment (cost calculation, hash chain verification), and write to PostgreSQL with the correct `org_id`. |
| FR-30 | The system SHALL implement per-key rate limiting. Default limits: Free=100 events/min, Pro=5,000 events/min, Team=50,000 events/min. |
| FR-31 | The system SHALL implement per-org rate limiting as an aggregate cap across all keys for the org. |
| FR-32 | When rate limits are exceeded, the system SHALL return `429 Too Many Requests` with a `Retry-After` header. The SDK already handles retry with exponential backoff. |
| FR-33 | The system SHALL implement backpressure: if queue depth exceeds a configurable threshold, return `503 Service Unavailable` to new requests. |
| FR-34 | The system SHALL track event counts per org per hour in a `usage_records` table for billing and quota enforcement. |
| FR-35 | The system SHALL support batch event submission (`POST /v1/events/batch`) accepting up to 100 events per request. |

---

## 7. Functional Requirements — Multi-Tenant Data Isolation

| ID | Requirement |
|----|------------|
| FR-36 | The system SHALL use a shared PostgreSQL database with Row-Level Security (RLS) policies for tenant isolation. |
| FR-37 | Every data table containing tenant-scoped data SHALL include an `org_id` column with a NOT NULL constraint. |
| FR-38 | RLS policies SHALL be defined on every tenant-scoped table such that queries can only return rows matching the current session's `org_id`. |
| FR-39 | The application layer SHALL set `SET app.current_org = 'org_xxx'` on every database connection before executing queries. |
| FR-40 | The system SHALL include automated tenant isolation integration tests that verify: (a) Org A cannot read Org B's data, (b) Org A cannot write to Org B's data, (c) queries without `org_id` set return zero rows. |
| FR-41 | Tenant isolation tests (FR-40) SHALL run on every deployment. A failure SHALL block the deployment. |
| FR-42 | The system SHALL use parameterized queries exclusively — no string interpolation of `org_id` or any user-supplied values. |
| FR-43 | Database connection pooling SHALL assign `org_id` per-connection from the pool, not per-session, to prevent connection reuse leaks. |
| FR-44 | The system SHALL support the pgvector extension for embedding storage (memory/search features), with RLS applied to vector tables. |

---

## 8. Functional Requirements — Dashboard Auth & RBAC

| ID | Requirement |
|----|------------|
| FR-45 | The dashboard SHALL require authentication for all pages. Unauthenticated users are redirected to the login page. |
| FR-46 | The dashboard SHALL support OAuth login (Google, GitHub) and email/password login. |
| FR-47 | The system SHALL implement session management with secure HTTP-only cookies. Sessions expire after 7 days of inactivity. |
| FR-48 | The system SHALL enforce role-based access control with the following permission matrix: |

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| View dashboard data | ✅ | ✅ | ✅ | ✅ |
| Create/configure sessions, benchmarks | ✅ | ✅ | ✅ | ❌ |
| Manage API keys | ✅ | ✅ | ❌ | ❌ |
| Manage team members | ✅ | ✅ | ❌ | ❌ |
| Manage billing | ✅ | ❌ | ❌ | ❌ |
| Manage org settings | ✅ | ✅ | ❌ | ❌ |
| Delete org | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

| ID | Requirement (continued) |
|----|------------|
| FR-49 | The dashboard SHALL display only data belonging to the currently selected organization. |
| FR-50 | The org switcher SHALL be accessible from every page in the dashboard. Switching orgs reloads all data for the new org context. |
| FR-51 | The system SHALL log all authentication events (login, logout, failed attempt) and permission-denied events to the audit log. |
| FR-52 | The system SHALL support password reset via email with time-limited tokens (valid for 1 hour). |
| FR-53 | The system SHALL enforce password complexity requirements: minimum 8 characters, at least one uppercase, one lowercase, and one digit. |

---

## 9. Functional Requirements — Usage Tracking & Billing

| ID | Requirement |
|----|------------|
| FR-54 | The system SHALL track event ingestion counts per org per hour and store them in `usage_records`. |
| FR-55 | The system SHALL integrate with Stripe for payment processing, subscription management, and usage-based billing. |
| FR-56 | The system SHALL support four subscription tiers: Free, Pro ($29/mo), Team ($99/mo), Enterprise (custom). |
| FR-57 | The system SHALL enforce monthly event quotas per tier: Free=10,000, Pro=500,000, Team=5,000,000. |
| FR-58 | When an org reaches 80% of their monthly event quota, the system SHALL send a warning notification (email + dashboard banner). |
| FR-59 | When an org reaches 100% of their monthly event quota, behavior SHALL vary by tier: Free=hard cutoff (events rejected with `402`), Pro/Team=overage billing continues accepting events. |
| FR-60 | Overage rates SHALL be: Pro=$0.10 per 1,000 events, Team=$0.08 per 1,000 events. |
| FR-61 | The system SHALL provide an overage spending cap (configurable by Owner). When the cap is reached, events are rejected. Default cap: 2x the base tier event quota. |
| FR-62 | The system SHALL display a usage dashboard showing: events consumed (current period), quota remaining, usage over time graph, projected usage at current rate, cost breakdown. |
| FR-63 | The system SHALL generate monthly invoices via Stripe with itemized usage (base subscription + overage). |
| FR-64 | The system SHALL support annual billing with a 20% discount for Pro and Team tiers. |
| FR-65 | Tier upgrades SHALL take effect immediately. Tier downgrades SHALL take effect at the end of the current billing period. |
| FR-66 | The system SHALL support a 14-day free trial of Pro tier features for new signups (no credit card required). |

---

## 10. Functional Requirements — Data Retention & Lifecycle

| ID | Requirement |
|----|------------|
| FR-67 | The system SHALL enforce data retention limits per tier: Free=7 days, Pro=30 days, Team=90 days, Enterprise=custom. |
| FR-68 | A background job SHALL run daily to purge events older than the org's retention window. |
| FR-69 | Purged data SHALL be hard-deleted (not soft-deleted) — removed from all tables, indexes, and backups within 30 days. |
| FR-70 | The system SHALL perform automated daily database backups with point-in-time recovery capability (up to 7 days). |
| FR-71 | Org deletion (FR-09) SHALL trigger a complete data purge: all events, sessions, API keys, members, settings, and billing records associated with the org are deleted within 24 hours. |
| FR-72 | User account deletion (FR-12) SHALL remove the user from all orgs, anonymize their audit log entries, and delete their authentication credentials within 24 hours. |
| FR-73 | The system SHALL partition event data by org_id and time (monthly partitions) for efficient retention purging and query performance. |

---

## 11. Functional Requirements — Migration Tooling

| ID | Requirement |
|----|------------|
| FR-74 | The system SHALL provide a CLI export tool for self-hosted instances: `npx @agentlensai/server export --format jsonl` that outputs all events, sessions, and metadata as newline-delimited JSON. |
| FR-75 | The system SHALL provide a Cloud import endpoint: `POST /v1/import` accepting JSONL payloads with `Authorization: Bearer al_...` authentication. |
| FR-76 | The import endpoint SHALL validate each record, assign the authenticated org's `org_id`, and insert into the database. Invalid records SHALL be skipped with errors reported in the response. |
| FR-77 | The system SHALL provide a Cloud export endpoint: `GET /v1/export?format=jsonl` to download all org data as JSONL. |
| FR-78 | The self-hosted server SHALL provide an import command: `npx @agentlensai/server import --file export.jsonl` to ingest exported Cloud data. |
| FR-79 | Import/export operations SHALL preserve event IDs, timestamps, session associations, and all metadata — no data loss during round-trip migration. |
| FR-80 | The import endpoint SHALL support streaming uploads for large datasets (> 100MB). |
| FR-81 | The system SHALL rate-limit import operations to prevent abuse: maximum 10,000 records per minute per org. |

---

## 12. Functional Requirements — Existing Features (Multi-Tenant Adaptation)

All existing AgentLens features must work in the Cloud multi-tenant environment with org-scoped data isolation.

| ID | Requirement |
|----|------------|
| FR-82 | **Session timeline:** All session data SHALL be scoped to the authenticated org. Sessions from other orgs SHALL never be visible or queryable. |
| FR-83 | **LLM analytics:** Cost tracking, token usage, and model performance dashboards SHALL aggregate data only from the authenticated org. |
| FR-84 | **Health scores:** The 5-dimension health scoring system SHALL operate independently per org. Cross-org comparisons are not exposed. |
| FR-85 | **Session replay:** Event replay SHALL load only events belonging to the authenticated org's sessions. |
| FR-86 | **A/B benchmarking:** Benchmark experiments SHALL be scoped to the org. Experiment configurations and results are org-private. |
| FR-87 | **Guardrails:** Guardrail rules and triggers SHALL be configured and enforced per org. One org's guardrails SHALL NOT affect another org. |
| FR-88 | **Agent memory:** Memory entries, embeddings, and semantic search SHALL be scoped to the authenticated org. |
| FR-89 | **MCP server:** The MCP server in Cloud mode SHALL require API key authentication and scope all tool operations to the associated org. |
| FR-90 | **Cost optimization:** Cost alerts and budgets SHALL be configured independently per org. |
| FR-91 | The system SHALL maintain feature parity between self-hosted and Cloud. No feature SHALL be exclusive to either deployment mode. |
| FR-92 | The server codebase SHALL use a storage adapter pattern supporting both SQLite (self-hosted) and PostgreSQL (Cloud) backends. Feature parity SHALL be verified by running the same integration test suite against both backends in CI. |

---

## 13. Functional Requirements — SDK Changes

| ID | Requirement |
|----|------------|
| FR-93 | The Python SDK SHALL support sending an API key via the `Authorization: Bearer` header when `AGENTLENS_API_KEY` environment variable or `api_key` parameter is set. |
| FR-94 | The SDK SHALL support a convenience initializer: `agentlensai.init(cloud=True, api_key="al_...")` which sets the URL to `https://api.agentlens.ai` automatically. |
| FR-95 | The SDK SHALL gracefully degrade when Cloud is unreachable: buffer events locally and retry with exponential backoff (existing behavior for self-hosted). |
| FR-96 | The SDK SHALL remain a single package — no separate "cloud SDK." Cloud and self-hosted use the same `agentlensai` package. |
| FR-97 | The SDK SHALL include the API key prefix in error messages (for debugging) but never log the full key. |

---

## 14. Non-Functional Requirements

### 14.1 Performance

| ID | Requirement |
|----|------------|
| NFR-01 | Ingestion latency (API gateway receive → event stored in PostgreSQL) SHALL be < 2 seconds at p95 under normal load. |
| NFR-02 | API gateway response time (to return `202 Accepted`) SHALL be < 100ms at p95. |
| NFR-03 | Dashboard query latency SHALL be < 500ms at p95 for standard views (session list, analytics, health scores). |
| NFR-04 | Dashboard page load time (initial) SHALL be < 3 seconds at p95. |
| NFR-05 | API key validation (lookup + auth) SHALL be < 10ms at p95 using a short-TTL cache. |

### 14.2 Scalability

| ID | Requirement |
|----|------------|
| NFR-06 | The ingestion pipeline SHALL sustain 10,000 events per second in aggregate across all tenants. |
| NFR-07 | The system SHALL support horizontal scaling of API gateway and queue worker instances. |
| NFR-08 | The database SHALL support up to 10,000 organizations without architectural changes. |
| NFR-09 | Event partitioning by org_id and time SHALL ensure query performance does not degrade as total data volume grows. |

### 14.3 Availability & Reliability

| ID | Requirement |
|----|------------|
| NFR-10 | The system SHALL target 99.9% uptime for the ingestion endpoint (measured monthly). |
| NFR-11 | The system SHALL target 99.5% uptime for the dashboard. |
| NFR-12 | Database backups SHALL be automated daily with point-in-time recovery up to 7 days. |
| NFR-13 | The system SHALL deploy to a single AWS region (us-east-1) for MVP with read replicas for the dashboard. |
| NFR-14 | Queue workers SHALL be fault-tolerant: failed event processing retries up to 3 times with exponential backoff before moving to a dead-letter queue. |

### 14.4 Security

| ID | Requirement |
|----|------------|
| NFR-15 | All external communication SHALL use TLS 1.2+ (TLS 1.3 preferred). |
| NFR-16 | All data at rest SHALL be encrypted using AES-256 (RDS default encryption). |
| NFR-17 | API keys SHALL be stored as bcrypt hashes; never in plaintext. |
| NFR-18 | Session tokens SHALL be cryptographically random, stored in secure HTTP-only cookies with SameSite=Strict. |
| NFR-19 | The system SHALL implement CSRF protection on all state-changing dashboard endpoints. |
| NFR-20 | The system SHALL implement Content Security Policy (CSP) headers on the dashboard. |
| NFR-21 | The system SHALL undergo penetration testing before public launch, with focus on tenant isolation bypass. |
| NFR-22 | The system SHALL implement IP-based brute-force protection: lock account after 10 failed login attempts within 15 minutes. |

### 14.5 Testing

| ID | Requirement |
|----|------------|
| NFR-23 | Overall test coverage SHALL be ≥ 85% (line coverage). |
| NFR-24 | Tenant isolation tests SHALL be ≥ 100% pass rate on every deployment (FR-40, FR-41). |
| NFR-25 | Integration tests SHALL cover: signup → create org → create API key → send event → view in dashboard (end-to-end). |
| NFR-26 | Load tests SHALL verify NFR-06 (10K events/sec) before launch. |
| NFR-27 | The same integration test suite SHALL run against both SQLite (self-hosted) and PostgreSQL (Cloud) backends in CI (FR-92). |

### 14.6 Compatibility

| ID | Requirement |
|----|------------|
| NFR-28 | All new REST endpoints SHALL follow existing API conventions (JSON request/response, standard error format, OpenAPI spec). |
| NFR-29 | Dashboard pages SHALL follow existing React + Tailwind patterns and be accessible (WCAG 2.1 AA). |
| NFR-30 | The Cloud ingestion endpoint SHALL accept the exact same event schema as self-hosted — no Cloud-specific fields required. |

---

## 15. Privacy & Compliance

### 15.1 Data Protection

| ID | Requirement |
|----|------------|
| PC-01 | All data at rest SHALL be encrypted using AES-256. |
| PC-02 | All data in transit SHALL be encrypted using TLS 1.3. |
| PC-03 | Data residency for MVP SHALL be US-East-1. EU region SHALL be available post-MVP (see §20). |
| PC-04 | Customer event data SHALL never be used for any purpose other than serving it back to the customer. AgentLens Cloud SHALL NOT train models on, analyze, share, or sell customer data. |
| PC-05 | The system SHALL support SDK-side redaction (existing `privacy` config) allowing users to redact fields before they leave the client. |
| PC-06 | The system SHALL support per-org server-side redaction rules: configurable regex/keyword patterns applied at ingestion to strip sensitive content from events. |
| PC-07 | The system SHALL support a per-org prompt masking toggle: when enabled, prompt and completion content is hashed or omitted at ingestion, retaining only metadata (model, tokens, cost, latency). |

### 15.2 GDPR Compliance

| ID | Requirement |
|----|------------|
| PC-08 | The system SHALL publish a GDPR-compliant Privacy Policy and Terms of Service at launch. |
| PC-09 | The system SHALL provide a Data Processing Agreement (DPA) available for all customers. |
| PC-10 | The system SHALL support right-to-access: users can request a full export of their personal data via the dashboard or API. |
| PC-11 | The system SHALL support right-to-deletion: user account deletion (FR-12) and org deletion (FR-09) constitute complete data erasure within 24 hours. |
| PC-12 | The system SHALL support right-to-portability: data export in machine-readable JSONL format (FR-77). |
| PC-13 | The system SHALL maintain a processing activities register documenting what data is collected, why, and how it's processed. |

### 15.3 Audit Logging

| ID | Requirement |
|----|------------|
| PC-14 | The system SHALL maintain an immutable audit log per org recording: authentication events (login, logout, failed attempts), API key operations (create, revoke), member management (invite, role change, remove), settings changes, data exports, and billing events. |
| PC-15 | Audit log entries SHALL include: timestamp, actor (user ID or API key prefix), action, target resource, IP address, and result (success/failure). |
| PC-16 | Audit logs SHALL be retained for a minimum of 90 days (configurable per tier, up to 1 year for Enterprise). |
| PC-17 | Audit logs SHALL be viewable by Owner and Admin roles in the dashboard and exportable as JSON via `GET /v1/audit/export?from=DATE&to=DATE`. |
| PC-18 | Audit log entries SHALL be append-only — no user or admin can modify or delete audit log entries. |

### 15.4 Compliance Roadmap

| Milestone | Timeline |
|-----------|----------|
| Privacy Policy + ToS + DPA | Launch |
| SOC 2 Type I | 6 months post-launch |
| SOC 2 Type II | 12 months post-launch |
| EU data residency | 3 months post-launch |
| HIPAA BAA (Enterprise) | On demand |

---

## 16. Pricing Model

### 16.1 Tier Comparison

| | Free | Pro ($29/mo) | Team ($99/mo) | Enterprise |
|---|---|---|---|---|
| Events/month | 10,000 | 500,000 | 5,000,000 | Custom |
| Retention | 7 days | 30 days | 90 days | Custom |
| Team members | 3 | 10 | Unlimited | Unlimited |
| Organizations | 1 | 3 | 10 | Unlimited |
| API keys | 2 | 10 | 50 | Unlimited |
| SSO/SAML | ❌ | ❌ | ✅ (post-MVP) | ✅ |
| Support | Community | Email | Slack | Dedicated CSM |
| SLA | Best effort | 99.5% | 99.9% | Custom |
| Data residency | US | US | US/EU (post-MVP) | Custom |
| Overage | Hard cutoff | $0.10/1K events | $0.08/1K events | Custom |
| Annual discount | — | 20% ($278/yr) | 20% ($950/yr) | Custom |

### 16.2 Pricing Philosophy

- **No feature gating:** Every AgentLens feature is available at every tier. Tiers differ only in volume, retention, members, and support.
- **Free tier is genuinely useful:** 10K events/month with 7-day retention supports real development workflows — not a teaser.
- **Self-hosted is always free:** Cloud pricing is for the managed service, not the software.
- **Predictable billing:** Configurable overage caps prevent surprise bills. Default cap = 2x tier quota.
- **Transparent metering:** Usage dashboard shows real-time consumption and projected costs.

---

## 17. Acceptance Criteria

### 17.1 Onboarding & Account Management

| AC | Criterion |
|----|-----------|
| AC-01 | A new user can sign up with Google OAuth, create an org, and obtain an API key within 2 minutes. |
| AC-02 | A user can sign up with email/password, verify their email, and create an org. |
| AC-03 | An org Owner can invite a member by email; the invitee receives an email and can join the org. |
| AC-04 | An org Owner can assign and change member roles (Admin, Member, Viewer). |
| AC-05 | A user can belong to 2+ orgs and switch between them; each org shows only its own data. |

### 17.2 Ingestion & Data Isolation

| AC | Criterion |
|----|-----------|
| AC-06 | An SDK configured with `AGENTLENS_URL=https://api.agentlens.ai` and a valid API key sends events and receives `202 Accepted`. |
| AC-07 | Events sent with Org A's API key are visible in Org A's dashboard and NOT visible in Org B's dashboard (verified by automated test). |
| AC-08 | Events sent without an API key or with an invalid key receive `401 Unauthorized`. |
| AC-09 | Events exceeding the org's rate limit receive `429 Too Many Requests` with a `Retry-After` header. |
| AC-10 | Events appear in the dashboard within 5 seconds of ingestion under normal load. |

### 17.3 Billing & Usage

| AC | Criterion |
|----|-----------|
| AC-11 | A Free tier org is blocked from ingesting events after exceeding 10,000 events in a billing period. |
| AC-12 | A Pro tier org continues ingesting beyond 500,000 events and the overage appears on their Stripe invoice. |
| AC-13 | An org at 80% quota sees a warning banner in the dashboard. |
| AC-14 | An org Owner can upgrade from Free to Pro via the dashboard and the change takes effect immediately. |
| AC-15 | Usage dashboard shows accurate event counts matching actual ingestion volume (within 1% margin). |

### 17.4 Migration

| AC | Criterion |
|----|-----------|
| AC-16 | A self-hosted instance can export data via CLI and import to Cloud; imported data is visible in the dashboard. |
| AC-17 | A Cloud org can export data and import to a self-hosted instance with no data loss. |
| AC-18 | Round-trip migration (self-hosted → Cloud → self-hosted) preserves all event IDs, timestamps, and metadata. |

### 17.5 Existing Features

| AC | Criterion |
|----|-----------|
| AC-19 | Session timeline, LLM analytics, health scores, replay, benchmarking, guardrails, and memory all function correctly in Cloud with org-scoped data. |
| AC-20 | The same integration test suite passes against both SQLite and PostgreSQL backends. |

---

## 18. Success Metrics & KPIs

| Metric | Target | Timeframe | Measurement |
|--------|--------|-----------|-------------|
| Time to first event (new signup) | < 5 minutes | Launch | Product analytics |
| Ingestion latency (API → stored) | < 2 seconds p95 | Launch | Infrastructure monitoring |
| Dashboard query latency | < 500ms p95 | Launch | Infrastructure monitoring |
| Monthly signups | 100+ | Month 1 | Stripe + auth analytics |
| Free → Paid conversion rate | > 5% | Month 3 | Stripe analytics |
| Monthly recurring revenue (MRR) | $5,000 | Month 6 | Stripe |
| Platform uptime (ingestion) | 99.9% | Ongoing | Uptime monitoring |
| Data isolation test pass rate | 100% | Every deploy | CI pipeline |
| Paid customer churn | < 5% monthly | Month 6+ | Stripe analytics |
| Self-hosted → Cloud migrations | 20+ | Month 3 | Import endpoint analytics |
| NPS score (paid users) | > 40 | Month 6 | Survey |
| Support ticket resolution time | < 24 hours (Pro), < 4 hours (Team) | Launch | Support platform |

---

## 19. Risks & Mitigations

| # | Risk | Severity | Probability | Mitigation |
|---|------|----------|-------------|------------|
| R1 | **Multi-tenant data leak** | Critical | Low | RLS at DB level + application-layer enforcement + automated isolation tests on every deploy + penetration testing before launch |
| R2 | **Ingestion pipeline bottleneck** | High | Medium | Queue-based async processing, horizontal worker scaling, load testing (10K events/sec) before launch, backpressure mechanism |
| R3 | **SQLite → PostgreSQL migration breaks features** | High | Medium | Storage adapter pattern, same integration test suite against both backends in CI, feature parity verified continuously |
| R4 | **Free tier abuse** | Medium | High | Rate limiting per key and per org, email verification required, IP reputation, abuse detection heuristics, hard cutoff at quota |
| R5 | **Low free-to-paid conversion** | Medium | Medium | Generous free tier builds trust, usage-based nudges at 80% quota, 14-day Pro trial, dogfood validates paid-tier value |
| R6 | **Self-hosted community feels abandoned** | Medium | Medium | Open-source-first messaging, same codebase, same release cadence, no feature gating, Cloud is additive |
| R7 | **Compliance demands slow shipping** | Medium | Medium | Ship with reasonable defaults (encryption, ToS, DPA), pursue certifications post-launch |
| R8 | **Operational burden of SaaS** | Medium | Medium | Use managed AWS services (RDS, ElastiCache, App Runner/Fargate), minimize custom infrastructure, dogfood AgentLens for its own monitoring |
| R9 | **Stripe integration complexity** | Low | Medium | Use Stripe's well-documented subscription + usage metering APIs, start with simple tier model |
| R10 | **API key compromise** | High | Low | Keys shown once only, bcrypt hashed storage, instant revocation, audit logging of all key usage, encourage key rotation |

---

## 20. Out of Scope for v0.11.0

The following items are explicitly excluded from the v0.11.0 release and deferred to future versions:

| Item | Rationale | Target Phase |
|------|-----------|-------------|
| SSO/SAML authentication | Enterprise feature, not needed for MVP launch | v0.12.0 |
| EU data residency | Requires multi-region infrastructure; start US-only | v0.12.0 |
| Multi-region active-active deployment | Single region sufficient for MVP scale | Future |
| Custom domains (`agentlens.yourcompany.com`) | Nice-to-have, low priority | Future |
| Webhook integrations (Slack, PagerDuty) | Valuable but not launch-blocking | v0.12.0 |
| SOC 2 certification | Process starts post-launch | 6-12 months post-launch |
| Mobile dashboard app | Web dashboard is sufficient | Not planned |
| Private cloud / on-prem hybrid | Enterprise can discuss, not MVP | Future |
| Feature gating between Cloud and self-hosted | Against core philosophy — never |
| Usage analytics dashboard ("meta analytics") | Track your AgentLens usage; lower priority | v0.12.0 |
| HIPAA BAA | On-demand for Enterprise customers | Post-launch |

---

## 21. Dependencies

| Dependency | Type | Status | Notes |
|-----------|------|--------|-------|
| All prior phases (v0.5–v0.10) | Internal | Required | Cloud wraps the existing feature set |
| PostgreSQL + pgvector | External | Available | Cloud database backend |
| Redis (ElastiCache) or SQS | External | Available | Event queue |
| Stripe API | External | Available | Billing and subscriptions |
| Auth.js / NextAuth.js | External | Available | OAuth + session management |
| AWS (App Runner/Fargate, RDS, CloudFront) | External | Available | Cloud infrastructure |
| Domain: `agentlens.ai` | External | **TBD** | Needs acquisition/confirmation |
| Legal entity for Stripe/ToS/DPA | External | **TBD** | Needs resolution before launch |

---

## 22. Open Questions

| # | Question | Impact | Owner |
|---|----------|--------|-------|
| OQ-1 | Single codebase with storage adapter, or separate Cloud deployment artifact? (Brief recommends storage adapter) | Architecture | Architect |
| OQ-2 | RDS PostgreSQL vs. serverless Postgres (Neon/Supabase)? (Brief recommends RDS for control) | Infrastructure, Cost | Architect |
| OQ-3 | Redis Streams vs. SQS for event queue? (Brief recommends Redis for simplicity) | Architecture | Architect |
| OQ-4 | Is `agentlens.ai` domain available? Fallback options? | Branding | Amit |
| OQ-5 | What legal entity operates AgentLens Cloud? (Needed for Stripe, ToS, DPA) | Legal, Business | Amit |
| OQ-6 | Should Phase 4 community features (memory sharing, discovery mesh) be Cloud-exclusive or hybrid? (Brief suggests Cloud as hub, self-hosted as client) | Product strategy | Product |
| OQ-7 | Free tier at 10K events/month — validate with real usage patterns from dogfood | Pricing | Product, Amit |

---

*End of PRD. This document contains 97 functional requirements, 18 privacy/compliance requirements, 30 non-functional requirements, and 20 acceptance criteria.*

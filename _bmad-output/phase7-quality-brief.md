# AgentLens Quality & Hardening — Product Brief

## Phase 7: Security, Performance, Code Quality & Documentation

**Date:** 2026-02-10
**Author:** BMAD Product Strategy (Paige)
**Status:** Draft

---

## 1. Executive Summary

AgentLens has shipped 6 phases of features — from core observability through cloud multi-tenancy. The platform works, the features are rich, but the foundation needs hardening. An automated analysis of 246 files surfaced 20 concrete improvement opportunities across security, performance, code quality, and documentation.

**Phase 7 is not a feature phase. It's a quality phase.** The goal: make AgentLens production-grade, contributor-friendly, and operationally sound before scaling the user base.

**Why now:**
- The pool server has **zero authentication** — a critical vulnerability for a community-facing service
- Default config ships with auth disabled + wildcard CORS — every default deployment is insecure
- Performance N+1 patterns waste 75%+ of guardrail/alert DB queries
- Dashboard has 12% test coverage (vs 82-267% for other packages)
- No CONTRIBUTING.md, no troubleshooting guide — adoption friction for an OSS project
- Phase 6 Cloud launch amplifies all of these: security gaps become public-facing, performance issues affect paying customers, poor docs slow growth

**The work:** 20 ideas grouped into 4 tracks, prioritized from critical security fixes through documentation polish. Most are surgical — targeted file changes, not architectural rewrites. Total estimated effort: 6-8 weeks with parallel execution.

---

## 2. Problem Statement

### 2.1 Security Debt

The pool server is completely unauthenticated — 18 routes including moderation, delegation, and data purging are publicly accessible. Default configuration ships insecure (AUTH_DISABLED=true, CORS='*'). The rate limiter has an unbounded memory DoS vector. Error messages leak internal details. OTLP ingestion bypasses auth entirely.

**Impact:** Any network-accessible attacker can manipulate community data, crash the pool server, or fingerprint the tech stack for targeted attacks.

### 2.2 Performance Waste

Guardrail evaluation runs 4 separate COUNT queries per rule per minute when 1 batched query suffices. The alert engine recomputes identical analytics N times per cycle. The dashboard Overview page fires 10+ API calls and transfers ~5MB for a chart that could use 5KB of pre-bucketed data. The entire dashboard (~350KB recharts) loads upfront regardless of route.

**Impact:** Unnecessary database load, slow dashboard rendering, wasted bandwidth — all scaling linearly with users and rules.

### 2.3 Code Quality Gaps

The API client is a 1,126-line monolith with 62 exports. The SqliteEventStore is a 1,155-line god class with 35 methods across 6 domains. 27+ raw console.log calls with manual bracket prefixes instead of structured logging. 14 catch blocks use `err: any` defeating TypeScript's type system. Dashboard test coverage is 12%.

**Impact:** Contributor friction, merge conflicts, undetected regressions, unpredictable error handling.

### 2.4 Documentation Gaps

No CONTRIBUTING.md for an MIT-licensed OSS project. Newer core types (discovery, community, redaction) lack JSDoc. 97 API endpoints across 30 route files have no per-handler documentation. Critical algorithms (hash chain, guardrail evaluation) lack inline explanation. No troubleshooting guide despite multiple known pain points (.env port mismatch, provider extras, MCP setup).

**Impact:** Contributor drop-off, support burden, audit friction, onboarding failures.

---

## 3. Idea Prioritization & Grouping

### Tier 1: Critical & Urgent (Do First)

| ID | Idea | Why Critical | Effort |
|---|---|---|---|
| sec-001 | Pool server zero authentication | Publicly exploitable, community data at risk | Medium |
| sec-002 | Insecure defaults (auth disabled, CORS *) | Every default deployment is insecure | Small |
| sec-003 | Unbounded rate limiter DoS | Pool server crashable in minutes | Small |

**Group: "Lock the doors"** — These 3 form a single security sprint. sec-002 and sec-003 are quick fixes; sec-001 requires auth middleware design but is the highest-severity item in the entire backlog.

### Tier 2: High-Value Quick Wins (Do Next)

| ID | Idea | Why Now | Effort |
|---|---|---|---|
| perf-001 | Batch guardrail queries (eliminate N+1) | 75% query reduction, surgical change | Small |
| perf-003 | Cache alert engine analytics | 80-95% analytics query reduction | Small |
| cq-002 | Structured logger (replace console.*) | Foundation for all server observability | Small |
| cq-003 | Type-safe error handling utility | 44 duplicate lines, quick mechanical fix | Small |
| doc-001 | CONTRIBUTING.md | Highest-impact missing doc for OSS | Small |

**Group: "Quick wins"** — Each is small effort, high ROI. The perf items reduce DB load immediately. The code quality items establish patterns used by all subsequent work. CONTRIBUTING.md unblocks external contributors.

### Tier 3: Medium-Effort High Impact (Core Sprint)

| ID | Idea | Value | Effort |
|---|---|---|---|
| sec-004 | Error message sanitization | Prevents info disclosure | Small |
| sec-005 | OTLP route authentication | Prevents telemetry injection | Small |
| perf-002 | Pool server secondary indexes + ANN | 10-100x faster search at scale | Medium |
| perf-004 | Dashboard API call consolidation | 70% fewer API calls, faster load | Medium |
| perf-005 | Route-based code splitting (lazy load) | 50-70% smaller initial bundle | Small |
| cq-001 | Split API client into domain modules | Better maintainability, code splitting | Medium |
| doc-002 | JSDoc for core type definitions | Public API contract documentation | Medium |
| doc-005 | Troubleshooting guide | Reduce support burden, improve onboarding | Medium |

**Group: "Harden & optimize"** — The remaining security items, performance improvements that require more design, and documentation that serves external users.

### Tier 4: Deep Work (Final Sprint)

| ID | Idea | Value | Effort |
|---|---|---|---|
| cq-004 | Dashboard test coverage (12% → 50%+) | Regression protection for primary UI | Large |
| cq-005 | Decompose SqliteEventStore god class | Maintainability, testability | Large |
| doc-003 | Per-handler JSDoc for route files | Developer experience for server contributors | Large |
| doc-004 | Algorithm inline comments (hash chain, guardrails) | Audit readiness, contributor understanding | Small |

**Group: "Structural improvements"** — These are the most effort-intensive items. cq-004 and cq-005 are refactoring work best done when the codebase is stable. doc-003 is large but can be incremental (start with 5 most complex route files).

---

## 4. Scope

### 4.1 In Scope

- All 20 ideas from the automated analysis
- Security fixes for pool-server, main server defaults, rate limiter, error handling, OTLP routes
- Performance optimization for guardrails, alerts, dashboard, bundle size, pool server search
- Code quality improvements: API client split, structured logging, error handling, test coverage, god class decomposition
- Documentation: CONTRIBUTING.md, JSDoc, route handler docs, algorithm comments, troubleshooting guide

### 4.2 Out of Scope

- New features or user-facing functionality
- Database schema changes beyond what's needed for these improvements
- Cloud-specific (Phase 6) work — this phase targets the shared codebase
- UI/UX redesign
- Dependency upgrades or framework migrations

---

## 5. Success Metrics

| Metric | Current | Target |
|---|---|---|
| Pool server authenticated endpoints | 0/18 | 18/18 |
| Default config security | Insecure (auth off, CORS *) | Secure by default |
| Guardrail DB queries per evaluation (10 rules) | 40+/minute | ~10/minute |
| Alert analytics queries per cycle (20 rules) | 20 | ≤5 (unique) |
| Dashboard Overview API calls | 10+ | 3 |
| Dashboard initial bundle size | ~1.5MB (estimated) | ~500KB |
| Dashboard test coverage (file ratio) | 12% | ≥50% |
| Server console.log calls | 27+ raw | 0 (all via structured logger) |
| `catch (err: any)` instances | 14 | 0 |
| API client file size | 1,126 lines | <200 lines per module |
| Core type JSDoc coverage | ~4% (newer types) | 100% |
| Route handler JSDoc | 0/97 | 40+/97 (top 5 files) |
| Documented contributor onboarding | None | CONTRIBUTING.md + troubleshooting |

---

## 6. Phasing

### Phase 7a: Security Sprint (1-2 weeks)
- sec-001: Pool server authentication
- sec-002: Secure defaults
- sec-003: Bounded rate limiter
- sec-004: Error message sanitization
- sec-005: OTLP route auth

### Phase 7b: Quick Wins (1-2 weeks)
- perf-001: Batch guardrail queries
- perf-003: Cache alert analytics
- cq-002: Structured logger
- cq-003: Type-safe error handling
- doc-001: CONTRIBUTING.md
- doc-004: Algorithm inline comments

### Phase 7c: Optimization & Docs (2-3 weeks)
- perf-002: Pool server indexes
- perf-004: Dashboard API consolidation
- perf-005: Route-based code splitting
- cq-001: API client decomposition
- doc-002: Core type JSDoc
- doc-005: Troubleshooting guide

### Phase 7d: Structural Improvements (2-3 weeks)
- cq-004: Dashboard test coverage
- cq-005: SqliteEventStore decomposition
- doc-003: Route handler JSDoc

**Total: 6-8 weeks with parallel tracks**

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Pool server auth breaks existing integrations | High | Version the API, provide migration window, document auth setup |
| Secure defaults break local dev workflows | Medium | Clear .env.example comments, startup banner for dev mode |
| God class decomposition introduces regressions | High | Comprehensive tests before refactoring (cq-004 first), facade pattern for backward compat |
| Dashboard code splitting breaks navigation | Low | Suspense boundaries, thorough testing, gradual rollout |
| Large refactoring scope causes paralysis | Medium | Strict batching, each batch independently shippable |

---

## 8. Dependencies

| Dependency | Notes |
|---|---|
| Phase 1-6 codebase stable | No active feature work competing for same files |
| Test infrastructure | vitest + jsdom for dashboard tests |
| @testing-library/react | New dev dependency for dashboard component tests |

---

*End of brief. 20 ideas, 4 tiers, 4 phases, 6-8 weeks estimated.*

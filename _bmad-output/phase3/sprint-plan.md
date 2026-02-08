# AgentLens v0.8.0 — Sprint Plan

## Proactive Guardrails & Framework Plugins

**Date:** 2026-02-08
**Version:** 1.0

---

## Execution Strategy

24 stories organized into **6 batches**. Two tracks run in parallel after Batch 1:

- **Track A (Guardrails):** Review → Types → Dashboard → Docs
- **Track B (Plugins):** Review → Plugins → SDK/CLI → Docs

Batch 0 (Code Review) is a **GATE** — nothing proceeds until existing code is validated.

**Estimated total duration:** 10–12 working days (2–2.5 weeks) with parallel execution.

---

## Batch Overview

| Batch | Theme | Stories | Duration | Notes |
|-------|-------|---------|----------|-------|
| B0 | Code Review Gate | 0.1, 0.2, 6.1 | 1 day | Validate Winston's implementation |
| B1 | Foundation | 1.1, 1.2 | 0.5 day | Types + migration |
| B2 | Plugins + SDK Methods | 3.1, 3.2, 3.3, 3.4, 4.1, 4.4 | 3–4 days | High parallelism |
| B3 | Integration + Dashboard Start | 3.5, 4.2, 4.3, 5.1, 5.4 | 2–3 days | Plugin tests + dashboard scaffold |
| B4 | Dashboard Completion | 5.2, 5.3, 5.5 | 2 days | Dashboard features |
| B5 | Documentation | 6.2, 6.3 | 1–2 days | Guides and references |

---

## Batch 0: Code Review Gate 🚧

**Goal:** Validate all code Winston implemented during the architecture phase. This is a GATE — no subsequent work builds on unreviewed foundations.

**Duration:** 1 day

| Story | Description | Depends On | Review Scope |
|-------|-------------|------------|-------------|
| 0.1 | Review: Types, Schemas, Store, Migration | — | Core types + DB layer |
| 0.2 | Review: Engine, Conditions, Actions, Routes | 0.1 | Runtime + API layer |
| 6.1 | Review: MCP Tool & Transport | 0.2 | MCP integration |

**Parallelism:** 0.1 first (foundation), then 0.2 + 6.1 can start in parallel once 0.1 is clear.

```
Day 1: [== 0.1 ==][=== 0.2 ===]
                   [=== 6.1 ===]
```

**Exit Criteria:**

- [ ] All existing tests pass (guardrail types, store, engine, conditions, actions, routes, MCP)
- [ ] Review findings documented — any blocking issues resolved
- [ ] Code follows project patterns and conventions
- [ ] Tenant isolation verified on all endpoints
- [ ] No security issues identified
- [ ] Architecture §13.2 server startup integration confirmed working

---

## Batch 1: Foundation

**Goal:** Add typed condition/action configs and agent pause/override columns. These are prerequisites for dashboard forms and SDK override.

**Duration:** 0.5 day

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 1.1 | Condition/Action Config Types + Schemas | 6 | B0 (0.1) | Types for dashboard forms |
| 1.2 | Agent pause/override migration | 4 | B0 (0.1) | DB columns + unpause endpoint |

**Parallelism:** Fully parallel — no dependencies between them.

```
Day 1 (half): [== 1.1 ==]
              [== 1.2 ==]
```

**Exit Criteria:**

- [ ] All 8 config interfaces + Zod schemas defined and exported
- [ ] `@agentlensai/core` builds cleanly
- [ ] Agent table has model_override, paused_at, pause_reason columns
- [ ] Unpause endpoint works
- [ ] All 10 new tests pass

---

## Batch 2: Plugins + SDK Methods

**Goal:** Complete all 4 framework plugins and add SDK/CLI guardrail methods. This is the largest batch with maximum parallelism — all 6 stories are independent.

**Duration:** 3–4 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 3.1 | LangChain Plugin Enhanced | 10 | B0 (0.1 — base.py review) | Enhance existing handler |
| 3.2 | CrewAI Plugin: Review & Complete | 10 | B0 (0.1) | Partial code exists |
| 3.3 | AutoGen Plugin: Review & Complete | 8 | B0 (0.1) | Partial code exists |
| 3.4 | Semantic Kernel Plugin | 8 | B0 (0.1) | File exists, needs review + tests |
| 4.1 | Python SDK Guardrail Methods | 8 | B0 (0.2 — routes reviewed) | HTTP methods for guardrails |
| 4.4 | CLI Commands for Guardrails | 8 | B0 (0.2) | Terminal management |

**Parallelism:** All 6 stories are fully independent. Optimal allocation:

- **Stream A (Plugins):** 3.1 → 3.2 → 3.3 → 3.4 (sequential per developer, or parallel if 2+ devs)
- **Stream B (SDK/CLI):** 4.1 ∥ 4.4 (parallel)

```
Day 1-3: Stream A: [=== 3.1 ===][=== 3.2 ===]
                   [=== 3.3 ===][=== 3.4 ===]
         Stream B: [=== 4.1 ===]
                   [=== 4.4 ===]
```

**Exit Criteria:**

- [ ] LangChain handler captures chain/agent/retriever events, backward compatible
- [ ] CrewAI plugin captures crew/agent/task/delegation lifecycle
- [ ] AutoGen plugin captures conversations, messages, tool calls
- [ ] SK plugin captures function invocations, LLM calls via filter interface
- [ ] All 4 plugins are fail-safe (exceptions never propagate)
- [ ] SDK guardrail methods work (list, get, create, update, delete, enable, disable, history, reset)
- [ ] CLI commands work (list, get, create, enable, disable, history, delete)
- [ ] All 52 new tests pass

---

## Batch 3: Integration + Dashboard Start

**Goal:** Plugin integration tests, auto-detection, model override, and start the dashboard (list page + pause badge).

**Duration:** 2–3 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 3.5 | Plugin Integration Tests | 6 | B2 (3.1–3.4) | Tests against real frameworks |
| 4.2 | Auto-Detection in init() | 6 | B2 (3.1–3.4) | _detection.py module |
| 4.3 | Model Override Support | 6 | B1 (1.2) | _override.py module |
| 5.1 | Guardrail List Page | 6 | B1 (1.1), B0 (0.2) | Dashboard scaffold |
| 5.4 | Agent Paused Badge + Unpause | 5 | B1 (1.2), B0 (0.2) | Agent list enhancement |

**Parallelism:** Two independent streams:

- **Stream A (Plugins):** 3.5 → 4.2 (sequential — 4.2 needs plugins to detect)
- **Stream B (Dashboard + Override):** 5.1 ∥ 5.4 ∥ 4.3 (all parallel)

```
Day 1-2: Stream A: [=== 3.5 ===][== 4.2 ==]
         Stream B: [=== 5.1 ===]
                   [=== 5.4 ===]
                   [== 4.3 ==]
```

**Exit Criteria:**

- [ ] Integration tests pass against real pinned framework versions
- [ ] `agentlensai.init()` auto-detects installed frameworks and logs them
- [ ] Model override works end-to-end (guardrail → agent record → SDK substitution)
- [ ] Guardrail list page renders with filters and actions
- [ ] Agent list shows paused badges with unpause button
- [ ] All 29 new tests pass

---

## Batch 4: Dashboard Completion

**Goal:** Complete the guardrail dashboard experience — detail page, create/edit form, activity feed integration.

**Duration:** 2 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 5.2 | Guardrail Detail Page | 6 | B3 (5.1) | Config + state + history |
| 5.3 | Guardrail Create/Edit Form | 8 | B3 (5.1), B1 (1.1) | Dynamic form with validation |
| 5.5 | Activity Feed Events | 5 | 5.2 | Links to detail page |

**Parallelism:** 5.2 and 5.3 are parallel (both depend on 5.1). 5.5 needs 5.2 for linking.

```
Day 1-2: [=== 5.2 ===][= 5.5 =]
         [===== 5.3 =====]
```

**Exit Criteria:**

- [ ] Detail page shows full config, state, and trigger history
- [ ] Create form works with all 4 condition types and all 4 action types
- [ ] Edit form pre-fills existing values
- [ ] Activity feed shows guardrail trigger events with appropriate severity
- [ ] All 19 new tests pass

---

## Batch 5: Documentation

**Goal:** Write comprehensive documentation for guardrails and framework plugins.

**Duration:** 1–2 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 6.2 | Guardrail Documentation | 0 | B4 (all guardrail features) | Concept guide + API reference |
| 6.3 | Plugin Documentation | 0 | B3 (4.2, 4.3) | Per-framework quickstarts |

**Parallelism:** Fully parallel.

```
Day 1: [=== 6.2 ===]
       [=== 6.3 ===]
```

**Exit Criteria:**

- [ ] Guardrail docs cover: concepts, condition/action reference, calibration guide, API reference, CLI reference, MCP guide, troubleshooting
- [ ] Plugin docs cover: architecture overview, per-framework quickstart (4×), auto-detection guide, model override guide, event mapping table, troubleshooting
- [ ] All docs reviewed for accuracy against implemented code

---

## Full Timeline (Gantt-style)

```
Day:    1    2    3    4    5    6    7    8    9    10   11   12
        Mon  Tue  Wed  Thu  Fri  Mon  Tue  Wed  Thu  Fri  Mon  Tue

B0:     [===]
         │
B1:      [=]
         │
B2:      [============]
              │     │
B3:                 [=========]
                    │     │
B4:                       [======]
                               │
B5:                            [====]
                                   │
                                 DONE ✓
```

**Critical path:** B0 → B1 → B3 (5.1) → B4 (5.2) → B4 (5.5) → B5 (6.2) = **10 days**

The plugin stream is slightly faster:
B0 → B2 (3.1-3.4) → B3 (3.5, 4.2) → B5 (6.3) = **8 days**

---

## Tracking Table

| Story | Epic | Batch | Priority | Status | Tests | Notes |
|-------|------|-------|----------|--------|-------|-------|
| 0.1 | E0 | B0 | P0 | 🔲 Todo | — (review) | GATE |
| 0.2 | E0 | B0 | P0 | 🔲 Todo | — (review) | GATE |
| 6.1 | E6 | B0 | P0 | 🔲 Todo | — (review) | MCP review |
| 1.1 | E1 | B1 | P0 | 🔲 Todo | ⬜ 0/6 | Config types |
| 1.2 | E1 | B1 | P0 | 🔲 Todo | ⬜ 0/4 | DB migration |
| 3.1 | E3 | B2 | P0 | 🔲 Todo | ⬜ 0/10 | LangChain enhanced |
| 3.2 | E3 | B2 | P0 | 🔲 Todo | ⬜ 0/10 | CrewAI review + complete |
| 3.3 | E3 | B2 | P0 | 🔲 Todo | ⬜ 0/8 | AutoGen review + complete |
| 3.4 | E3 | B2 | P0 | 🔲 Todo | ⬜ 0/8 | SK implement + test |
| 4.1 | E4 | B2 | P0 | 🔲 Todo | ⬜ 0/8 | SDK guardrail methods |
| 4.4 | E4 | B2 | P1 | 🔲 Todo | ⬜ 0/8 | CLI commands |
| 3.5 | E3 | B3 | P0 | 🔲 Todo | ⬜ 0/6 | Integration tests |
| 4.2 | E4 | B3 | P0 | 🔲 Todo | ⬜ 0/6 | Auto-detection |
| 4.3 | E4 | B3 | P0 | 🔲 Todo | ⬜ 0/6 | Model override |
| 5.1 | E5 | B3 | P0 | 🔲 Todo | ⬜ 0/6 | Dashboard: List page |
| 5.4 | E5 | B3 | P0 | 🔲 Todo | ⬜ 0/5 | Dashboard: Paused badge |
| 5.2 | E5 | B4 | P0 | 🔲 Todo | ⬜ 0/6 | Dashboard: Detail page |
| 5.3 | E5 | B4 | P0 | 🔲 Todo | ⬜ 0/8 | Dashboard: Create/Edit form |
| 5.5 | E5 | B4 | P1 | 🔲 Todo | ⬜ 0/5 | Dashboard: Activity feed |
| 6.2 | E6 | B5 | P1 | 🔲 Todo | — (docs) | Guardrail docs |
| 6.3 | E6 | B5 | P1 | 🔲 Todo | — (docs) | Plugin docs |

### Already Done (Review Only)

| Story | Epic | Status | Existing Tests |
|-------|------|--------|---------------|
| 2.1 | E2 | ✅ DONE | ~15 (engine) |
| 2.2 | E2 | ✅ DONE | ~18 (conditions) |
| 2.3 | E2 | ✅ DONE | ~22 (actions + routes) |

---

## Risk Mitigation Schedule

| Risk | Mitigation | When |
|------|-----------|------|
| Reviewed code has blocking issues | B0 is a GATE with 1 day buffer; issues resolved before B1 | Day 1 |
| Framework API changes break plugins | Pin versions in tests; fail-safe design = silent degradation | Day 3-5 (B2) |
| Dashboard complexity (dynamic forms) | Use existing component patterns; Story 5.3 is the largest dashboard story | Day 7-8 (B4) |
| Model override conflicts with framework LLM selection | Opt-in only (guardrail_enforcement=True); document limitations | Day 6 (B3) |
| Plugin integration tests flaky in CI | Make framework installs optional; skip tests if not available | Day 5-6 (B3) |
| Scope creep | MVP scope frozen at story level; P1 items can be deferred if timeline slips | Ongoing |

---

## Definition of Done (per story)

- [ ] All acceptance criteria met
- [ ] Tests written and passing (count matches estimate)
- [ ] TypeScript/Python compiles/lints without errors
- [ ] Code follows existing patterns
- [ ] Tenant isolation verified (where applicable)
- [ ] Fail-safety verified (plugin stories)
- [ ] No regressions in existing tests

## Definition of Done (v0.8.0 release)

- [ ] All 24 stories complete (including 5 review-only stories)
- [ ] All ~179 new tests passing + ~55 existing tests still passing
- [ ] Guardrails work end-to-end: create rule → event triggers condition → action fires → dashboard shows
- [ ] Framework plugins work end-to-end: init() → framework operation → events in AgentLens
- [ ] MCP tool functional for agent self-monitoring
- [ ] CLI commands functional for developer management
- [ ] Dashboard guardrail pages complete (list, detail, create/edit, paused agents, activity feed)
- [ ] Documentation complete for both guardrails and plugins
- [ ] No performance regressions
- [ ] Migration runs cleanly on existing deployments
- [ ] Backward compatibility: v0.7.0 SDK usage unchanged

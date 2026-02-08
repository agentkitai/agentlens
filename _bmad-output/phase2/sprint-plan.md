# AgentLens v0.7.0 — Sprint Plan

## Session Replay Debugger & Agent Benchmarking / A/B Testing

**Date:** 2026-02-08
**Version:** 1.0

---

## Execution Strategy

The 24 stories are organized into **5 batches** (sprints). The two features — Replay and Benchmarking — have independent dependency chains below the types layer, so they can execute **in parallel** from Batch 2 onward.

Each batch is a logical unit where:
- All stories within a batch can start at the same time (dependencies within-batch are minimal)
- A batch must complete before the next batch's dependent stories can start
- Some cross-feature parallelism is possible

**Estimated total duration:** 10-12 working days (2-2.5 weeks) with parallel execution.

---

## Batch Overview

| Batch | Theme | Stories | Duration | Parallelism |
|-------|-------|---------|----------|-------------|
| B1 | Foundation (Types + Schema) | 1.1, 1.2, 1.3 | 1 day | All 3 parallel |
| B2 | Server Engines | 2.1, 2.4, 3.1, 3.2, 3.3 | 2-3 days | Replay (2.1, 2.4) ∥ Benchmark (3.1, 3.2, 3.3) |
| B3 | APIs + Engine Integration | 2.2, 2.3, 3.4, 3.5 | 2-3 days | Replay (2.2, 2.3) ∥ Benchmark (3.4, 3.5) |
| B4 | MCP Tools + Dashboard Start | 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2 | 3-4 days | High parallelism |
| B5 | Dashboard Completion + Polish | 5.4, 5.5, 6.3, 6.4 | 2 days | All parallel |

---

## Batch 1: Foundation

**Goal:** Establish all shared types and database schema so server work can begin immediately.

**Duration:** 1 day

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 1.1 | Replay Types in Core | 4 | — | Pure types, no logic |
| 1.2 | Benchmark Types in Core | 4 | — | Pure types, no logic |
| 1.3 | DB Schema & Migration | 10 | 1.2 (types for comments) | Drizzle schema + migration file |

**Parallelism:** 1.1 and 1.2 are fully independent. 1.3 can start immediately (only soft dependency on 1.2 for type imports, which can be done after or concurrently).

**Exit criteria:**
- [ ] `@agentlensai/core` builds with all new types exported
- [ ] Migration creates 3 new tables on fresh DB
- [ ] Migration is idempotent on existing DB
- [ ] All 18 tests pass

---

## Batch 2: Server Engines

**Goal:** Build the core computation logic — ReplayBuilder for replay, and MetricAggregator + StatisticalComparator + BenchmarkStore for benchmarking.

**Duration:** 2-3 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 2.1 | ReplayBuilder | 14 | B1 (1.1) | Core replay logic. Heaviest story in this batch. |
| 2.4 | Replay Redaction | 4 | 2.1 | Small extension to ReplayBuilder |
| 3.1 | BenchmarkStore CRUD | 12 | B1 (1.3) | Database operations |
| 3.2 | MetricAggregator | 10 | B1 (1.2), 3.1 | Can start with just types; store used for session queries |
| 3.3 | StatisticalComparator | 10 | B1 (1.2) | Pure math, no DB dependency |

**Parallelism:**
- **Stream A (Replay):** 2.1 → 2.4 (sequential, 2.4 is small)
- **Stream B (Benchmark):** 3.1 + 3.3 parallel → 3.2 (3.2 needs 3.1 for variant definitions)
- Streams A and B are fully independent

```
Day 1-2: Stream A: [====== 2.1 ======][= 2.4 =]
         Stream B: [== 3.1 ==][== 3.3 ==][== 3.2 ==]
```

**Exit criteria:**
- [ ] ReplayBuilder constructs correct ReplayState from test events
- [ ] Redaction strips content while preserving metadata
- [ ] BenchmarkStore CRUD works with tenant isolation
- [ ] MetricAggregator computes correct stats from session data
- [ ] StatisticalComparator produces correct p-values against reference datasets
- [ ] All 50 tests pass

---

## Batch 3: APIs + Engine Integration

**Goal:** Wire server engines to REST endpoints. Build the BenchmarkEngine orchestrator that ties aggregation + statistics together.

**Duration:** 2-3 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 2.2 | Replay REST Endpoint | 8 | B2 (2.1) | Straightforward Hono route |
| 2.3 | Replay Performance/Cache | 6 | 2.2 | LRU cache + pagination tuning |
| 3.4 | BenchmarkEngine | 6 | B2 (3.1, 3.2, 3.3) | Orchestrator: aggregation → comparison → formatting |
| 3.5 | Benchmark REST Endpoints | 14 | 3.4, 3.1 | 6 endpoints, most complex API story |

**Parallelism:**
- **Stream A (Replay):** 2.2 → 2.3 (sequential)
- **Stream B (Benchmark):** 3.4 → 3.5 (sequential)
- Streams A and B are fully independent

```
Day 1-2: Stream A: [=== 2.2 ===][== 2.3 ==]
         Stream B: [== 3.4 ==][===== 3.5 =====]
```

**Exit criteria:**
- [ ] `GET /api/sessions/:id/replay` returns correct data with auth + tenant isolation
- [ ] Replay caching works (cache hit, miss, invalidation)
- [ ] All 6 benchmark endpoints work (create, list, get, status, results, delete)
- [ ] BenchmarkEngine produces correct results end-to-end
- [ ] All 34 tests pass

---

## Batch 4: MCP Tools + Dashboard Start

**Goal:** Register MCP tools. Start both dashboard features (page scaffolding, replay controls, benchmark list/create).

**Duration:** 3-4 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 4.1 | Replay MCP Tool | 6 | B3 (2.2) | Transport + tool registration |
| 4.2 | Benchmark MCP: Create/List | 6 | B3 (3.5) | Transport + tool (partial) |
| 4.3 | Benchmark MCP: Status/Results | 6 | 4.2, B3 (3.5) | Complete tool |
| 5.1 | Replay Page Layout | 5 | B3 (2.2) | Page scaffold + data loading |
| 5.2 | Replay Controls | 6 | 5.1 | Play/pause/step/speed |
| 5.3 | Timeline Scrubber | 4 | 5.1 | Canvas-rendered bar |
| 6.1 | Benchmark List Page | 5 | B3 (3.5) | List + nav item |
| 6.2 | Create Benchmark Page | 5 | 6.1 | Form + validation |

**Parallelism:** This is the most parallelizable batch. 4 independent streams:

- **Stream A (Replay MCP):** 4.1 (standalone after B3)
- **Stream B (Benchmark MCP):** 4.2 → 4.3 (sequential)
- **Stream C (Replay Dashboard):** 5.1 → 5.2 + 5.3 parallel
- **Stream D (Benchmark Dashboard):** 6.1 → 6.2

```
Day 1-3: Stream A: [== 4.1 ==]
         Stream B: [== 4.2 ==][== 4.3 ==]
         Stream C: [== 5.1 ==][= 5.2 =]
                              [= 5.3 =]
         Stream D: [== 6.1 ==][== 6.2 ==]
```

**Exit criteria:**
- [ ] `agentlens_replay` MCP tool works end-to-end (registers, returns formatted replay)
- [ ] `agentlens_benchmark` MCP tool handles all 6 actions
- [ ] Replay page loads, displays header, controls work
- [ ] Timeline scrubber renders and supports click-to-jump
- [ ] Benchmark list page shows benchmarks with filters
- [ ] Create benchmark form validates and submits
- [ ] All 43 tests pass

---

## Batch 5: Dashboard Completion

**Goal:** Complete the dashboard experience — replay timeline + context panel, benchmark results + charts.

**Duration:** 2 days

| Story | Description | Est. Tests | Depends On | Notes |
|-------|-------------|-----------|------------|-------|
| 5.4 | Replay Timeline (event list) | 6 | B4 (5.1, 5.2) | Virtual-scrolled event cards |
| 5.5 | Context Panel | 4 | B4 (5.1), 5.4 | Resizable side panel, 4 tabs |
| 6.3 | Benchmark Detail/Results Page | 6 | B4 (6.1) | Comparison table + summary |
| 6.4 | Distribution Charts | 4 | 6.3 | Box plots, lazy-loaded |

**Parallelism:**
- **Stream A (Replay Dashboard):** 5.4 → 5.5 (5.5 needs 5.4 for integration, but can start in parallel with stubs)
- **Stream B (Benchmark Dashboard):** 6.3 → 6.4 (sequential)
- Streams A and B are fully independent

```
Day 1-2: Stream A: [=== 5.4 ===][== 5.5 ==]
         Stream B: [=== 6.3 ===][= 6.4 =]
```

**Exit criteria:**
- [ ] Replay page fully functional: controls, scrubber, timeline, context panel all working together
- [ ] Virtual scrolling handles 10,000+ events without lag
- [ ] Benchmark detail page shows comparison table with color-coded winners
- [ ] Distribution charts render correctly for all metrics
- [ ] All 20 tests pass

---

## Full Timeline (Gantt-style)

```
Day:    1    2    3    4    5    6    7    8    9    10   11   12
        Mon  Tue  Wed  Thu  Fri  Mon  Tue  Wed  Thu  Fri  Mon  Tue

B1:     [==]
         │
B2:      [=========]
         │     │
B3:            [=========]
               │     │
B4:                  [=============]
                     │         │
B5:                            [======]
                                    │
                                 DONE ✓
```

**Critical path:** B1 → B2 (2.1) → B3 (2.2) → B4 (5.1) → B5 (5.4, 5.5) = **10 days**

The benchmark stream runs in parallel and is slightly shorter:
B1 → B2 (3.1-3.3) → B3 (3.4, 3.5) → B4 (6.1, 6.2) → B5 (6.3, 6.4) = **9 days**

---

## Tracking Table

| Story | Epic | Batch | Priority | Status | Assignee | Tests Pass | Notes |
|-------|------|-------|----------|--------|----------|------------|-------|
| 1.1 | E1 | B1 | P0 | 🔲 Todo | — | ⬜ 0/4 | |
| 1.2 | E1 | B1 | P0 | 🔲 Todo | — | ⬜ 0/4 | |
| 1.3 | E1 | B1 | P0 | 🔲 Todo | — | ⬜ 0/10 | |
| 2.1 | E2 | B2 | P0 | 🔲 Todo | — | ⬜ 0/14 | Critical path |
| 2.4 | E2 | B2 | P1 | 🔲 Todo | — | ⬜ 0/4 | |
| 3.1 | E3 | B2 | P0 | 🔲 Todo | — | ⬜ 0/12 | |
| 3.2 | E3 | B2 | P0 | 🔲 Todo | — | ⬜ 0/10 | |
| 3.3 | E3 | B2 | P0 | 🔲 Todo | — | ⬜ 0/10 | |
| 2.2 | E2 | B3 | P0 | 🔲 Todo | — | ⬜ 0/8 | Critical path |
| 2.3 | E2 | B3 | P1 | 🔲 Todo | — | ⬜ 0/6 | |
| 3.4 | E3 | B3 | P0 | 🔲 Todo | — | ⬜ 0/6 | |
| 3.5 | E3 | B3 | P0 | 🔲 Todo | — | ⬜ 0/14 | Largest API story |
| 4.1 | E4 | B4 | P0 | 🔲 Todo | — | ⬜ 0/6 | |
| 4.2 | E4 | B4 | P0 | 🔲 Todo | — | ⬜ 0/6 | |
| 4.3 | E4 | B4 | P0 | 🔲 Todo | — | ⬜ 0/6 | |
| 5.1 | E5 | B4 | P0 | 🔲 Todo | — | ⬜ 0/5 | Critical path |
| 5.2 | E5 | B4 | P1 | 🔲 Todo | — | ⬜ 0/6 | |
| 5.3 | E5 | B4 | P1 | 🔲 Todo | — | ⬜ 0/4 | |
| 6.1 | E6 | B4 | P0 | 🔲 Todo | — | ⬜ 0/5 | |
| 6.2 | E6 | B4 | P1 | 🔲 Todo | — | ⬜ 0/5 | |
| 5.4 | E5 | B5 | P0 | 🔲 Todo | — | ⬜ 0/6 | Critical path |
| 5.5 | E5 | B5 | P1 | 🔲 Todo | — | ⬜ 0/4 | |
| 6.3 | E6 | B5 | P0 | 🔲 Todo | — | ⬜ 0/6 | |
| 6.4 | E6 | B5 | P2 | 🔲 Todo | — | ⬜ 0/4 | Nice-to-have if time permits |

---

## Risk Mitigation Schedule

| Risk | Mitigation | When |
|------|-----------|------|
| ReplayBuilder performance on large sessions | Story 2.3 (pagination + caching) in B3 | Day 4-5 |
| Statistical correctness | Story 3.3 tests against reference datasets | Day 2-3 |
| Dashboard complexity (2 major new pages) | Reuse existing components; parallel streams | Day 6-10 |
| Scope creep | MVP scope frozen at story level; "not in scope" documented in PRD | Ongoing |
| Integration issues between layers | Each batch validates the layer below via integration tests | End of each batch |

---

## Definition of Done (per story)

- [ ] All acceptance criteria met
- [ ] Tests written and passing (count matches estimate)
- [ ] TypeScript compiles without errors
- [ ] Code follows existing patterns (Hono routes, Drizzle schema, McpServer.tool, useApi hook)
- [ ] Tenant isolation verified (where applicable)
- [ ] No regressions in existing tests

## Definition of Done (v0.7.0 release)

- [ ] All 24 stories complete
- [ ] All ~153 tests passing
- [ ] Replay works end-to-end: dashboard → API → event store
- [ ] Benchmarking works end-to-end: create → tag sessions → view results with statistics
- [ ] MCP tools registered and functional
- [ ] No performance regressions (existing tests still pass within time limits)
- [ ] Migration runs cleanly on existing deployments

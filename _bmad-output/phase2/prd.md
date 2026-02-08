# AgentLens v0.7.0 — Product Requirements Document (PRD)

## Session Replay Debugger & Agent Benchmarking / A/B Testing

**Date:** 2026-02-08
**Version:** 1.0
**Status:** Draft

---

## Table of Contents

1. [User Personas](#1-user-personas)
2. [Feature 1: Session Replay Debugger](#2-feature-1-session-replay-debugger)
3. [Feature 2: Agent Benchmarking / A/B Testing](#3-feature-2-agent-benchmarking--ab-testing)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Dependencies on v0.6.0](#5-dependencies-on-v060)
6. [Risks and Mitigations](#6-risks-and-mitigations)
7. [Open Questions](#7-open-questions)

---

## 1. User Personas

### Persona 1: Maya — Agent Developer

- **Role:** Full-stack developer building AI agents with MCP
- **Experience:** 2 years with LLMs, 6 months with AgentLens
- **Daily workflow:** Writes agent code, deploys, monitors events in the dashboard, iterates on prompts
- **Pain points:**
  - Spends 30+ minutes per debugging session reconstructing agent decision flow from raw events
  - Cannot easily share a "here's what went wrong" artifact with teammates
  - Makes model/prompt changes blind — no way to validate improvements quantitatively
- **Goals:**
  - Debug failed sessions in under 5 minutes
  - Confidently A/B test prompt changes before deploying to production
- **Replay use:** Steps through failed sessions, examines LLM prompts and tool call sequences
- **Benchmarking use:** Compares her GPT-4o prompt against a Claude Sonnet variant

### Persona 2: Raj — Platform Team Lead

- **Role:** Engineering manager overseeing 5 teams, each running 3-4 agents
- **Experience:** 10 years in platform engineering, 1 year with AI agents
- **Daily workflow:** Reviews dashboards, sets quality gates, reviews cost reports
- **Pain points:**
  - No way to enforce "prove your config change is better" before deployment
  - Cost anomalies traced manually through event logs
  - Different teams use different approaches to evaluate agent quality
- **Goals:**
  - Standardize agent evaluation through benchmarking
  - Reduce time to diagnose production incidents
- **Replay use:** Reviews replays of high-cost or error-heavy sessions shared by team leads
- **Benchmarking use:** Reviews benchmark results before approving config changes to production

### Persona 3: Priya — QA Engineer

- **Role:** Quality assurance for agent-powered features
- **Experience:** 5 years in QA, 1 year testing AI systems
- **Daily workflow:** Runs test scenarios, examines agent outputs, files bugs
- **Pain points:**
  - Cannot replay a specific test scenario to see exactly where behavior diverged
  - "It worked on my machine" — no reproducible evidence of agent behavior
  - Regression testing is manual and time-consuming
- **Goals:**
  - Replay any test session to capture exact behavior for bug reports
  - Run benchmarks to catch regressions before release
- **Replay use:** Replays specific test sessions, creates deep links for bug reports
- **Benchmarking use:** Compares release candidate agent config against production baseline

### Persona 4: Agent-X — Self-Monitoring AI Agent

- **Role:** An autonomous AI agent using AgentLens MCP tools
- **Experience:** N/A (software)
- **Workflow:** Executes tasks, monitors own health, learns from mistakes
- **Pain points:**
  - Cannot review own session history in a structured way
  - Cannot self-evaluate whether a config change improved performance
- **Goals:**
  - Use `agentlens_replay` to review what happened in a past session
  - Use `agentlens_benchmark` to compare own performance across configs
- **Replay use:** Calls `agentlens_replay` with a session ID to understand a past failure
- **Benchmarking use:** Creates benchmarks to track improvement over time

---

## 2. Feature 1: Session Replay Debugger

### 2.1 Functional Requirements

#### FR-R1: Replay Data Retrieval

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R1.1 | The system SHALL retrieve all events for a session in chronological order (ascending timestamp) from the existing event store | P0 |
| FR-R1.2 | The system SHALL construct a replay state object containing: ordered events, paired event correlations (tool_call↔tool_response, llm_call↔llm_response, approval_requested↔approval_granted/denied), session metadata, and chain validity | P0 |
| FR-R1.3 | The system SHALL compute cumulative context at each step: accumulated LLM conversation history, tool results available, cost running total, elapsed time | P0 |
| FR-R1.4 | The system SHALL support filtering replay events by type (e.g., show only LLM interactions, only tool calls) | P1 |
| FR-R1.5 | The system SHALL paginate replay data for sessions exceeding 5,000 events | P1 |

#### FR-R2: Replay Controls (Dashboard)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R2.1 | The dashboard SHALL provide play/pause controls that auto-advance through events at configurable speed (1x, 2x, 5x, 10x) | P0 |
| FR-R2.2 | The dashboard SHALL provide step forward / step backward controls to navigate one event at a time | P0 |
| FR-R2.3 | The dashboard SHALL provide a timeline scrubber bar showing all events with type-colored markers, supporting click-to-jump | P0 |
| FR-R2.4 | The dashboard SHALL provide a jump-to-event dropdown/search to navigate directly to a specific event | P1 |
| FR-R2.5 | The dashboard SHALL provide keyboard shortcuts: Space (play/pause), ← (step back), → (step forward), Home (start), End (end) | P1 |

#### FR-R3: Event Visualization

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R3.1 | Each event SHALL be rendered with a type-appropriate visualization: LLM calls show the full prompt/messages and response, tool calls show arguments and results, errors show stack traces | P0 |
| FR-R3.2 | Paired events (call↔response) SHALL be visually linked with duration indicators | P0 |
| FR-R3.3 | The current step's event SHALL be highlighted in the timeline and scrolled into view | P0 |
| FR-R3.4 | Error and critical severity events SHALL be visually distinct (red highlight, alert icon) | P0 |
| FR-R3.5 | Cost events SHALL show cumulative cost at that point in the session | P1 |
| FR-R3.6 | LLM call events SHALL render the messages array with role-based formatting (system=gray, user=blue, assistant=green, tool=purple) | P1 |

#### FR-R4: Decision Context Panel

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R4.1 | At each step, a context panel SHALL display the cumulative state: total events so far, tools called, LLM calls made, cost accrued, errors encountered | P0 |
| FR-R4.2 | The context panel SHALL show the LLM conversation history up to the current step (all messages exchanged) | P0 |
| FR-R4.3 | The context panel SHALL show available tool results that the agent had access to at that point | P1 |
| FR-R4.4 | The context panel SHALL be collapsible/resizable to not obstruct the main timeline view | P1 |

#### FR-R5: Deep Linking & Sharing

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R5.1 | The replay URL SHALL encode the session ID and current step index, allowing direct navigation: `/replay/:sessionId?step=N` | P0 |
| FR-R5.2 | Copying the URL at any step SHALL create a shareable deep link | P1 |

#### FR-R6: Replay REST API

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R6.1 | `GET /api/sessions/:id/replay` SHALL return the full replay state (events with pairings, context per step, session metadata) | P0 |
| FR-R6.2 | The endpoint SHALL accept query params: `eventTypes` (filter), `offset` and `limit` (pagination for large sessions) | P1 |
| FR-R6.3 | The endpoint SHALL require authentication and enforce tenant isolation | P0 |

#### FR-R7: Replay MCP Tool

| ID | Requirement | Priority |
|----|------------|----------|
| FR-R7.1 | `agentlens_replay` MCP tool SHALL accept a session ID and optional step range, returning the replay state as structured text | P0 |
| FR-R7.2 | The tool description SHALL clearly explain when and how to use it | P0 |
| FR-R7.3 | The tool SHALL format output readably: event summaries with timestamps, paired events shown together, errors highlighted | P1 |

### 2.2 User Stories Summary

See `epics-and-stories.md` for full story breakdown with acceptance criteria.

---

## 3. Feature 2: Agent Benchmarking / A/B Testing

### 3.1 Functional Requirements

#### FR-B1: Benchmark Definition

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B1.1 | Users SHALL be able to create a benchmark with: name, description, list of variant definitions, comparison metrics, and minimum sessions per variant | P0 |
| FR-B1.2 | Each variant SHALL have: name, description, and a tag filter expression that identifies its sessions (e.g., `config:variant-a`) | P0 |
| FR-B1.3 | Benchmarks SHALL support 2-10 variants | P0 |
| FR-B1.4 | Available comparison metrics SHALL include: health_score, error_rate, avg_cost, avg_latency, tool_success_rate, completion_rate, avg_tokens, avg_duration | P0 |
| FR-B1.5 | Users SHALL be able to select which metrics to compare (default: all) | P1 |
| FR-B1.6 | Benchmarks SHALL have a configurable minimum sample size per variant (default: 30 sessions) | P0 |

#### FR-B2: Benchmark Lifecycle

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B2.1 | Benchmarks SHALL transition through states: `draft` → `running` → `completed` (or `cancelled`) | P0 |
| FR-B2.2 | Starting a benchmark (draft → running) SHALL validate that at least one session already exists for each variant tag | P1 |
| FR-B2.3 | Completing a benchmark SHALL be manual (user clicks "Complete") or automatic when all variants reach minimum sample size | P0 |
| FR-B2.4 | Users SHALL be able to cancel a running benchmark | P1 |
| FR-B2.5 | Completed benchmarks SHALL be immutable (results frozen at completion time) | P0 |

#### FR-B3: Metric Collection

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B3.1 | The system SHALL aggregate session-level metrics for each variant by querying sessions matching the variant's tag filter | P0 |
| FR-B3.2 | For each variant, the system SHALL compute: mean, median, standard deviation, min, max, count for each selected metric | P0 |
| FR-B3.3 | Metrics SHALL be recomputed on-demand or when results are requested (not cached for running benchmarks) | P0 |
| FR-B3.4 | Session data SHALL be pulled from existing session materialized views and event store (no new data collection) | P0 |

#### FR-B4: Statistical Comparison

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B4.1 | For each pair of variants, the system SHALL compute Welch's t-test for continuous metrics (cost, latency, duration, tokens) | P0 |
| FR-B4.2 | For each pair of variants, the system SHALL compute chi-squared test for proportion metrics (error rate, completion rate, tool success rate) | P0 |
| FR-B4.3 | Results SHALL include: test statistic, p-value, confidence interval (95%), effect size (Cohen's d for continuous, phi for proportions) | P0 |
| FR-B4.4 | The system SHALL declare a winner only when p-value < 0.05 for the primary comparison metric | P0 |
| FR-B4.5 | The system SHALL warn when sample sizes are below 30 ("insufficient data for reliable conclusions") | P0 |
| FR-B4.6 | For benchmarks with >2 variants, results SHALL include pairwise comparisons for all pairs | P1 |

#### FR-B5: Results Dashboard

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B5.1 | The dashboard SHALL display a benchmark list page showing all benchmarks with status, variants, creation date | P0 |
| FR-B5.2 | The benchmark detail page SHALL show a side-by-side comparison table with all metrics for each variant | P0 |
| FR-B5.3 | Metrics SHALL be color-coded: green for the winning variant, red for the losing variant, gray for not significant | P0 |
| FR-B5.4 | Each metric comparison SHALL show the p-value and confidence indicator (★★★ for p<0.01, ★★ for p<0.05, ★ for p<0.1, — for not significant) | P0 |
| FR-B5.5 | The detail page SHALL include distribution charts (box plots or histograms) for key metrics per variant | P1 |
| FR-B5.6 | The results SHALL include a summary card: "Variant B outperforms Variant A on cost (-23%, p=0.003) and latency (-15%, p=0.02). No significant difference on error rate." | P0 |

#### FR-B6: Benchmark REST API

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B6.1 | `POST /api/benchmarks` — Create a new benchmark | P0 |
| FR-B6.2 | `GET /api/benchmarks` — List benchmarks with filters (status, agentId) | P0 |
| FR-B6.3 | `GET /api/benchmarks/:id` — Get benchmark detail including variant definitions | P0 |
| FR-B6.4 | `PUT /api/benchmarks/:id/status` — Update benchmark status (start, complete, cancel) | P0 |
| FR-B6.5 | `GET /api/benchmarks/:id/results` — Get statistical comparison results | P0 |
| FR-B6.6 | `DELETE /api/benchmarks/:id` — Delete a draft benchmark | P1 |

#### FR-B7: Benchmark MCP Tool

| ID | Requirement | Priority |
|----|------------|----------|
| FR-B7.1 | `agentlens_benchmark` MCP tool SHALL support actions: create, status, results, list | P0 |
| FR-B7.2 | Create action SHALL accept: name, variants (with tags), metrics, min_sessions | P0 |
| FR-B7.3 | Results action SHALL return a human-readable summary with statistical conclusions | P0 |
| FR-B7.4 | The tool description SHALL explain the benchmarking workflow: create → tag sessions → check results | P0 |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|------------|
| NFR-1 | Replay data for a 1,000-event session SHALL load in < 2 seconds |
| NFR-2 | Replay data for a 10,000-event session SHALL load in < 10 seconds (with pagination) |
| NFR-3 | Benchmark results computation (per variant pair) SHALL complete in < 5 seconds for 1,000 sessions |
| NFR-4 | Statistical computations SHALL be performed server-side to avoid shipping large datasets to the client |
| NFR-5 | Dashboard replay controls SHALL respond in < 100ms (step forward/backward) |

### 4.2 Scalability

| ID | Requirement |
|----|------------|
| NFR-6 | Replay SHALL handle sessions with up to 50,000 events via pagination (5,000 events per page) |
| NFR-7 | Benchmarks SHALL support comparison across up to 10,000 sessions per variant |
| NFR-8 | The benchmark list page SHALL handle up to 500 benchmarks per tenant without performance degradation |

### 4.3 Security

| ID | Requirement |
|----|------------|
| NFR-9 | All replay and benchmark endpoints SHALL require valid API key authentication |
| NFR-10 | Replay data SHALL only be accessible for sessions belonging to the authenticated tenant |
| NFR-11 | Benchmark data (configs, results) SHALL be tenant-isolated |
| NFR-12 | LLM call/response content in replays SHALL respect the `redacted` flag — show "[REDACTED]" for redacted content |

### 4.4 Testing

| ID | Requirement |
|----|------------|
| NFR-13 | All new server code SHALL have unit test coverage ≥ 80% |
| NFR-14 | All new API endpoints SHALL have integration tests |
| NFR-15 | Statistical comparison engine SHALL have tests verifying correctness against known datasets |
| NFR-16 | Dashboard replay component SHALL have component tests for all control states |

### 4.5 Compatibility

| ID | Requirement |
|----|------------|
| NFR-17 | Both features SHALL work with the existing SQLite storage backend |
| NFR-18 | Both features SHALL be backwards-compatible with v0.6.0 event data (no migration required for events) |
| NFR-19 | New database tables SHALL be created via Drizzle migrations |
| NFR-20 | MCP tools SHALL follow the existing registration pattern (McpServer.tool()) |

---

## 5. Dependencies on v0.6.0

### 5.1 Core Types (`@agentlensai/core`)

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `AgentLensEvent`, `EventType`, `EventPayload` | Replay | Core data model — replay iterates over these |
| `Session`, `SessionStatus` | Both | Session metadata for replay header; session aggregation for benchmarking |
| `HealthScore`, `HealthDimension` | Benchmarking | Health scores are a key benchmark metric |
| `CostRecommendation`, `OptimizationResult` | Benchmarking | Cost data for benchmark comparison |
| `IEventStore` | Both | Data access layer |
| Typed payloads (`LlmCallPayload`, `ToolCallPayload`, etc.) | Replay | Render event details in replay view |

### 5.2 Server Infrastructure

| Dependency | Used By | Notes |
|-----------|---------|-------|
| Hono router + `AuthVariables` middleware | Both | API endpoint registration pattern |
| `getTenantStore()` + `TenantScopedStore` | Both | Tenant isolation helper |
| `HealthComputer` | Benchmarking | Compute health scores per variant |
| SQLite + Drizzle ORM | Both | New tables follow existing schema pattern |
| `eventBus` | Replay (future) | Could be used for live replay in v0.8.0 |

### 5.3 MCP Package

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `AgentLensTransport` | Both | HTTP transport for MCP tools to call server |
| `McpServer.tool()` registration | Both | Tool registration pattern |
| Existing transport methods (`queryEvents`, `querySessions`) | Both | Data retrieval |

### 5.4 Dashboard

| Dependency | Used By | Notes |
|-----------|---------|-------|
| React + Tailwind CSS | Both | UI framework |
| `@tanstack/react-virtual` | Replay | Virtual scrolling for large event lists |
| `useApi` hook | Both | Data fetching pattern |
| `useSSE` hook | Replay (future) | Live updates |
| `Timeline` component | Replay | Extend or build alongside existing timeline |
| `EventDetailPanel` component | Replay | Reuse for event rendering in replay |
| `Layout` component | Both | Page layout wrapper |
| API client (`client.ts`) | Both | Typed API calls |

---

## 6. Risks and Mitigations

### Risk 1: Large Session Replay Performance

**Risk:** Sessions with 10,000+ events may cause slow load times and high memory usage in both server and browser.

**Likelihood:** Medium — power users run long agent sessions.

**Impact:** High — poor performance would negate the debugging value.

**Mitigation:**
- Paginate replay data (5,000 events per page) — server never sends full dataset at once
- Use virtual scrolling in the timeline (already proven with `@tanstack/react-virtual`)
- Compute cumulative context server-side, not client-side
- Lazy-load event payload details (show summary, expand on click)

### Risk 2: Statistical Misinterpretation

**Risk:** Users may misinterpret p-values, declare winners prematurely, or ignore sample size warnings.

**Likelihood:** High — statistical literacy varies.

**Impact:** Medium — wrong configuration decisions.

**Mitigation:**
- Always display confidence indicators alongside metrics (★ system)
- Show explicit warnings for small sample sizes
- Never declare "winner" without p < 0.05
- Summary text uses plain language ("B is cheaper with high confidence" vs "p=0.003")
- Link to documentation explaining the statistical methodology

### Risk 3: Tag-Based Variant Assignment Is Fragile

**Risk:** If users forget to tag sessions or use inconsistent tags, variant data will be incomplete or mixed.

**Likelihood:** Medium — tagging is manual.

**Impact:** Medium — benchmarks with wrong data produce wrong conclusions.

**Mitigation:**
- Validate that at least one session exists per variant before starting a benchmark
- Show real-time session counts per variant on the benchmark detail page
- Document the tagging workflow clearly in MCP tool descriptions
- Provide example tagging code in docs

### Risk 4: Benchmark Metric Computation Cost

**Risk:** Computing metrics across thousands of sessions with full health score recalculation may be slow.

**Likelihood:** Low — health scores are fast to compute.

**Impact:** Medium — slow results page.

**Mitigation:**
- Cache completed benchmark results (immutable after completion)
- For running benchmarks, compute on-demand but cap at 10,000 sessions per variant
- Aggregate at the session level (already materialized), not event level
- Background computation with progress indicator for large benchmarks

### Risk 5: Scope Creep — "Just One More Feature"

**Risk:** Session replay and benchmarking are both feature-rich domains with infinite extensions (live replay, Bayesian testing, visual diffing, etc.).

**Likelihood:** High.

**Impact:** Medium — delayed delivery, bloated scope.

**Mitigation:**
- Strict MVP scope defined in this PRD
- "Not in scope" list explicitly documented
- Each feature request evaluated against v0.7.0 vs v0.8.0 criteria

### Risk 6: Dashboard Complexity Increase

**Risk:** Two major new pages (replay + benchmarking) significantly increase dashboard complexity and maintenance burden.

**Likelihood:** Medium.

**Impact:** Low — manageable with good component architecture.

**Mitigation:**
- Reuse existing components (Timeline, EventDetailPanel, MetricsGrid)
- Follow established patterns (useApi hook, Layout wrapper, Tailwind utility classes)
- New components designed to be self-contained and testable

---

## 7. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Should replay support sessions across multiple agents (multi-agent handoff)? | Product | **Deferred** — single-session only for MVP |
| 2 | Should benchmark results be exportable (CSV, JSON)? | Product | **Yes** — add P2 story for export |
| 3 | Should the replay API support WebSocket streaming for very large sessions? | Architecture | **No** — HTTP pagination sufficient for MVP |
| 4 | Should benchmarks support time-bounded comparison (only sessions in date range)? | Product | **Yes** — add time range filters to benchmark definition |
| 5 | Should MCP `agentlens_benchmark` support updating benchmark definition after creation? | Product | **No** — create new benchmark instead |
| 6 | How should we handle sessions that match multiple variant tags? | Architecture | **Exclude ambiguous sessions** — document requirement for mutually exclusive tags |

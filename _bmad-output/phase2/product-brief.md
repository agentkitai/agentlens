# AgentLens v0.7.0 — Product Brief

## Phase 2 Features: Session Replay Debugger & Agent Benchmarking

**Date:** 2026-02-08
**Author:** BMAD Product Strategy
**Status:** Draft — Pending stakeholder review

---

## 1. Executive Summary

AgentLens v0.6.0 provides comprehensive observability for AI agents: event ingestion, health scoring, cost optimization, pattern analysis, and semantic recall. However, two critical gaps remain in the developer experience:

1. **Debugging is opaque.** When an agent session fails or produces unexpected results, developers must manually sift through raw event logs to reconstruct what happened. There is no visual, step-by-step replay that shows the agent's decision flow, tool calls, LLM reasoning, and branching points in context.

2. **Comparing agent configurations is guesswork.** Teams routinely change prompts, models, temperature settings, and tool configurations — but have no structured way to measure whether those changes actually improve outcomes. A/B testing of agent configs relies on anecdotal observation, not statistical evidence.

v0.7.0 addresses both gaps with two new features: **Session Replay Debugger** and **Agent Benchmarking / A/B Testing**.

---

## 2. Problem Statements

### 2.1 Session Replay Debugger

**The problem:** When an agent session goes wrong — an error, an unexpected tool call chain, excessive cost, or a poor outcome — the developer's only recourse is to query raw events, mentally reconstruct the session flow, and try to understand *why* the agent made each decision. This is slow (minutes to hours per session), error-prone (context is scattered across events), and doesn't scale to teams debugging dozens of sessions daily.

**The impact:**
- Mean time to debug (MTTD) is 15-45 minutes per incident for experienced developers
- Junior developers often cannot debug at all without help
- Root causes of intermittent failures go undetected
- No way to share a "replay link" with teammates for collaborative debugging

**The opportunity:** All the data needed for replay already exists in the event store — `llm_call`, `llm_response`, `tool_call`, `tool_response`, `approval_*`, `form_*`, `session_started`, `session_ended`, and `cost_tracked` events. A visual replay UI that reconstructs the session timeline with full context at each step would reduce MTTD to under 5 minutes.

### 2.2 Agent Benchmarking / A/B Testing

**The problem:** Agent developers iterate on configurations constantly — swapping models (GPT-4o vs Claude Sonnet), adjusting temperature, rewriting system prompts, adding/removing tools. But they have no structured way to compare the before/after. They deploy, watch dashboards for a few days, and make gut-feel judgments. This leads to regressions going unnoticed and improvements being attributed incorrectly.

**The impact:**
- Configuration changes are deployed without controlled comparison
- Teams cannot answer "Is config A better than config B?" with statistical confidence
- Cost-saving model swaps may degrade quality undetected
- No institutional knowledge of what configurations work best for which tasks

**The opportunity:** AgentLens already captures health scores, cost data, error rates, latency, and tool success rates. A benchmarking system that allows users to define configs, collect tagged data, and compare results with statistical rigor would transform agent development from art to engineering.

---

## 3. Target Users

| User | Role | Primary Need |
|------|------|-------------|
| **Agent Developer** | Builds and iterates on AI agents | Debug failed sessions quickly; validate config changes |
| **Platform Team Lead** | Manages agent infrastructure for multiple teams | Compare agent performance across configs; enforce quality gates |
| **QA Engineer** | Tests agent behavior and reliability | Replay specific scenarios; set up benchmark suites |
| **DevOps / SRE** | Monitors agent systems in production | Replay incidents to find root cause; compare prod vs staging |

---

## 4. MVP Scope

### 4.1 Session Replay Debugger — MVP

**Core capability:** Given a completed session, visually step through every event in chronological order, showing the agent's full decision context at each step.

**In scope:**
- **Replay controls:** Play, pause, step forward, step backward, jump to event, speed control (1x, 2x, 5x, 10x)
- **Event visualization:** Each event rendered with type-appropriate display (LLM calls show prompt/response, tool calls show arguments/results, errors highlighted)
- **Decision context panel:** At each step, show what the agent "knew" — accumulated context, previous tool results, LLM conversation history up to that point
- **Timeline scrubber:** Visual timeline bar with markers for key events (errors, tool calls, LLM calls), click to jump
- **Paired event correlation:** Tool call → response, LLM call → response, approval request → decision shown as linked pairs with duration
- **Filtering:** Show/hide event types during replay (focus on LLM only, tools only, etc.)
- **Deep linking:** URL encodes session ID + current step for sharing
- **MCP tool:** `agentlens_replay` — retrieve replay state for a session (for agents debugging themselves)
- **REST API:** Endpoints to fetch replay data for a session

**Out of scope for MVP:**
- Live replay of in-progress sessions (v0.8.0)
- Branching / "what-if" replay with modified inputs
- Video recording / screen capture of replay
- Diffing two replays side-by-side (handled by benchmarking)
- Annotation / commenting on replay steps

### 4.2 Agent Benchmarking / A/B Testing — MVP

**Core capability:** Define benchmark configurations, collect session data tagged to each config variant, and compare results with statistical analysis.

**In scope:**
- **Benchmark definition:** Name, description, list of config variants (A, B, ...), comparison metrics, success criteria
- **Config variants:** Each variant specifies metadata tags that identify sessions belonging to it (e.g., tag `config:v2-gpt4o`)
- **Metric collection:** Automatically aggregate health scores, cost, latency, error rate, tool success rate, completion rate, token usage for each variant's sessions
- **Statistical comparison:** Two-sample comparison with confidence intervals, p-values (using Welch's t-test for continuous metrics, chi-squared for proportions)
- **Results dashboard:** Side-by-side comparison table, metric charts, winner declaration with confidence level
- **Benchmark status:** Draft → Running → Completed, with minimum sample size requirements
- **MCP tool:** `agentlens_benchmark` — create benchmarks, check status, get results (agents self-benchmarking)
- **REST API:** Full CRUD for benchmarks, results retrieval
- **Tenant isolation:** Benchmarks scoped to tenant

**Out of scope for MVP:**
- Automated traffic splitting (users tag sessions themselves)
- Multi-armed bandit / adaptive allocation
- Custom metric plugins
- Benchmark templates / marketplace
- Sequential testing / early stopping
- Bayesian analysis (frequentist only for MVP)

---

## 5. Success Metrics

### 5.1 Session Replay Debugger

| Metric | Target | Measurement |
|--------|--------|-------------|
| MTTD reduction | Debug time < 5 min (from 15-45 min baseline) | User research / surveys post-launch |
| Replay adoption | 60% of sessions with errors are replayed within 7 days of launch | Track replay API calls vs error sessions |
| MCP tool usage | At least 10% of agents use `agentlens_replay` within 30 days | MCP call logs |
| Deep link sharing | 20+ unique shared replay links per week (multi-user deployments) | URL tracking |

### 5.2 Agent Benchmarking / A/B Testing

| Metric | Target | Measurement |
|--------|--------|-------------|
| Benchmark creation | 5+ benchmarks created per tenant per month | DB counts |
| Statistical rigor | 80% of completed benchmarks reach statistical significance | Results analysis |
| Config change confidence | Users report higher confidence in config decisions (NPS improvement) | User surveys |
| MCP self-benchmarking | 15% of benchmarks created via MCP tool | Creation source tracking |

---

## 6. What's NOT in Scope (v0.7.0)

1. **Live session replay** — Replaying active, in-progress sessions requires SSE integration with replay state. Deferred to v0.8.0.
2. **Replay annotations** — Commenting on replay steps, adding notes. Feature request tracked for future.
3. **Automated traffic splitting** — The system doesn't route traffic; users tag sessions with config variant identifiers.
4. **Bayesian statistics** — MVP uses frequentist methods (t-test, chi-squared). Bayesian can be added later.
5. **Multi-armed bandit** — No adaptive allocation; benchmarks run with fixed variants.
6. **Custom metric plugins** — Benchmarks use built-in metrics (health score dimensions + cost + tokens).
7. **Benchmark marketplace** — No sharing of benchmark templates between tenants.
8. **Session diffing** — Side-by-side replay comparison of two sessions is a natural follow-on but not MVP.
9. **Code-level tracing** — Replay shows agent-level events, not internal code execution traces.
10. **New data collection** — Both features work entirely with existing event types and data. No SDK changes needed.

---

## 7. Key Design Principles

1. **Zero new instrumentation:** Both features operate on data already in the event store. No new SDK calls, no new event types, no migration of existing data.
2. **Self-service via MCP:** Agents should be able to replay their own sessions and benchmark their own configs without human intervention.
3. **Statistical honesty:** Benchmarking must surface confidence levels and warn about insufficient sample sizes. No "winner" declared without statistical significance.
4. **Tenant isolation:** All data — replay state, benchmarks, results — scoped to tenant.
5. **Performance-conscious:** Replaying sessions with 10,000+ events and computing statistics over thousands of sessions must remain responsive.

---

## 8. Dependencies

- **AgentLens v0.6.0** — Health scores, cost optimization, event store, sessions, MCP tools, dashboard infrastructure
- **Existing event types** — All 18 event types already defined in `@agentlensai/core`
- **SQLite + Drizzle ORM** — Database layer for new tables
- **Dashboard stack** — React + Tailwind CSS + @tanstack/react-virtual
- **MCP SDK** — `@modelcontextprotocol/sdk` for new tool registration

---

## 9. Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Planning (this document) | 1 day | Product brief, PRD, architecture, stories |
| Sprint 1: Core Replay | 3-4 days | Data models, API, basic replay UI |
| Sprint 2: Core Benchmarking | 3-4 days | Data models, API, comparison engine |
| Sprint 3: Dashboard Polish + MCP | 2-3 days | Full replay UI, benchmark dashboard, MCP tools |
| Sprint 4: Testing + Integration | 2 days | E2E tests, performance validation |
| **Total** | **~12 days** | Parallel execution possible between features |

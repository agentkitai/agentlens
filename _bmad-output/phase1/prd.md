# PRD: AgentLens v0.6.0 — Cost Optimization & Health Scores

**Version:** 1.0
**Date:** 2026-02-08
**Status:** Approved

---

## 1. Overview

AgentLens v0.6.0 adds two tightly coupled capabilities: a **Cost Optimization Engine** that analyzes LLM spending patterns and recommends cheaper model substitutions, and **Health Scores** that distill multiple quality signals into a single trackable metric per agent. Both features leverage the existing event/session/LLM tracking infrastructure from v0.5.0.

## 2. Personas

### P1: Alex — Agent Developer
- **Role:** Full-stack developer running 12 agents on GPT-4o and Claude Opus
- **Pain:** Monthly LLM bill is $3,200 and growing. Suspects many calls don't need expensive models but doesn't know which ones.
- **Goal:** Cut costs 30-40% without breaking agent behavior.
- **Uses:** REST API + Dashboard + CLI

### P2: Sarah — Engineering Manager
- **Role:** Manages a team of 5 developers, 40+ agents in production
- **Pain:** No visibility into which agents are degrading. Finds out about problems from user complaints.
- **Goal:** Glanceable health overview. Get alerted before users notice problems.
- **Uses:** Dashboard + Alerts

### P3: Agent-7 — The Agent
- **Role:** A production coding agent running via MCP
- **Pain:** Uses Opus for everything including simple file reads. Has no way to assess its own quality.
- **Goal:** Self-optimize by picking cheaper models for simple tasks. Check own health before risky operations.
- **Uses:** MCP tools

## 3. Requirements

### 3.1 Cost Optimization Engine

#### 3.1.1 Cost Analysis
- **R1:** Aggregate LLM costs by model, agent, and time period
- **R2:** Classify calls by complexity: simple (< 500 tokens, no tools), moderate (500-2000 tokens or 1-3 tools), complex (> 2000 tokens or 4+ tools or multi-turn)
- **R3:** Calculate per-model success rate (non-error responses) by complexity tier
- **R4:** Track cost per successful call by model and complexity

#### 3.1.2 Recommendations
- **R5:** Generate model substitution recommendations when a cheaper model has ≥95% success rate for a complexity tier where the current model is used
- **R6:** Calculate estimated monthly savings per recommendation based on historical call volume
- **R7:** Rank recommendations by estimated savings (highest first)
- **R8:** Include confidence level (low/medium/high) based on sample size: low (<50 calls), medium (50-200), high (>200)
- **R9:** Recommendations refresh on query (not cached) to reflect latest data

#### 3.1.3 Interfaces
- **R10:** MCP tool `agentlens_optimize` returns top-N recommendations for the calling agent
- **R11:** REST `GET /api/optimize/recommendations?agentId=&period=7d&limit=10`
- **R12:** CLI `agentlens optimize [--agent <id>] [--period <days>] [--format json|table]`
- **R13:** Dashboard page with recommendations table, savings projections, cost trend chart

### 3.2 Health Scores

#### 3.2.1 Score Computation
- **R14:** Composite score 0-100 per agent, computed from weighted dimensions:
  - Error rate (weight: 0.30) — % of sessions with errors
  - Cost efficiency (weight: 0.20) — cost per successful session relative to agent's own historical average
  - Tool success rate (weight: 0.20) — % of tool calls that succeed
  - Latency (weight: 0.15) — average session duration relative to agent's baseline
  - Completion rate (weight: 0.15) — % of sessions that complete without abandonment
- **R15:** Each dimension normalized to 0-100 before weighting
- **R16:** Weights are configurable per tenant via `GET/PUT /api/config/health-weights`
- **R17:** Score computed over a configurable rolling window (default: 7 days)
- **R18:** Trend direction: compare current window vs previous window → improving (>5pt gain), degrading (>5pt loss), stable

#### 3.2.2 Historical Tracking
- **R19:** Store daily health score snapshots per agent
- **R20:** Retain snapshots for 90 days (configurable)
- **R21:** Enable sparkline rendering from historical data (min 7 data points)

#### 3.2.3 Alerts
- **R22:** Alert when health score drops below configurable threshold (default: 60)
- **R23:** Alert when health score degrades >15 points in 24 hours
- **R24:** Integrate with existing alert engine (AlertEngine + alert_rules table)

#### 3.2.4 Interfaces
- **R25:** MCP tool `agentlens_health` returns agent's current score + dimensions + trend
- **R26:** REST `GET /api/agents/:id/health?window=7d`
- **R27:** REST `GET /api/health/overview` — all agents' scores + trends
- **R28:** CLI `agentlens health [--agent <id>] [--window <days>]`
- **R29:** Dashboard: agent health cards with score, trend arrow, sparkline, dimension breakdown

## 4. Data Model Changes

### New Tables
- `health_snapshots` — daily score snapshots per agent per tenant
- `optimization_cache` — optional caching for expensive recommendation queries

### Modified Tables
- None — all source data exists in `events`, `sessions`, `agents`

## 5. Non-Functional Requirements

- **Performance:** Health score computation <200ms for agents with <10K sessions. Optimization recommendations <500ms.
- **Backward Compatibility:** Zero changes to existing API contracts. New endpoints only.
- **Tenant Isolation:** All queries scoped to tenant. No cross-tenant data leakage.
- **Fail-Safe:** Health score computation failures never affect event ingestion or existing functionality.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cost recommendations suggest bad model switches | Medium | High | Confidence levels + minimum sample size (50 calls) |
| Health score doesn't correlate with actual quality | Medium | Medium | Validate against manual review; configurable weights |
| Complexity classification is too coarse | Low | Medium | Start with 3 tiers, refine based on feedback |
| Performance degrades for high-volume tenants | Low | High | Aggregate queries, optional caching, index optimization |

## 7. Open Questions
1. Should health scores be computed on-demand or pre-computed on a schedule? → **Decision: On-demand with optional daily snapshot for history**
2. Should cost optimization consider error content (e.g., "model refused") separately from tool errors? → **Decision: Yes, classify as "model_error" vs "tool_error" vs "timeout"**

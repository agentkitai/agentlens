# Product Brief: AgentLens v0.6.0 — Cost Optimization & Health Scores

**Date:** 2026-02-08
**Author:** Brad (AI) + Amit (Human)
**Status:** Draft

---

## Problem Statement

AI agents are expensive and opaque. Organizations running agents at scale have no structured way to:

1. **Understand cost efficiency** — Which agents waste money using expensive models for simple tasks? Which model substitutions would maintain quality while reducing cost?
2. **Assess agent quality** — Is an agent performing well or degrading? There's no single metric to track agent health over time, compare agents, or trigger alerts when quality drops.

AgentLens v0.5.0 collects the raw data (events, LLM calls, costs, errors, tool usage, performance metrics) but doesn't synthesize it into actionable insights.

## Users

### Primary: Agent Developer
- Runs 5-50 agents in production
- Pays $500-$5000/month in LLM API costs
- Wants to optimize spend without sacrificing quality
- Needs a quick way to assess "is my agent healthy?"

### Secondary: Engineering Manager
- Oversees a team running agents
- Needs high-level health dashboards for status meetings
- Wants alerts when agent quality degrades
- Cares about cost trends over time

### Tertiary: The Agent Itself
- Uses MCP tools to self-assess and self-optimize
- Queries its own health score before taking risky actions
- Checks cost recommendations to pick cheaper models for simple tasks

## MVP Scope

### Feature 1: Cost Optimization Engine
- Analyze LLM call history per model, per agent, per task type
- Identify calls where a cheaper model would likely succeed (based on task complexity signals: token count, tool usage, error rate)
- Generate actionable recommendations: "Switch model X → Y for task type Z, estimated savings $N/month"
- MCP tool: `agentlens_optimize` — agent queries its own cost recommendations
- REST API: `GET /api/optimize/recommendations`
- Dashboard: Cost Optimization page with recommendations table + savings projection
- CLI: `agentlens optimize` command

### Feature 2: Health Scores
- Composite score (0-100) per agent combining: error rate, cost efficiency, tool success rate, average latency, session completion rate
- Historical tracking with trend direction (improving/stable/degrading)
- Configurable weights per dimension
- MCP tool: `agentlens_health` — agent checks its own health
- REST API: `GET /api/agents/:id/health`, `GET /api/health/overview`
- Dashboard: Health cards per agent with sparkline trends
- Alerts: health score drops below configurable threshold
- CLI: `agentlens health` command

## Out of Scope (for v0.6.0)
- Automatic model switching (agent autonomy — future feature)
- Cross-tenant health comparison (needs Memory Sharing — Phase 4)
- Cost forecasting / budget alerts (future)
- Custom health score formulas (configurable weights yes, custom formulas no)

## Success Metrics
- Agent developers can identify top 3 cost-saving opportunities within 5 minutes of setup
- Health score accurately reflects agent quality (validated by manual review of 10+ agents)
- MCP tools respond in <500ms for typical queries
- Zero regression in existing v0.5.0 functionality

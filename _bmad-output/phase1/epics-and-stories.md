# Epics & Stories: AgentLens v0.6.0

**Date:** 2026-02-08
**Status:** Approved

---

## Epic 1: Health Score Core (Server)

### Story 1.1: Health Score Types & Interfaces
**As a** developer, **I want** shared types for health scores **so that** all packages use consistent interfaces.

**Acceptance Criteria:**
- [ ] `HealthScore`, `HealthDimension`, `HealthTrend`, `HealthWeights` types in `@agentlensai/core`
- [ ] `HealthScoreSchema` Zod validation
- [ ] Default weights exported as constant
- [ ] Tests for schema validation (valid + invalid inputs)

### Story 1.2: Health Score Computer
**As a** server, **I want** to compute health scores from session/event data **so that** agents and users can assess agent quality.

**Acceptance Criteria:**
- [ ] `HealthComputer` class with `compute(agentId, windowDays)` and `computeOverview(windowDays)`
- [ ] 5 dimensions computed: error rate, cost efficiency, tool success, latency, completion rate
- [ ] Each dimension normalized to 0-100
- [ ] Weighted sum produces overall score 0-100
- [ ] Baseline is agent's own 30-day rolling average
- [ ] Trend computed by comparing current vs previous window
- [ ] Handles edge cases: no sessions (score=null), single session, new agent
- [ ] Tests: ≥15 test cases covering each dimension independently + combined + edge cases

### Story 1.3: Health Snapshot Store
**As a** server, **I want** to persist daily health snapshots **so that** historical trends can be rendered.

**Acceptance Criteria:**
- [ ] `health_snapshots` table created via migration
- [ ] `HealthSnapshotStore` with `save()`, `get()`, `getHistory(agentId, days)`, `cleanup(retentionDays)`
- [ ] Composite PK: `(tenant_id, agent_id, date)` — idempotent daily upsert
- [ ] Tenant isolation: all queries scoped to tenant_id
- [ ] Tests: ≥10 cases covering CRUD + tenant isolation + retention cleanup

### Story 1.4: Health REST Endpoints
**As an** API consumer, **I want** REST endpoints for health data **so that** I can integrate health monitoring into my tools.

**Acceptance Criteria:**
- [ ] `GET /api/agents/:id/health?window=7` — single agent health score
- [ ] `GET /api/health/overview?window=7` — all agents' scores
- [ ] `GET /api/health/history?agentId=X&days=30` — historical snapshots
- [ ] `GET /api/config/health-weights` — current weights
- [ ] `PUT /api/config/health-weights` — update weights (validates sum ≈ 1.0)
- [ ] Auth required on all endpoints, tenant-scoped
- [ ] 404 for unknown agent, 400 for invalid params
- [ ] Tests: ≥12 cases covering happy path + validation + auth + tenant isolation

### Story 1.5: Health MCP Tool
**As an** agent, **I want** an `agentlens_health` MCP tool **so that** I can check my own health score.

**Acceptance Criteria:**
- [ ] `agentlens_health` tool registered in MCP server
- [ ] Params: `{ window?: number }` (default 7)
- [ ] Returns: formatted text with overall score, trend, dimension breakdown
- [ ] Calls health REST endpoint via transport
- [ ] Tests: ≥5 cases covering params, response format, error handling

---

## Epic 2: Cost Optimization Core (Server)

### Story 2.1: Cost Optimization Types
**As a** developer, **I want** shared types for cost optimization **so that** all packages use consistent interfaces.

**Acceptance Criteria:**
- [ ] `ComplexityTier`, `CostRecommendation`, `OptimizationResult`, `ModelCosts` types in core
- [ ] `CostRecommendationSchema` Zod validation
- [ ] Default model costs exported as constant (GPT-4o, GPT-4o-mini, Claude Opus, Sonnet, Haiku)
- [ ] Tests for schema validation

### Story 2.2: Complexity Classifier
**As a** server, **I want** to classify LLM calls by complexity **so that** I can compare model performance per tier.

**Acceptance Criteria:**
- [ ] `classifyCallComplexity(event)` function
- [ ] Three tiers: simple (<500 input tokens, 0 tools), moderate (500-2000 tokens OR 1-3 tools), complex (>2000 tokens OR 4+ tools)
- [ ] Handles missing token counts gracefully (defaults to 'moderate')
- [ ] Tests: ≥10 cases covering each tier + edge cases + missing data

### Story 2.3: Recommendation Engine
**As a** server, **I want** to generate cost optimization recommendations **so that** users can save money.

**Acceptance Criteria:**
- [ ] `OptimizationEngine` class with `getRecommendations(options)`
- [ ] Queries llm_call + llm_response events for the period
- [ ] Groups by (model, complexity_tier, agent_id)
- [ ] Identifies cheaper model alternatives with ≥95% success rate
- [ ] Calculates estimated monthly savings
- [ ] Ranks by savings (highest first)
- [ ] Confidence levels: low (<50 calls), medium (50-200), high (>200)
- [ ] Handles: no data (empty results), single model (no alternatives), all models same price
- [ ] Tests: ≥15 cases

### Story 2.4: Optimization REST Endpoint
**As an** API consumer, **I want** a REST endpoint for recommendations **so that** I can integrate into my workflow.

**Acceptance Criteria:**
- [ ] `GET /api/optimize/recommendations?agentId=X&period=7&limit=10`
- [ ] Returns: `{ recommendations: CostRecommendation[], totalPotentialSavings: number, period: number, analyzedCalls: number }`
- [ ] Auth required, tenant-scoped
- [ ] Validates: period (1-90), limit (1-50)
- [ ] Returns empty recommendations array (not error) when no data
- [ ] Tests: ≥8 cases

### Story 2.5: Optimization MCP Tool
**As an** agent, **I want** an `agentlens_optimize` MCP tool **so that** I can check cost recommendations.

**Acceptance Criteria:**
- [ ] `agentlens_optimize` tool registered in MCP server
- [ ] Params: `{ period?: number, limit?: number }`
- [ ] Returns: formatted text with recommendations + total savings
- [ ] Tests: ≥5 cases

---

## Epic 3: SDK, CLI & Dashboard

### Story 3.1: TypeScript SDK Methods
**As a** TypeScript developer, **I want** SDK methods for health and optimization **so that** I can integrate programmatically.

**Acceptance Criteria:**
- [ ] `client.getHealth(agentId, window?)` → `HealthScore`
- [ ] `client.getHealthOverview(window?)` → `HealthScore[]`
- [ ] `client.getHealthHistory(agentId, days?)` → `HealthSnapshot[]`
- [ ] `client.getOptimizationRecommendations(options?)` → `OptimizationResult`
- [ ] Tests: ≥8 cases (mock HTTP, verify serialization)

### Story 3.2: Python SDK Methods
**As a** Python developer, **I want** SDK methods for health and optimization.

**Acceptance Criteria:**
- [ ] `client.get_health(agent_id, window=7)` → `HealthScore`
- [ ] `client.get_health_overview(window=7)` → list of `HealthScore`
- [ ] `client.get_optimization_recommendations(agent_id=None, period=7, limit=10)` → `OptimizationResult`
- [ ] Pydantic models for all response types
- [ ] Sync + async variants
- [ ] Tests: ≥8 cases

### Story 3.3: CLI Commands
**As a** CLI user, **I want** `health` and `optimize` commands.

**Acceptance Criteria:**
- [ ] `agentlens health` — overview table of all agents
- [ ] `agentlens health --agent <id>` — detailed single agent
- [ ] `agentlens health --agent <id> --history` — trend table
- [ ] `agentlens optimize` — recommendations table
- [ ] `agentlens optimize --agent <id>` — agent-specific
- [ ] `--format json|table` support
- [ ] Color-coded scores: green (≥75), yellow (50-74), red (<50)

### Story 3.4: Dashboard — Health Overview Page
**As a** dashboard user, **I want** a Health Overview page **so that** I can see all agents' health at a glance.

**Acceptance Criteria:**
- [ ] Grid of agent health cards
- [ ] Each card: agent name, score (circular gauge), trend arrow, sparkline (7-day)
- [ ] Color coding: green/yellow/red
- [ ] Click card → modal/page with dimension breakdown (bar chart)
- [ ] Filter by trend direction
- [ ] Added to sidebar navigation

### Story 3.5: Dashboard — Cost Optimization Page
**As a** dashboard user, **I want** a Cost Optimization page **so that** I can see savings opportunities.

**Acceptance Criteria:**
- [ ] Total potential savings banner at top
- [ ] Recommendations table: current model → recommended, tier, savings, confidence, call volume
- [ ] Cost trend chart (line chart, last 30 days, by model)
- [ ] Filter by agent, confidence level
- [ ] Added to sidebar navigation

---

## Story Dependencies

```
Epic 1 (Health Core):      1.1 → 1.2 → 1.3 → 1.4 → 1.5
Epic 2 (Cost Opt Core):    2.1 → 2.2 → 2.3 → 2.4 → 2.5
Epic 3 (SDK/CLI/Dashboard): 3.1 + 3.2 + 3.3 + 3.4 + 3.5 (all depend on Epics 1+2)

Epic 1 and Epic 2 are independent — can be developed in parallel.
Epic 3 depends on both Epic 1 and Epic 2 being complete.
```

## Story Count Summary

| Epic | Stories | Est. Tests |
|------|---------|-----------|
| 1: Health Score Core | 5 | ~50 |
| 2: Cost Optimization Core | 5 | ~45 |
| 3: SDK, CLI & Dashboard | 5 | ~25 |
| **Total** | **15** | **~120** |

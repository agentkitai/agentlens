# AgentLens Expansion Master Plan

**Created:** 2026-02-08
**Method:** Full BMAD (Analysis → Planning → Solutioning → Implementation)
**Scope:** 9 features, sequenced by dependency and value

---

## Sequencing Strategy

Features ordered by: (1) builds on existing code, (2) immediate user value, (3) dependency chain, (4) Cloud last per Amit's request.

### Phase 1: Foundation Extensions (v0.6.0)
> Builds directly on v0.5.0's reflect/analytics/embeddings. Minimal new architecture.

| # | Feature | Why First | Depends On |
|---|---------|-----------|------------|
| 1 | **Cost Optimization Engine** | We already track cost/model/agent. Just needs recommendation logic + UI. Immediate ROI story. | reflect, analytics |
| 2 | **Health Scores** | Aggregation of existing metrics (errors + cost + success). Single number = easy to understand/sell. | reflect, analytics |

### Phase 2: Visual & Debugging (v0.7.0)
> Dashboard-heavy. Makes AgentLens visceral and demo-able.

| # | Feature | Why Here | Depends On |
|---|---------|----------|------------|
| 3 | **Session Replay Debugger** | Event timeline exists. Needs visual step-through UI + decision context rendering. | events, sessions |
| 4 | **Agent Benchmarking / A/B Testing** | Compare two agent configs using health scores + cost optimization data. | health scores, cost opt |

### Phase 3: Safety & Integration (v0.8.0)
> Connects AgentLens to the broader ecosystem. Cross-product synergy.

| # | Feature | Why Here | Depends On |
|---|---------|----------|------------|
| 5 | **Proactive Guardrails** | AgentLens insights → AgentGate policy tightening. Needs both products mature. | health scores, AgentGate |
| 6 | **Framework Plugins** | Native LangChain/CrewAI/AutoGen/Semantic Kernel integrations. Adoption multiplier. | SDK v0.5.0 (done) |

### Phase 4: Network Effects (v0.9.0)
> Multi-agent and cross-tenant capabilities. The moat.

| # | Feature | Why Here | Depends On |
|---|---------|----------|------------|
| 7 | **Agent-to-Agent Discovery** | MCP service mesh. Agents find and delegate to each other. | tenant isolation, MCP |
| 8 | **Agent Memory Sharing** | Opt-in cross-tenant lesson sharing. Collective intelligence. | lessons, embeddings, trust model |

### Phase 5: Cloud (v1.0.0)
> SaaS deployment. Revenue. Scale.

| # | Feature | Why Last | Depends On |
|---|---------|----------|------------|
| 9 | **AgentLens Cloud** | Hosted version with free tier. Needs all features stable first. | everything above |

---

## BMAD Flow Per Feature

Each feature follows the full BMAD pipeline:

### Planning Phase
1. **`/product-brief`** — Define problem, users, and MVP scope
2. **`/create-prd`** — Full requirements with personas, metrics, and risks
3. **`/create-architecture`** — Technical decisions and system design

### Solutioning Phase
4. **`/create-epics-and-stories`** — Break work into prioritized stories
5. **`/sprint-planning`** — Initialize sprint tracking

### Implementation Phase (repeat per story)
6. **`/create-story`** — Detailed story with acceptance criteria
7. **`/dev-story`** — Implement the story
8. **`/code-review`** — Review the implementation

### Release
9. **Publish** — Version bump, npm/PyPI, GitHub release, changelog

---

## Feature Briefs

### 1. Cost Optimization Engine
**Goal:** Analyze per-model performance and suggest cost-saving model substitutions.
**Key Deliverables:**
- Cost analysis per model per agent per task type
- Success rate comparison across models for similar tasks
- Recommendation engine: "Use model X instead of Y for task Z, save $N/month"
- `agentlens_optimize` MCP tool for agents to self-optimize
- Dashboard: Cost insights page with actionable recommendations
- REST API: `GET /api/optimize/recommendations`

### 2. Health Scores
**Goal:** Single numeric score (0-100) per agent combining multiple quality signals.
**Key Deliverables:**
- Composite score algorithm: error rate, cost efficiency, tool success rate, latency, user feedback signals
- Historical tracking (score over time, trend direction)
- `agentlens_health` MCP tool
- Dashboard: Agent health cards with sparklines
- Alerts: score drops below threshold → notification
- REST API: `GET /api/agents/:id/health`

### 3. Session Replay Debugger
**Goal:** Visual step-through of agent sessions with full decision context.
**Key Deliverables:**
- Timeline scrubber UI (play/pause/step forward/back)
- Decision context panel (what the agent saw at each step)
- Tool call visualization (input → output → decision)
- LLM prompt/response viewer integrated into replay
- Branching visualization (what-if: "what would happen if...")
- Shareable replay URLs
- REST API: `GET /api/sessions/:id/replay`

### 4. Agent Benchmarking / A/B Testing
**Goal:** Data-driven agent config comparison with statistical rigor.
**Key Deliverables:**
- Benchmark definition: two agent configs, same task distribution
- Automatic metric collection (health score, cost, latency, error rate)
- Statistical significance testing (Mann-Whitney U, confidence intervals)
- `agentlens_benchmark` MCP tool + REST API
- Dashboard: Benchmark comparison view with charts
- Export: CSV/JSON benchmark reports

### 5. Proactive Guardrails
**Goal:** Automatic safety responses when agent behavior degrades.
**Key Deliverables:**
- Rule engine: "IF health score drops below 60 THEN require human approval for tool calls"
- AgentGate integration: dynamically adjust approval policies
- Escalation chains: warn → throttle → pause → alert human
- Circuit breaker pattern: auto-disable failing agents
- `agentlens_guardrail` MCP tool for agents to check their own status
- Dashboard: Guardrail configuration + history

### 6. Framework Plugins
**Goal:** One-line integration for popular agent frameworks.
**Key Deliverables:**
- `agentlensai-langchain`: LangChain tracer + callback handler
- `agentlensai-crewai`: CrewAI task/agent hooks
- `agentlensai-autogen`: AutoGen message hooks
- `agentlensai-semantic-kernel`: SK plugin
- Each: pip installable, <5 lines to integrate, auto-captures everything
- Documentation + quickstart guides per framework

### 7. Agent-to-Agent Discovery
**Goal:** Agents discover and delegate tasks to each other via AgentLens.
**Key Deliverables:**
- Agent capability registry (what each agent can do)
- Discovery protocol: "Find me an agent good at X"
- Delegation protocol: request → accept → execute → return
- Trust scores: based on historical performance (health scores)
- `agentlens_discover` + `agentlens_delegate` MCP tools
- Dashboard: Agent network graph visualization
- REST API: `GET /api/agents/discover`, `POST /api/agents/delegate`

### 8. Agent Memory Sharing
**Goal:** Opt-in cross-tenant knowledge sharing with privacy controls.
**Key Deliverables:**
- Sharing protocol: lessons marked as "shareable" by agents/admins
- Anonymization pipeline: strip tenant-specific data, keep patterns
- Community knowledge base: searchable shared lessons
- Trust/reputation system: higher-quality lessons ranked higher
- Privacy controls: what to share, what to keep private
- `agentlens_community` MCP tool
- Dashboard: Community knowledge browser
- Moderation: flag/remove harmful lessons

### 9. AgentLens Cloud (SaaS)
**Goal:** Hosted AgentLens with free tier, paid plans, multi-tenant infrastructure.
**Key Deliverables:**
- Cloud infrastructure (multi-tenant, auto-scaling)
- User auth (SSO, OAuth, API keys)
- Billing integration (Stripe)
- Free tier: 1 agent, 10K events/month
- Pro tier: unlimited agents, 1M events/month, all features
- Enterprise: dedicated, SLA, SSO, audit logs
- Migration tool: self-hosted → cloud
- Marketing site + docs

---

## Estimated Effort

Story counts and timelines TBD — determined by BMAD Solutioning phase per feature. No guessing upfront.

---

## Status Tracker

| # | Feature | BMAD Phase | Status |
|---|---------|------------|--------|
| 1 | Cost Optimization Engine | — | ⬜ Not started |
| 2 | Health Scores | — | ⬜ Not started |
| 3 | Session Replay Debugger | — | ⬜ Not started |
| 4 | Agent Benchmarking | — | ⬜ Not started |
| 5 | Proactive Guardrails | — | ⬜ Not started |
| 6 | Framework Plugins | — | ⬜ Not started |
| 7 | Agent-to-Agent Discovery | — | ⬜ Not started |
| 8 | Agent Memory Sharing | — | ⬜ Not started |
| 9 | AgentLens Cloud | — | ⬜ Not started |

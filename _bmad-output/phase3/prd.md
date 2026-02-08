# AgentLens v0.8.0 — Product Requirements Document

## Phase 3: Proactive Guardrails & Framework Plugins

**Version:** 0.8.0  
**Date:** 2026-02-08  
**Status:** Approved

---

## 1. Overview

AgentLens v0.8.0 delivers two features that transform AgentLens from passive observability into active agent management:

1. **Proactive Guardrails** — Automated responses to detected anomalies (error spikes, cost overruns, health degradation)
2. **Framework Plugins** — Native Python integrations for LangChain, CrewAI, AutoGen, and Semantic Kernel

---

## 2. Personas

### P1: DevOps/SRE Engineer (Guardrails)
- Manages agent fleets in production
- Needs automated circuit breakers and cost limits
- Cannot monitor dashboards 24/7
- Wants "set it and forget it" protection

### P2: Solo Developer (Guardrails)
- Runs agents overnight or on weekends
- Needs safety nets for runaway costs
- Wants simple rules without complex scripting

### P3: LangChain Developer (Plugins)
- Building agents with LangChain/LangGraph
- Expects `pip install agentlensai[langchain]` to just work
- Wants chain-level visibility, not just raw LLM calls

### P4: Enterprise ML Engineer (Plugins)
- Uses Microsoft frameworks (AutoGen/Semantic Kernel)
- Needs framework-native observability
- Requires zero-code-change integration

---

## 3. Requirements

### 3.1 Proactive Guardrails

| # | Requirement | Priority |
|---|------------|----------|
| R1 | Configurable guardrail rules with conditions and actions | Must |
| R2 | Condition: error_rate_threshold — triggers when error rate exceeds N% in a time window | Must |
| R3 | Condition: cost_limit — triggers when session or agent daily cost exceeds $N | Must |
| R4 | Condition: health_score_threshold — triggers when agent health score drops below N | Must |
| R5 | Condition: custom_metric — triggers on arbitrary numeric metric thresholds | Should |
| R6 | Action: pause_agent — emits a guardrail_triggered event to signal agent should stop | Must |
| R7 | Action: notify_webhook — sends HTTP POST to configured URL | Must |
| R8 | Action: downgrade_model — emits recommendation event with cheaper model suggestion | Should |
| R9 | Action: agentgate_policy — calls AgentGate API to update policies (optional) | Should |
| R10 | Cooldown period per rule to prevent repeated triggering | Must |
| R11 | Dry-run mode for testing rules without executing actions | Must |
| R12 | Guardrail evaluation runs ASYNC after event ingestion (never blocks POST) | Must |
| R13 | REST API for guardrail CRUD (create, read, update, delete, list) | Must |
| R14 | REST API for guardrail status and trigger history | Must |
| R15 | MCP tool for querying guardrail status | Must |
| R16 | Guardrail state persisted in SQLite (cooldowns, trigger counts, history) | Must |
| R17 | Dashboard page for guardrail management | Should |

### 3.2 Framework Plugins

| # | Requirement | Priority |
|---|------------|----------|
| R18 | LangChain callback handler captures chain/agent/tool lifecycle events | Must |
| R19 | CrewAI plugin captures task execution, agent delegation, crew lifecycle | Must |
| R20 | AutoGen plugin captures conversation turns, agent messages, tool calls | Must |
| R21 | Semantic Kernel plugin captures function calls, planner steps | Must |
| R22 | All plugins share a common base class for consistency | Must |
| R23 | Auto-detection in `agentlensai.init()` for installed frameworks | Must |
| R24 | Plugins are fail-safe — never break user code, catch all exceptions | Must |
| R25 | Framework metadata mapped to existing AgentLens event types | Must |
| R26 | Each plugin installable via extras: `pip install agentlensai[framework]` | Should |

---

## 4. Constraints

- **No new npm/pip dependencies** for core packages (Python plugins use framework SDKs as optional deps)
- **SQLite only** — guardrail state stored in same DB as events
- **Async evaluation** — guardrails evaluate after event ingestion, never blocking the event POST response
- **Fail-safe plugins** — framework plugins must NEVER raise exceptions to user code
- **Backward compatible** — existing APIs, events, and integrations must continue to work unchanged
- **Python-first plugins** — no TypeScript/JavaScript framework plugins in this phase

---

## 5. Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| False positive guardrails pause agents unnecessarily | High | Medium | Dry-run mode, conservative defaults, cooldown periods |
| Framework SDK API changes break plugins | Medium | Medium | Pin versions, abstract through base class, defensive coding |
| Guardrail evaluation adds latency to event flow | Medium | Low | Async-only evaluation, event bus subscription |
| Plugin maintenance burden (4 frameworks) | Medium | High | Shared base class, consistent patterns |
| AgentGate integration couples products | Low | Low | AgentGate action is optional, standalone guardrails work |

---

## 6. Acceptance Criteria

### Guardrails
- AC1: Can create a guardrail rule via REST API with any supported condition/action
- AC2: Guardrail evaluates automatically after event ingestion (< 50ms)
- AC3: Actions fire correctly when conditions are met
- AC4: Cooldown prevents re-triggering within configured period
- AC5: Dry-run mode logs what would happen without executing actions
- AC6: Trigger history is queryable via REST API
- AC7: MCP tool returns current guardrail status
- AC8: All guardrail state survives server restart (persisted in SQLite)

### Framework Plugins
- AC9: LangChain handler captures chain start/end, LLM calls, tool calls
- AC10: CrewAI plugin captures task/agent lifecycle with crew context
- AC11: AutoGen plugin captures multi-agent conversation turns
- AC12: Semantic Kernel plugin captures function/planner execution
- AC13: All plugins work with `agentlensai.init()` auto-detection
- AC14: All plugins are fail-safe (wrap everything in try/except)
- AC15: Events from plugins appear correctly in AgentLens dashboard/API

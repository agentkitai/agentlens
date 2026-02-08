# AgentLens v0.8.0 — Product Brief

## Phase 3 Features: Proactive Guardrails & Framework Plugins

**Date:** 2026-02-08
**Author:** BMAD Product Strategy
**Status:** Draft

---

## 1. Executive Summary

AgentLens v0.7.0 provides comprehensive observability, session replay, A/B benchmarking, health scores, cost optimization, semantic recall, and pattern analysis. However, two critical gaps remain:

1. **Observability without action is passive.** AgentLens can detect error spikes, cost anomalies, and degraded health scores — but it cannot _do_ anything about them. Developers must manually notice dashboard alerts, then separately configure guardrails in their orchestration layer. The insight-to-action loop is broken.

2. **Integration requires manual SDK wiring.** Python developers using popular frameworks (LangChain, CrewAI, AutoGen, Semantic Kernel) must manually instrument their code with the AgentLens SDK. This friction limits adoption — framework users expect drop-in observability via callbacks/hooks, not manual API calls.

v0.8.0 addresses both with **Proactive Guardrails** (automated responses to detected issues) and **Framework Plugins** (native integrations for 4 major agent frameworks).

---

## 2. Problem Statements

### 2.1 Proactive Guardrails

**The problem:** AgentLens detects problems — error rate spikes, cost overruns, health score degradation, anomalous patterns — but can only alert. The developer must:
1. Notice the alert (minutes to hours)
2. Diagnose the root cause (replay, logs)
3. Manually configure rate limits, model downgrades, or circuit breakers
4. Deploy the fix

**The impact:**
- Average response time from detection to mitigation: 30 min - 4 hours
- During that window, the agent continues making expensive mistakes
- No automated circuit breaker for runaway costs
- AgentGate (policy enforcement) exists but has no integration with AgentLens insights

**What success looks like:**
- Configurable guardrail rules: "If error rate > 30% in 5 min window, pause agent"
- Cost circuit breakers: "If session cost > $5, block further LLM calls"
- Automated model downgrade: "If health score < 40, switch to cheaper model"
- Webhook notifications to external systems (Slack, PagerDuty, custom)
- Optional AgentGate integration: AgentLens guardrails trigger AgentGate policy changes

### 2.2 Framework Plugins

**The problem:** AgentLens's auto-instrumentation (v0.4.0) patches OpenAI/Anthropic SDKs directly. But the majority of production agents are built with frameworks that wrap these SDKs:
- **LangChain/LangGraph** — Most popular (~45% market share)
- **CrewAI** — Multi-agent orchestration
- **AutoGen** — Microsoft's multi-agent framework
- **Semantic Kernel** — Microsoft's AI orchestration SDK

Framework users get partial coverage (raw LLM calls are captured), but miss:
- Agent/chain/crew abstractions (which agent made which call)
- Tool routing metadata (framework-level tool dispatch)
- Memory operations (framework-managed context)
- Step/chain/graph transitions

**The impact:**
- Framework users see raw LLM calls but lose the semantic context of *why*
- No framework-native installation path (e.g., `AgentLensCallbackHandler` for LangChain)
- Competitive disadvantage vs LangSmith (native LangChain), Helicone (LLM proxy)
- Agent-level grouping is manual (users must set `agentId` themselves)

**What success looks like:**
- `pip install agentlensai[langchain]` → drop-in callback handler
- `pip install agentlensai[crewai]` → CrewAI task/agent tracking
- `pip install agentlensai[autogen]` → AutoGen conversation tracking
- `pip install agentlensai[semantic-kernel]` → SK function/planner tracking
- Each plugin captures framework-specific metadata: chain steps, agent delegation, tool routing
- Zero-config: `agentlensai.init()` auto-detects installed frameworks

---

## 3. Target Users

### 3.1 Proactive Guardrails
- **DevOps/SRE teams** managing agent fleets in production
- **Solo developers** who can't monitor dashboards 24/7
- **Teams using AgentGate** who want insight-driven policy enforcement

### 3.2 Framework Plugins
- **LangChain developers** (largest segment, ~45%)
- **CrewAI users** building multi-agent workflows
- **Enterprise teams** using Microsoft's AutoGen/Semantic Kernel
- **Python-first teams** who want framework-native observability

---

## 4. Scope

### In Scope
- Guardrail rule engine with configurable conditions and actions
- Cost circuit breaker (per-session and per-agent daily limits)
- Error rate threshold with auto-pause
- Health score threshold with configurable response
- Webhook action type (HTTP POST to external URL)
- AgentGate integration action type (optional, when AgentGate URL configured)
- Guardrail evaluation MCP tool (`agentlens_guardrails`)
- REST API for guardrail CRUD + status
- Dashboard page for guardrail management
- LangChain callback handler plugin
- CrewAI task/agent lifecycle plugin  
- AutoGen conversation/agent plugin
- Semantic Kernel function/planner plugin
- Framework auto-detection in `agentlensai.init()`

### Out of Scope
- Real-time stream processing (guardrails evaluate on event ingestion, not continuous)
- Custom guardrail scripting language (use predefined condition types)
- JavaScript/TypeScript framework plugins (LangChain.js etc.) — Python first
- Framework-specific dashboards (all data flows into existing AgentLens views)
- Paid guardrail features (all open source)

---

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Guardrail evaluation latency | < 50ms per event | Benchmark in CI |
| Time from anomaly detection to automated action | < 30 seconds | Integration test |
| Framework plugin installation to first event | < 5 minutes | User testing |
| Framework metadata coverage | > 80% of framework concepts captured | Feature matrix |
| Test coverage | > 90% for guardrails, > 85% for plugins | CI |

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Guardrails create false positives → agents unnecessarily paused | High | Conservative defaults, "dry run" mode, cooldown periods |
| Framework APIs change frequently (breaking plugins) | Medium | Pin framework versions, abstract through interface layer |
| AgentGate integration couples two products | Medium | AgentGate action is optional, guardrails work standalone |
| Guardrail evaluation adds latency to event ingestion | Medium | Async evaluation, don't block event acknowledgment |
| Plugin maintenance burden (4 frameworks) | Medium | Shared base class, integration tests against real frameworks |

---

## 7. Technical Notes

- Guardrails should evaluate asynchronously after event ingestion (don't block the event POST response)
- Guardrail state (cooldowns, trigger counts) stored in SQLite alongside events
- Framework plugins are Python-only, distributed via `agentlensai[framework]` extras
- Each plugin maps framework concepts to AgentLens event types
- Plugins should be fail-safe (same principle as auto-instrumentation: never break user code)

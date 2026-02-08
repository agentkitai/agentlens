# AgentLens v0.8.0 — Product Requirements Document (PRD)

## Proactive Guardrails & Framework Plugins

**Date:** 2026-02-08
**Version:** 1.0
**Status:** Draft

---

## Table of Contents

1. [User Personas](#1-user-personas)
2. [Feature 1: Proactive Guardrails](#2-feature-1-proactive-guardrails)
3. [Feature 2: Framework Plugins](#3-feature-2-framework-plugins)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Dependencies on v0.7.0](#5-dependencies-on-v070)
6. [Risks and Mitigations](#6-risks-and-mitigations)
7. [Open Questions](#7-open-questions)

---

## 1. User Personas

### Persona 1: Maya — Agent Developer

- **Role:** Full-stack developer building AI agents with MCP
- **Experience:** 2 years with LLMs, 9 months with AgentLens (power user since v0.5.0)
- **Daily workflow:** Writes agent code, deploys, monitors health scores and replays, iterates on prompts
- **Pain points:**
  - Wakes up to find an agent burned $47 overnight on a retry loop she could have caught in minutes
  - Gets Slack alerts from AgentLens but must manually SSH in to pause the agent — the insight-to-action loop takes 30+ minutes
  - Uses LangChain for 3 of her 5 agents but only gets raw LLM call data — can't see which chain step failed or which agent delegated to which
  - Manually instruments each new LangChain project with SDK calls; it takes 20-30 minutes per project
- **Goals:**
  - Set cost circuit breakers so runaway agents auto-pause before burning budget
  - Drop-in LangChain observability with `agentlensai[langchain]` — zero manual instrumentation
- **Guardrail use:** Creates "cost > $10/session → pause agent" and "error rate > 30% in 5 min → webhook to Slack" rules
- **Plugin use:** Replaces manual SDK calls with `AgentLensCallbackHandler` in her LangChain agents

### Persona 2: Raj — Platform Team Lead

- **Role:** Engineering manager overseeing 5 teams, each running 3-4 agents
- **Experience:** 10 years in platform engineering, 1.5 years with AI agents
- **Daily workflow:** Reviews dashboards, sets quality gates, reviews cost reports, approves deployments
- **Pain points:**
  - His teams use 3 different frameworks (LangChain, CrewAI, Semantic Kernel) — each has different observability gaps
  - No automated circuit breakers — relies on developers monitoring their own agents
  - AgentGate policies are manually configured; no feedback loop from AgentLens health signals
  - Weekend incidents go undetected until Monday morning
- **Goals:**
  - Organization-wide guardrails: "Any agent with health < 40 auto-downgrades to cheaper model"
  - Standardized observability across all frameworks with consistent metadata
- **Guardrail use:** Sets org-wide rules: health thresholds, daily cost limits per agent, webhook notifications to PagerDuty
- **Plugin use:** Mandates framework plugins for all teams — wants consistent agent/chain/tool metadata regardless of framework

### Persona 3: Dani — CrewAI Developer

- **Role:** AI engineer building multi-agent workflows with CrewAI
- **Experience:** 3 years ML engineering, 8 months with CrewAI, new to AgentLens
- **Daily workflow:** Designs crew compositions, configures agent roles, tests multi-agent task delegation
- **Pain points:**
  - AgentLens captures LLM calls but has no concept of CrewAI crews, agents, or task delegation
  - Cannot see which crew member made which LLM call or how tasks were delegated
  - Manual `agentId` assignment doesn't capture crew→agent→task hierarchy
  - Other observability tools (LangSmith) don't support CrewAI natively either
- **Goals:**
  - `pip install agentlensai[crewai]` → see full crew/agent/task hierarchy in AgentLens dashboard
  - Track task delegation, agent collaboration patterns, and per-agent costs within a crew
- **Plugin use:** Drops in CrewAI plugin, immediately sees task-level cost breakdowns and delegation patterns

### Persona 4: Agent-X — Self-Monitoring AI Agent

- **Role:** An autonomous AI agent using AgentLens MCP tools
- **Experience:** N/A (software)
- **Workflow:** Executes tasks, monitors own health, learns from mistakes, self-optimizes
- **Pain points:**
  - Can detect its own health degradation via `agentlens_health` but cannot take corrective action
  - Must rely on human operators to pause it or adjust configuration when things go wrong
  - No programmatic way to set guardrails for itself or check guardrail status
- **Goals:**
  - Use `agentlens_guardrails` MCP tool to check what guardrails are active and their current state
  - Understand when it has been rate-limited or model-downgraded by a guardrail
- **Guardrail use:** Calls `agentlens_guardrails` to check if any guardrail has triggered, adjusts own behavior accordingly

---

## 2. Feature 1: Proactive Guardrails

### 2.1 Functional Requirements

#### FR-G1: Guardrail Rule Definition

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G1.1 | Users SHALL be able to create guardrail rules with: name, description, condition type, condition config, action type, action config, optional agent scope, cooldown period, and dry-run flag | P0 |
| FR-G1.2 | Supported condition types SHALL be: `error_rate_threshold` (error rate exceeds % in time window), `cost_limit` (session cost or daily agent cost exceeds $), `health_score_threshold` (health score falls below value), `custom_metric` (arbitrary metric from event metadata exceeds threshold) | P0 |
| FR-G1.3 | Supported action types SHALL be: `pause_agent` (set agent to paused state, reject new sessions), `notify_webhook` (HTTP POST to configured URL), `downgrade_model` (set model preference metadata on agent), `agentgate_policy` (trigger AgentGate policy change via API) | P0 |
| FR-G1.4 | Each guardrail rule SHALL have a configurable cooldown period (default: 15 minutes) to prevent action spam after initial trigger | P0 |
| FR-G1.5 | Each guardrail rule SHALL support a `dryRun` mode that evaluates conditions and logs triggers without executing actions | P0 |
| FR-G1.6 | Guardrail rules SHALL be scopeable to a specific agent (by agentId) or apply globally to all agents within the tenant | P1 |
| FR-G1.7 | Users SHALL be able to enable/disable individual guardrail rules without deleting them | P0 |

#### FR-G2: Condition Evaluation

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G2.1 | The guardrail engine SHALL evaluate conditions asynchronously after event ingestion — NEVER blocking the event POST response | P0 |
| FR-G2.2 | `error_rate_threshold` condition SHALL compute error rate as (error events / total events) within a configurable sliding window (default: 5 minutes) | P0 |
| FR-G2.3 | `cost_limit` condition SHALL support two modes: per-session (cumulative cost of current session) and per-agent-daily (total cost for agent in current UTC day) | P0 |
| FR-G2.4 | `health_score_threshold` condition SHALL use the existing HealthComputer to evaluate the agent's current health score | P0 |
| FR-G2.5 | `custom_metric` condition SHALL extract a numeric value from event metadata by configurable key path and compare against a threshold | P1 |
| FR-G2.6 | Condition evaluation SHALL respect the cooldown period — if a rule triggered within its cooldown window, skip re-evaluation | P0 |
| FR-G2.7 | Condition evaluation SHALL be idempotent — evaluating the same event twice SHALL NOT produce duplicate triggers | P0 |

#### FR-G3: Action Execution

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G3.1 | `pause_agent` action SHALL set the agent's status to `paused` in the database and emit a `guardrail_triggered` event | P0 |
| FR-G3.2 | `pause_agent` action SHALL cause the event ingestion endpoint to return a `X-AgentLens-Agent-Paused: true` header (informational only — event is still accepted) | P1 |
| FR-G3.3 | `notify_webhook` action SHALL send an HTTP POST to the configured URL with a JSON body containing: rule name, condition details, current value, threshold, agent ID, session ID, timestamp | P0 |
| FR-G3.4 | `notify_webhook` action SHALL retry up to 3 times with exponential backoff (1s, 2s, 4s) on 5xx or timeout, then log failure | P0 |
| FR-G3.5 | `downgrade_model` action SHALL set a `modelOverride` metadata field on the agent record, which the Python SDK can read on next LLM call | P0 |
| FR-G3.6 | `agentgate_policy` action SHALL make an HTTP request to the configured AgentGate URL to create or update a policy rule (e.g., block specific tools, require approval for expensive operations) | P1 |
| FR-G3.7 | `agentgate_policy` action SHALL be optional — guardrails work fully without AgentGate configured | P0 |
| FR-G3.8 | All action executions SHALL be logged in a `guardrail_trigger_history` table with: timestamp, rule ID, condition value, threshold, action executed (bool), action result, metadata | P0 |
| FR-G3.9 | In `dryRun` mode, actions SHALL be logged to trigger history with `actionExecuted: false` but NOT actually executed | P0 |

#### FR-G4: Guardrail State Management

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G4.1 | Runtime guardrail state (cooldown timers, trigger counts, last evaluation timestamps) SHALL be stored in SQLite alongside existing data | P0 |
| FR-G4.2 | Guardrail state SHALL be scoped per rule per tenant (no cross-tenant state leakage) | P0 |
| FR-G4.3 | Users SHALL be able to manually reset a guardrail's state (clear cooldown, reset trigger count) | P1 |
| FR-G4.4 | Users SHALL be able to manually unpause an agent that was paused by a guardrail | P0 |

#### FR-G5: Guardrail REST API

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G5.1 | `POST /api/guardrails` — Create a new guardrail rule | P0 |
| FR-G5.2 | `GET /api/guardrails` — List guardrail rules with filters (enabled, agentId, conditionType, actionType) | P0 |
| FR-G5.3 | `GET /api/guardrails/:id` — Get guardrail rule detail including current state (last triggered, trigger count, cooldown remaining) | P0 |
| FR-G5.4 | `PUT /api/guardrails/:id` — Update guardrail rule configuration | P0 |
| FR-G5.5 | `DELETE /api/guardrails/:id` — Delete a guardrail rule and its state | P0 |
| FR-G5.6 | `PUT /api/guardrails/:id/enable` — Enable a guardrail rule | P0 |
| FR-G5.7 | `PUT /api/guardrails/:id/disable` — Disable a guardrail rule | P0 |
| FR-G5.8 | `POST /api/guardrails/:id/reset` — Reset guardrail state (clear cooldown, reset counters) | P1 |
| FR-G5.9 | `GET /api/guardrails/:id/history` — Get trigger history for a guardrail rule with pagination | P0 |
| FR-G5.10 | `PUT /api/agents/:id/unpause` — Manually unpause a paused agent | P0 |
| FR-G5.11 | All guardrail endpoints SHALL require authentication and enforce tenant isolation | P0 |

#### FR-G6: Guardrail MCP Tool

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G6.1 | `agentlens_guardrails` MCP tool SHALL support actions: list, status, history, create, update, enable, disable | P0 |
| FR-G6.2 | `list` action SHALL return all guardrail rules for the tenant with their current enabled/disabled status and trigger counts | P0 |
| FR-G6.3 | `status` action SHALL return current evaluation state for a specific rule: last triggered time, trigger count, cooldown remaining, last condition value | P0 |
| FR-G6.4 | `history` action SHALL return recent trigger events for a specific rule with timestamps and action results | P0 |
| FR-G6.5 | `create` action SHALL allow creating a new guardrail rule with full configuration | P1 |
| FR-G6.6 | The tool description SHALL explain guardrail concepts: conditions, actions, cooldowns, dry-run mode | P0 |

#### FR-G7: Guardrail Dashboard

| ID | Requirement | Priority |
|----|------------|----------|
| FR-G7.1 | The dashboard SHALL display a guardrail list page showing all rules with: name, condition summary, action type, enabled/disabled status, last triggered, trigger count | P0 |
| FR-G7.2 | The guardrail detail page SHALL show full configuration, current state, and trigger history timeline | P0 |
| FR-G7.3 | The guardrail create/edit form SHALL provide dropdowns for condition and action types with contextual configuration fields | P0 |
| FR-G7.4 | The dashboard SHALL show a visual indicator on the agent list page when an agent is paused by a guardrail | P0 |
| FR-G7.5 | The dashboard SHALL provide a one-click "Unpause" button for guardrail-paused agents | P0 |
| FR-G7.6 | Guardrail trigger events SHALL appear in the existing activity feed / event stream | P1 |

### 2.2 User Stories Summary

See `epics-and-stories.md` for full story breakdown with acceptance criteria.

---

## 3. Feature 2: Framework Plugins

### 3.1 Functional Requirements

#### FR-F1: Plugin Architecture & Shared Base

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1.1 | All framework plugins SHALL inherit from a shared `BasePlugin` class that handles: AgentLens client initialization, fail-safe wrapping, event emission, and configuration | P0 |
| FR-F1.2 | Every plugin method that wraps user code SHALL be fail-safe: exceptions in plugin code MUST be caught and logged, NEVER propagated to user code | P0 |
| FR-F1.3 | Plugins SHALL support configuration via `agentlensai.init()` kwargs: `server_url`, `api_key`, `tenant_id`, `auto_detect` (bool, default: True) | P0 |
| FR-F1.4 | When `auto_detect=True`, `agentlensai.init()` SHALL detect installed frameworks and activate their plugins automatically | P0 |
| FR-F1.5 | Plugins SHALL be distributed as pip extras: `pip install agentlensai[langchain]`, `agentlensai[crewai]`, `agentlensai[autogen]`, `agentlensai[semantic-kernel]`, and `agentlensai[all]` for all plugins | P0 |
| FR-F1.6 | Each plugin SHALL map framework concepts to AgentLens event types using a consistent mapping strategy documented in a mapping table | P0 |
| FR-F1.7 | Plugins SHALL add framework-specific metadata to events (e.g., `metadata.framework = "langchain"`, `metadata.chain_name = "RetrievalQA"`) | P0 |
| FR-F1.8 | Plugins SHALL automatically set `agentId` from framework agent/chain identifiers, eliminating manual ID assignment | P0 |

#### FR-F2: LangChain Plugin (Enhanced)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2.1 | The LangChain plugin SHALL provide an `AgentLensCallbackHandler` implementing LangChain's `BaseCallbackHandler` interface | P0 |
| FR-F2.2 | The callback handler SHALL capture chain lifecycle events: `on_chain_start`, `on_chain_end`, `on_chain_error` → mapped to AgentLens session and custom events with chain type and name in metadata | P0 |
| FR-F2.3 | The callback handler SHALL capture LLM events: `on_llm_start`, `on_llm_end`, `on_llm_error` → mapped to `llm_call`, `llm_response` events with full prompt/response data | P0 |
| FR-F2.4 | The callback handler SHALL capture tool events: `on_tool_start`, `on_tool_end`, `on_tool_error` → mapped to `tool_call`, `tool_response`, `tool_error` events | P0 |
| FR-F2.5 | The callback handler SHALL capture retriever events: `on_retriever_start`, `on_retriever_end` → mapped to custom events with query, document count, and source metadata | P1 |
| FR-F2.6 | The callback handler SHALL capture agent events: `on_agent_action`, `on_agent_finish` → mapped to custom events with action details and agent reasoning | P0 |
| FR-F2.7 | The callback handler SHALL support LangGraph by capturing graph node transitions via the `on_chain_start`/`on_chain_end` callbacks with graph-specific metadata | P1 |
| FR-F2.8 | The callback handler SHALL be usable as: `chain.invoke(input, config={"callbacks": [handler]})` or globally via `agentlensai.init()` | P0 |
| FR-F2.9 | The plugin SHALL support LangChain v0.2+ and v0.3+ | P0 |

#### FR-F3: CrewAI Plugin

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F3.1 | The CrewAI plugin SHALL capture crew lifecycle: crew kickoff → `session_started`, crew completion → `session_ended` | P0 |
| FR-F3.2 | The plugin SHALL capture agent lifecycle within a crew: agent start/end → custom events with agent role, goal, and backstory in metadata | P0 |
| FR-F3.3 | The plugin SHALL capture task lifecycle: task start/end → custom events with task description, expected output, assigned agent, and actual output | P0 |
| FR-F3.4 | The plugin SHALL capture task delegation: when one agent delegates to another → custom event with delegator, delegatee, and delegation reason | P0 |
| FR-F3.5 | The plugin SHALL capture tool usage within agents: tool calls → mapped to `tool_call`/`tool_response` events with the calling agent in metadata | P0 |
| FR-F3.6 | The plugin SHALL set `agentId` to `{crew_name}/{agent_role}` for hierarchical identification | P0 |
| FR-F3.7 | The plugin SHALL be activated via: `Crew(agents=[...], tasks=[...], agentlens=True)` or globally via `agentlensai.init()` | P0 |
| FR-F3.8 | The plugin SHALL support CrewAI v0.28+ | P0 |

#### FR-F4: AutoGen Plugin

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F4.1 | The AutoGen plugin SHALL capture conversation lifecycle: initiate_chat → `session_started`, conversation end → `session_ended` | P0 |
| FR-F4.2 | The plugin SHALL capture agent message exchanges: each agent message → custom event with sender agent, receiver agent, message content, and message type | P0 |
| FR-F4.3 | The plugin SHALL capture LLM calls made by agents: → `llm_call`/`llm_response` events with the calling agent in metadata | P0 |
| FR-F4.4 | The plugin SHALL capture code execution events: code generation and execution → custom events with code content, execution result, and exit code | P1 |
| FR-F4.5 | The plugin SHALL capture function/tool calls: → `tool_call`/`tool_response` events | P0 |
| FR-F4.6 | The plugin SHALL set `agentId` from AutoGen agent names | P0 |
| FR-F4.7 | The plugin SHALL support both AutoGen v0.2 (pyautogen) and AutoGen v0.4+ (autogen-agentchat) | P0 |
| FR-F4.8 | The plugin SHALL be activated via: `agentlensai.init()` auto-detection or explicit `from agentlensai.plugins.autogen import AgentLensAutogenPlugin` | P0 |

#### FR-F5: Semantic Kernel Plugin

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F5.1 | The Semantic Kernel plugin SHALL implement SK's filter interface (`FunctionInvocationFilter` and/or `AutoFunctionInvocationFilter`) | P0 |
| FR-F5.2 | The plugin SHALL capture function invocations: kernel function calls → `tool_call`/`tool_response` events with function name, plugin name, and parameters | P0 |
| FR-F5.3 | The plugin SHALL capture planner operations: plan creation and execution → custom events with plan steps, goal, and execution result | P1 |
| FR-F5.4 | The plugin SHALL capture prompt rendering: template rendering → custom events with template name, variables, and rendered result | P1 |
| FR-F5.5 | The plugin SHALL capture LLM service calls: AI service invocations → `llm_call`/`llm_response` events with service ID and connector type | P0 |
| FR-F5.6 | The plugin SHALL capture memory operations: memory store/recall → custom events with memory type and key metadata | P1 |
| FR-F5.7 | The plugin SHALL set `agentId` from the kernel name or configured agent identifier | P0 |
| FR-F5.8 | The plugin SHALL support Semantic Kernel for Python v1.0+ | P0 |
| FR-F5.9 | The plugin SHALL be activated via kernel filter registration: `kernel.add_filter(AgentLensFilter())` or globally via `agentlensai.init()` | P0 |

#### FR-F6: Framework Auto-Detection

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F6.1 | `agentlensai.init()` SHALL detect installed frameworks by attempting to import their packages: `langchain`, `crewai`, `autogen`/`autogen_agentchat`, `semantic_kernel` | P0 |
| FR-F6.2 | Auto-detection SHALL be non-blocking: if a framework import fails, skip it silently and continue | P0 |
| FR-F6.3 | Auto-detection SHALL log detected frameworks at INFO level: "AgentLens: Detected LangChain v0.3.1, CrewAI v0.30.0. Plugins activated." | P0 |
| FR-F6.4 | Users SHALL be able to disable auto-detection and manually activate specific plugins: `agentlensai.init(auto_detect=False, plugins=["langchain"])` | P1 |
| FR-F6.5 | Auto-detection SHALL run once at `init()` time, not on every event | P0 |

#### FR-F7: SDK Model Override Support (Guardrail Integration)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F7.1 | The Python SDK SHALL check the agent's `modelOverride` metadata on each LLM call when guardrails are active | P0 |
| FR-F7.2 | When a `modelOverride` is set (by a `downgrade_model` guardrail action), the SDK SHALL substitute the model parameter before forwarding to the LLM provider | P0 |
| FR-F7.3 | The SDK SHALL log model override events: "AgentLens guardrail: Model downgraded from gpt-4o to gpt-4o-mini (rule: cost-circuit-breaker)" | P0 |
| FR-F7.4 | Model override SHALL be opt-in: only active when `agentlensai.init(guardrail_enforcement=True)` is set | P0 |
| FR-F7.5 | Framework plugins SHALL respect model overrides when they control LLM calls (e.g., LangChain callback can modify model selection) | P1 |

### 3.2 User Stories Summary

See `epics-and-stories.md` for full story breakdown with acceptance criteria.

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|------------|
| NFR-1 | Guardrail condition evaluation SHALL complete in < 50ms per event (measured in CI benchmarks) |
| NFR-2 | Guardrail evaluation SHALL NOT add latency to the event ingestion POST response — evaluation is fully asynchronous |
| NFR-3 | Webhook notification delivery (first attempt) SHALL complete in < 5 seconds including network round-trip |
| NFR-4 | Framework plugin overhead per event SHALL be < 5ms (measured: time difference between instrumented and uninstrumented call) |
| NFR-5 | `agentlensai.init()` with auto-detection SHALL complete in < 500ms |
| NFR-6 | Guardrail list page SHALL load in < 1 second for up to 100 rules |

### 4.2 Reliability & Fail-Safety

| ID | Requirement |
|----|------------|
| NFR-7 | Framework plugin failures SHALL NEVER propagate exceptions to user code — all plugin methods wrapped in try/catch with error logging |
| NFR-8 | Guardrail action failures SHALL NOT affect event ingestion — a failed webhook or AgentGate call logs the failure and continues |
| NFR-9 | If the AgentLens server is unreachable, framework plugins SHALL buffer up to 100 events locally and retry, then silently drop if buffer is full |
| NFR-10 | Guardrail evaluation failures (e.g., database error during condition check) SHALL log the error and skip evaluation — never crash the event pipeline |

### 4.3 Security

| ID | Requirement |
|----|------------|
| NFR-11 | All guardrail endpoints SHALL require valid API key authentication |
| NFR-12 | Guardrail rules, state, and trigger history SHALL be tenant-isolated — no cross-tenant data access |
| NFR-13 | Webhook notification URLs SHALL be validated (HTTPS only in production, HTTP allowed in development) |
| NFR-14 | Webhook payloads SHALL NOT include raw LLM prompt/response content — only metadata (rule name, metric values, agent ID) |
| NFR-15 | AgentGate integration credentials SHALL be stored as encrypted configuration, not in guardrail rule definitions |

### 4.4 Testing

| ID | Requirement |
|----|------------|
| NFR-16 | All new server code (guardrail engine, API routes) SHALL have unit test coverage ≥ 90% |
| NFR-17 | All new API endpoints SHALL have integration tests covering happy path, error cases, and tenant isolation |
| NFR-18 | Each framework plugin SHALL have integration tests running against the real framework (pinned version) |
| NFR-19 | Guardrail condition evaluation SHALL have property-based tests for edge cases (boundary values, concurrent evaluation, cooldown timing) |
| NFR-20 | Framework plugins SHALL have fail-safety tests: verify that plugin exceptions do not propagate to user code |
| NFR-21 | End-to-end tests SHALL verify the full guardrail loop: event ingestion → condition evaluation → action execution → state update |

### 4.5 Compatibility

| ID | Requirement |
|----|------------|
| NFR-22 | All existing API endpoints SHALL remain unchanged — guardrails and plugins are additive only |
| NFR-23 | New database tables SHALL be created via Drizzle migrations — no modification of existing tables |
| NFR-24 | Framework plugins SHALL specify supported framework version ranges and fail gracefully on unsupported versions |
| NFR-25 | The Python SDK SHALL maintain backward compatibility: `agentlensai.init()` without plugin arguments SHALL behave identically to v0.7.0 |
| NFR-26 | MCP tools SHALL follow the existing registration pattern (`McpServer.tool()`) |
| NFR-27 | Guardrail types (`GuardrailRule`, `GuardrailState`, `GuardrailTriggerHistory`, `GuardrailConditionResult`) already defined in `@agentlensai/core` types.ts SHALL be used as-is |

### 4.6 Observability

| ID | Requirement |
|----|------------|
| NFR-28 | Guardrail evaluations SHALL emit structured log entries: rule ID, condition type, current value, threshold, triggered (bool), action taken |
| NFR-29 | Framework plugin activations SHALL be logged at startup: framework name, version, plugin class |
| NFR-30 | Guardrail trigger history SHALL be queryable via API for operational dashboards and debugging |

---

## 5. Dependencies on v0.7.0

### 5.1 Core Types (`@agentlensai/core`)

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `AgentLensEvent`, `EventType`, `EventPayload` | Both | Core data model — guardrails evaluate these, plugins emit these |
| `Session`, `SessionStatus` | Guardrails | Session-level cost aggregation for cost_limit condition |
| `HealthScore`, `HealthDimension` | Guardrails | Health score threshold condition uses existing HealthComputer |
| `AlertRule`, `AlertHistory` | Guardrails | Guardrails extend the existing alerting concept with automated actions |
| `GuardrailRule`, `GuardrailState`, `GuardrailTriggerHistory`, `GuardrailConditionResult` | Guardrails | Already defined in core types — use as-is |
| `LlmCallPayload`, `LlmResponsePayload` | Plugins | Plugins map framework LLM calls to these typed payloads |
| `ToolCallPayload`, `ToolResponsePayload`, `ToolErrorPayload` | Plugins | Plugins map framework tool calls to these typed payloads |
| `CustomPayload` | Plugins | Framework-specific events (chain steps, agent delegation) use custom payloads |

### 5.2 Server Infrastructure

| Dependency | Used By | Notes |
|-----------|---------|-------|
| Hono router + `AuthVariables` middleware | Guardrails | API endpoint registration pattern |
| `getTenantStore()` + `TenantScopedStore` | Guardrails | Tenant isolation for guardrail data |
| `HealthComputer` | Guardrails | Health score threshold condition evaluation |
| `eventBus` | Guardrails | Hook into event ingestion for async guardrail evaluation |
| SQLite + Drizzle ORM | Guardrails | New tables: `guardrail_rules`, `guardrail_state`, `guardrail_trigger_history` |
| `ingestRoutes` / event pipeline | Guardrails | Guardrail engine hooks into post-ingest event bus |

### 5.3 MCP Package

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `AgentLensTransport` | Guardrails | HTTP transport for MCP tool to call server |
| `McpServer.tool()` registration | Guardrails | Tool registration for `agentlens_guardrails` |
| Existing 13 MCP tools | N/A | No changes — backward compatible |

### 5.4 Python SDK

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `agentlensai.init()` | Plugins | Extended with `auto_detect`, `plugins`, `guardrail_enforcement` params |
| Auto-instrumentation (OpenAI, Anthropic patchers) | Plugins | Coexists with framework plugins — no conflicts |
| `AgentLensClient` | Plugins | Base HTTP client for sending events to server |
| LangChain callback handler (v0.4.0) | LangChain Plugin | Enhanced with richer metadata capture |

### 5.5 Dashboard

| Dependency | Used By | Notes |
|-----------|---------|-------|
| React + Tailwind CSS | Guardrails | UI framework for guardrail management pages |
| `useApi` hook | Guardrails | Data fetching pattern |
| Agent list page | Guardrails | Add "paused" badge and unpause button |
| Activity feed | Guardrails | Show guardrail trigger events |
| Layout component | Guardrails | Page layout wrapper |

---

## 6. Risks and Mitigations

### Risk 1: Guardrail False Positives — Agents Unnecessarily Paused

**Risk:** Overly aggressive guardrail conditions (e.g., tight error rate thresholds on small sample sizes) could pause healthy agents during normal variance.

**Likelihood:** High — especially during initial configuration.

**Impact:** High — paused agents cause user-facing downtime.

**Mitigation:**
- `dryRun` mode is the default for new rules — observe before enforcing
- Conservative defaults: 15-minute cooldown, 5-minute evaluation windows
- Guardrail dashboard shows condition history so users can calibrate thresholds before enabling
- "Unpause" is one click — fast recovery
- Documentation includes threshold calibration guide with examples

### Risk 2: Framework API Instability — Plugins Break on Framework Updates

**Risk:** LangChain, CrewAI, AutoGen, and Semantic Kernel all ship breaking changes frequently. A framework update could break a plugin.

**Likelihood:** High — LangChain has had 3 breaking changes in 6 months.

**Impact:** Medium — broken plugin silently degrades to no-op (fail-safe), but users lose observability.

**Mitigation:**
- Pin supported version ranges per plugin (e.g., `langchain>=0.2,<0.4`)
- Abstract framework interaction through an interface layer — minimize direct API surface
- Integration tests run against pinned framework versions in CI
- Fail-safe design: broken plugin = silent no-op, never crashes user code
- Semantic versioning: plugin version tracks supported framework version range

### Risk 3: Guardrail + Event Ingestion Coupling

**Risk:** A bug in the guardrail evaluation engine could crash the event ingestion pipeline, causing data loss.

**Likelihood:** Low — async evaluation by design.

**Impact:** Critical — data loss breaks all of AgentLens.

**Mitigation:**
- Guardrail evaluation runs in a separate async context (post-ingestion event bus listener)
- try/catch at the guardrail engine boundary — any exception logs and is swallowed
- Event ingestion returns 201 BEFORE guardrail evaluation begins
- Circuit breaker on the guardrail engine itself: if 10 consecutive evaluations fail, disable guardrails and alert

### Risk 4: Plugin Maintenance Burden (4 Frameworks × Ongoing Updates)

**Risk:** Maintaining 4 framework plugins is a significant ongoing effort. Each framework release requires compatibility testing and potentially code changes.

**Likelihood:** High — this is a permanent cost.

**Impact:** Medium — stale plugins erode trust.

**Mitigation:**
- Shared `BasePlugin` class minimizes per-plugin code (target: <300 LOC per plugin)
- Automated CI tests against real frameworks detect breakage within 24 hours
- Clear ownership: each plugin has a designated maintainer
- Community contribution path: plugins are open source, accepting PRs
- Deprecation policy: plugins that can't be maintained are deprecated with 90-day notice

### Risk 5: AgentGate Coupling Creates Bidirectional Dependency

**Risk:** The `agentgate_policy` action creates a runtime dependency on AgentGate availability. If AgentGate is down, the guardrail action fails.

**Likelihood:** Medium.

**Impact:** Low — AgentGate action is optional and failure doesn't affect other guardrail actions.

**Mitigation:**
- AgentGate action is explicitly optional — guardrails work fully standalone
- Action failure is logged but does not affect the guardrail trigger record
- Webhook action can serve as a fallback notification channel
- AgentGate health check before action execution — skip with warning if unavailable

### Risk 6: Model Override Conflict with Framework LLM Selection

**Risk:** When a `downgrade_model` guardrail triggers, the model override must propagate through framework plugins. Each framework has a different model selection mechanism.

**Likelihood:** Medium.

**Impact:** Medium — guardrail fires but model doesn't actually change.

**Mitigation:**
- Model override is opt-in (`guardrail_enforcement=True`) — users consciously accept this behavior
- Document which frameworks support model override and at what level
- SDK-level patching (auto-instrumentation layer) can override model before any framework sees it
- Framework-specific override documentation in plugin guides

---

## 7. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Should guardrails support compound conditions (AND/OR logic across multiple metrics)? | Product | **Deferred to v0.9.0** — start with single-condition rules, validate use cases |
| 2 | Should the `pause_agent` action reject new event ingestion or just flag the agent? | Architecture | **Decision: Flag only** — events are always accepted (observability never loses data), but SDK can read the flag to stop operations |
| 3 | Should model override work at the session level or the agent level? | Architecture | **Decision: Agent level** — stored on agent record, applies to all new LLM calls until cleared |
| 4 | Should framework plugins support streaming LLM responses? | Product | **Yes, P1** — LangChain and SK both support streaming; capture first/last token timestamps and aggregate tokens |
| 5 | Should the CrewAI plugin capture inter-agent memory sharing? | Product | **Deferred** — capture task inputs/outputs first; memory sharing is internal to CrewAI and unstable API |
| 6 | Should guardrail rules be exportable/importable (e.g., share a "cost safety" rule pack)? | Product | **Deferred to v0.9.0** — good idea for templates, not MVP |
| 7 | How should `agentlensai[all]` handle optional dependencies that fail to install? | Architecture | **Decision: Best-effort** — install all extras, skip failed ones with pip warning; init() auto-detection handles the rest |
| 8 | Should guardrails fire on historical data backfill or only on new events? | Architecture | **Decision: New events only** — guardrails are real-time protection, not retroactive analysis |

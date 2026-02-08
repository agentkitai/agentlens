# AgentLens v0.8.0 — Epics & Stories

## Phase 3: Proactive Guardrails & Framework Plugins

---

## Epic 1: Guardrail Engine Core

### Story 1.1: Guardrail Types & Schemas
Add guardrail types to `packages/core/src/types.ts` and Zod schemas to `packages/core/src/schemas.ts`.

**Acceptance Criteria:**
- GuardrailRule, GuardrailState, GuardrailTriggerHistory types defined
- GuardrailConditionType and GuardrailActionType union types
- Zod schemas for all guardrail types with validation
- Exported from core/index.ts

**Estimated Tests:** 8

### Story 1.2: Guardrail SQLite Store
Create `packages/server/src/db/guardrail-store.ts` with CRUD operations for guardrail rules, state, and trigger history.

**Acceptance Criteria:**
- GuardrailStore class with all CRUD methods
- Tenant-scoped queries (all operations take tenantId)
- State upsert (create or update cooldown/trigger tracking)
- Trigger history insert and query with pagination
- Migration in `migrate.ts` creates all three tables + indexes

**Estimated Tests:** 18

### Story 1.3: Guardrail Evaluation Engine
Create `packages/server/src/lib/guardrails/engine.ts` — the core evaluation pipeline.

**Acceptance Criteria:**
- GuardrailEngine class subscribes to EventBus
- Evaluates all enabled rules for the event's tenant + agent
- Cooldown check prevents re-triggering
- Condition evaluation for all 4 condition types
- Action execution for all 4 action types
- Dry-run mode logs without executing
- State persistence after each evaluation
- Trigger history recorded on every trigger

**Estimated Tests:** 25

### Story 1.4: Guardrail Condition Evaluators
Create `packages/server/src/lib/guardrails/conditions.ts` with pluggable evaluators.

**Acceptance Criteria:**
- error_rate_threshold: queries recent events, computes error rate
- cost_limit: queries session costs or daily agent costs
- health_score_threshold: uses HealthComputer to check score
- custom_metric: evaluates arbitrary numeric conditions
- Each evaluator returns { triggered: boolean, currentValue: number }

**Estimated Tests:** 16

### Story 1.5: Guardrail Action Executors
Create `packages/server/src/lib/guardrails/actions.ts` with pluggable action executors.

**Acceptance Criteria:**
- pause_agent: emits 'guardrail_triggered' event type to EventBus
- notify_webhook: sends HTTP POST with rule/trigger details
- downgrade_model: emits 'custom' event with model recommendation
- agentgate_policy: calls AgentGate REST API (configurable URL)
- All actions are fail-safe (catch errors, log, never crash)

**Estimated Tests:** 12

---

## Epic 2: Guardrail REST API

### Story 2.1: Guardrail CRUD Routes
Create `packages/server/src/routes/guardrails.ts` with REST endpoints.

**Acceptance Criteria:**
- POST /api/guardrails — create rule (validates with Zod schema)
- GET /api/guardrails — list rules for tenant
- GET /api/guardrails/:id — get single rule
- PUT /api/guardrails/:id — update rule
- DELETE /api/guardrails/:id — delete rule
- All routes are tenant-scoped via auth middleware
- Proper error handling (400, 404, 500)

**Estimated Tests:** 18

### Story 2.2: Guardrail Status & History Routes
Add status and history endpoints.

**Acceptance Criteria:**
- GET /api/guardrails/:id/status — returns rule + current state + recent triggers
- GET /api/guardrails/history — list trigger history with filters (ruleId, agentId, limit)
- Pagination support for history

**Estimated Tests:** 8

### Story 2.3: Wire Guardrails into Server
Register guardrail routes and engine in server startup.

**Acceptance Criteria:**
- Routes registered with auth middleware in createApp()
- GuardrailEngine created and started in startServer()
- Engine subscribes to EventBus for async evaluation
- Exported from server/index.ts

**Estimated Tests:** 4

---

## Epic 3: Guardrail MCP Tool

### Story 3.1: agentlens_guardrails MCP Tool
Create `packages/mcp/src/tools/guardrails.ts`.

**Acceptance Criteria:**
- Tool name: agentlens_guardrails
- Inputs: { agentId?: string }
- Returns: active guardrail rules, their current status, recent triggers
- Formatted as human-readable text
- Registered in MCP server tool list

**Estimated Tests:** 6

---

## Epic 4: Framework Plugin Base

### Story 4.1: Base Plugin Class
Create `packages/python-sdk/src/agentlensai/integrations/base.py`.

**Acceptance Criteria:**
- BaseFrameworkPlugin class with shared logic
- _get_client_and_config() from constructor or global state
- _send_event() fail-safe event sender
- _send_session_start() / _send_session_end() helpers
- _now() timestamp helper
- All methods wrapped in try/except

**Estimated Tests:** 6

---

## Epic 5: Framework Plugins

### Story 5.1: Enhanced LangChain Plugin
Extend existing `integrations/langchain.py` with chain/agent lifecycle callbacks.

**Acceptance Criteria:**
- on_chain_start / on_chain_end / on_chain_error
- on_agent_action / on_agent_finish
- on_retriever_start / on_retriever_end
- All events include source='langchain' metadata
- Backward compatible (existing LLM/tool callbacks unchanged)

**Estimated Tests:** 10

### Story 5.2: CrewAI Plugin
Create `packages/python-sdk/src/agentlensai/integrations/crewai.py`.

**Acceptance Criteria:**
- AgentLensCrewAIHandler class extending BaseFrameworkPlugin
- Captures task start/end, agent actions, crew lifecycle
- Maps to AgentLens events with source='crewai'
- instrument_crewai() / uninstrument_crewai() functions
- Fail-safe: all callbacks wrapped in try/except

**Estimated Tests:** 8

### Story 5.3: AutoGen Plugin
Create `packages/python-sdk/src/agentlensai/integrations/autogen.py`.

**Acceptance Criteria:**
- AgentLensAutoGenHandler class extending BaseFrameworkPlugin
- Captures conversation messages, agent interactions, tool calls
- Maps to AgentLens events with source='autogen'
- instrument_autogen() / uninstrument_autogen() functions
- Fail-safe: all callbacks wrapped in try/except

**Estimated Tests:** 8

### Story 5.4: Semantic Kernel Plugin
Create `packages/python-sdk/src/agentlensai/integrations/semantic_kernel.py`.

**Acceptance Criteria:**
- AgentLensSKHandler class extending BaseFrameworkPlugin
- Captures function invocations, planner steps
- Maps to AgentLens events with source='semantic_kernel'
- instrument_semantic_kernel() / uninstrument_semantic_kernel() functions
- Fail-safe: all callbacks wrapped in try/except

**Estimated Tests:** 8

### Story 5.5: Auto-Detection in init()
Update `_init.py` to auto-detect and instrument installed frameworks.

**Acceptance Criteria:**
- Detects crewai, autogen, semantic_kernel via importlib.util.find_spec
- Instruments each detected framework (fail-safe)
- Uninstruments on shutdown()
- Existing OpenAI/Anthropic detection unchanged

**Estimated Tests:** 6

---

## Epic 6: Dashboard Guardrails Page

### Story 6.1: Guardrails Dashboard Page
Create `packages/dashboard/src/pages/Guardrails.tsx`.

**Acceptance Criteria:**
- Lists all guardrail rules with status indicators
- Create/Edit form for rules (condition type, action type, cooldown, dry-run)
- Enable/disable toggle
- Delete with confirmation
- Trigger history table with recent triggers
- Route: /guardrails in App.tsx

**Estimated Tests:** 0 (UI only, no unit tests for dashboard pages — consistent with existing pattern)

---

## Summary

| Epic | Stories | Estimated Tests |
|------|---------|----------------|
| Epic 1: Guardrail Engine Core | 5 | 79 |
| Epic 2: Guardrail REST API | 3 | 30 |
| Epic 3: Guardrail MCP Tool | 1 | 6 |
| Epic 4: Framework Plugin Base | 1 | 6 |
| Epic 5: Framework Plugins | 5 | 40 |
| Epic 6: Dashboard | 1 | 0 |
| **Total** | **16** | **~161** |

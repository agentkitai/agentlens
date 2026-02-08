# AgentLens v0.8.0 — Epics & Stories

## Proactive Guardrails & Framework Plugins

**Date:** 2026-02-08
**Version:** 1.0

---

## Overview

7 epics, 28 stories. Organized by feature layer (bottom-up: review → types → server → MCP → SDK → dashboard → docs).

**Implementation status:** Winston (Architect) implemented significant portions during architecture. 10 stories are marked ✅ DONE (require code review only). 18 stories are new work.

### Epic Map

| # | Epic | Feature | Stories | Done | Remaining | Est. Tests |
|---|------|---------|---------|------|-----------|------------|
| E0 | Code Review of Existing Implementation | Both | 2 | 0 | 2 | 0 (review) |
| E1 | Core Types & Config Extensions | Both | 2 | 1 | 1 | 10 |
| E2 | Guardrail Engine & Server | Guardrails | 3 | 3 (review) | 0 | ~55 (existing) |
| E3 | Framework Plugins (Python) | Plugins | 5 | 0 | 5 | 42 |
| E4 | SDK & CLI Integration | Both | 4 | 0 | 4 | 28 |
| E5 | Guardrail Dashboard | Guardrails | 5 | 0 | 5 | 30 |
| E6 | MCP Tool & Documentation | Both | 3 | 1 (review) | 2 | 14 |
| **Total** | | | **24** | **5** | **19** | **~179** |

> Note: 4 additional "review" stories (E0 + E2 reviews) validate existing code but don't produce new tests.

### Dependency Graph

```
E0 (Code Review) ─── GATE ───┐
                              │
E1 (Types & Config)           │
├──→ E2 (Guardrail Engine) ◄──┘ (review only — already built)
│    ├──→ E4.1 (SDK guardrail methods)
│    ├──→ E5 (Dashboard)
│    └──→ E6.1 (MCP tool — review)
├──→ E3 (Framework Plugins)
│    ├──→ E4.2 (Python auto-detect)
│    ├──→ E4.3 (Model override)
│    └──→ E4.4 (CLI commands)
└──→ E6.2-6.3 (Documentation)
```

---

## Epic 0: Code Review of Existing Implementation

> Winston implemented guardrail types, schemas, store, engine, conditions, actions, routes, and MCP tools during the architecture phase. This epic validates that code through structured review before building on top of it.

---

### Story 0.1 — Review: Guardrail Core Types, Schemas, Store & DB Migration

**As the** development team,
**We need** a thorough code review of the guardrail types, Zod schemas, GuardrailStore CRUD, and database migration that Winston implemented,
**So that** we have confidence in the foundation before building dashboard and SDK layers on top.

**Scope of Review:**

- [ ] `packages/core/src/types.ts` — GuardrailRule, GuardrailCondition, GuardrailAction, GuardrailState types
- [ ] `packages/core/src/schemas.ts` — Zod validation schemas (CreateGuardrailRuleSchema, UpdateGuardrailRuleSchema)
- [ ] `packages/core/src/__tests__/guardrail-types.test.ts` — Type tests
- [ ] `packages/server/src/db/guardrail-store.ts` — Full CRUD store
- [ ] `packages/server/src/db/__tests__/guardrail-store.test.ts` — Store tests
- [ ] `packages/server/src/db/migrate.ts` — DB tables for guardrails

**Review Checklist:**

- [ ] Types match PRD FR-G1.1 through FR-G1.7 (all rule fields present)
- [ ] Zod schemas validate conditionConfig/actionConfig per-type (FR-G1.2, FR-G1.3)
- [ ] GuardrailStore enforces tenant isolation (FR-G4.2)
- [ ] Store supports all required operations: create, list, get, update, delete, enable/disable, state upsert, trigger history insert/query
- [ ] Migration creates tables idempotently (NFR-23)
- [ ] Existing tables unaffected (NFR-22)
- [ ] All existing tests pass
- [ ] Code follows project patterns (Hono middleware, Drizzle ORM conventions)
- [ ] No security issues (SQL injection, tenant leakage)

**Acceptance Criteria:**

- [ ] Review documented with findings (pass / issues found)
- [ ] Any issues filed and resolved
- [ ] All existing tests still pass after any fixes

**Dependencies:** None
**Est. Tests:** 0 (review only — existing tests validated)

---

### Story 0.2 — Review: Guardrail Engine, Conditions, Actions, Routes & Tests

**As the** development team,
**We need** a thorough code review of the GuardrailEngine, 4 condition evaluators, 4 action handlers, REST routes, and all associated tests,
**So that** the runtime evaluation pipeline is correct before we wire it to the dashboard and SDK.

**Scope of Review:**

- [ ] `packages/server/src/lib/guardrails/engine.ts` — GuardrailEngine with EventBus subscription
- [ ] `packages/server/src/lib/guardrails/conditions.ts` — 4 condition evaluators
- [ ] `packages/server/src/lib/guardrails/actions.ts` — 4 action handlers
- [ ] `packages/server/src/lib/guardrails/__tests__/engine.test.ts`
- [ ] `packages/server/src/lib/guardrails/__tests__/conditions.test.ts`
- [ ] `packages/server/src/lib/guardrails/__tests__/actions.test.ts`
- [ ] `packages/server/src/routes/guardrails.ts` — REST endpoints
- [ ] `packages/server/src/__tests__/guardrails.test.ts` — REST route tests

**Review Checklist:**

- [ ] Engine subscribes to EventBus and evaluates asynchronously (FR-G2.1, NFR-2)
- [ ] Circuit breaker: disables after 10 consecutive failures
- [ ] Cooldown check runs before condition evaluation (FR-G2.6)
- [ ] ErrorRateEvaluator: sliding window, correct rate calculation (FR-G2.2)
- [ ] CostLimitEvaluator: session vs daily scope (FR-G2.3)
- [ ] HealthScoreEvaluator: uses HealthComputer, handles no-data (FR-G2.4)
- [ ] CustomMetricEvaluator: key path extraction, all operators (FR-G2.5)
- [ ] PauseAgentHandler: sets paused_at, emits custom event (FR-G3.1)
- [ ] WebhookHandler: retry with exponential backoff (FR-G3.4)
- [ ] ModelDowngradeHandler: sets model_override (FR-G3.5)
- [ ] AgentGatePolicyHandler: optional, fail-safe (FR-G3.6, FR-G3.7)
- [ ] Dry-run mode: logs but doesn't execute actions (FR-G1.5, FR-G3.9)
- [ ] Trigger history recording (FR-G3.8)
- [ ] All REST endpoints match PRD FR-G5.1 through FR-G5.11
- [ ] Tenant isolation on all endpoints (NFR-12)
- [ ] Auth required on all endpoints (NFR-11)
- [ ] No blocking of event ingestion pipeline (NFR-2)
- [ ] All existing tests pass
- [ ] Test coverage adequate (≥ 90% for new server code per NFR-16)

**Acceptance Criteria:**

- [ ] Review documented with findings (pass / issues found)
- [ ] Any issues filed and resolved
- [ ] All existing tests still pass after any fixes
- [ ] Confirm engine integrates correctly at server startup (§13.2 of architecture)

**Dependencies:** Story 0.1
**Est. Tests:** 0 (review only — existing tests validated)

---

## Epic 1: Core Types & Config Extensions

> Extend core types with condition/action config interfaces and add agent model override columns. Foundation for dashboard forms and SDK integration.

---

### Story 1.1 — Guardrail Condition & Action Config Types ✅ REVIEW-ONLY

**Status:** Types are partially in place (GuardrailRule has conditionConfig as `Record<string,unknown>`). The architecture specifies typed config interfaces (§2.2, §2.3). Verify if these already exist or need to be added.

**As a** developer building the guardrail dashboard form,
**I want** typed interfaces and Zod schemas for each condition and action config (ErrorRateConditionConfig, CostLimitConditionConfig, etc.),
**So that** the form can render type-specific fields and validate inputs client-side.

**Acceptance Criteria:**

- [ ] `ErrorRateConditionConfig` interface + Zod schema: `threshold` (0-100), `windowMinutes` (1-1440, default 5)
- [ ] `CostLimitConditionConfig` interface + Zod schema: `maxCostUsd` (positive), `scope` ('session' | 'daily')
- [ ] `HealthScoreConditionConfig` interface + Zod schema: `minScore` (0-100), `windowDays` (1-90, default 7)
- [ ] `CustomMetricConditionConfig` interface + Zod schema: `metricKeyPath`, `operator`, `value`, `windowMinutes`
- [ ] `PauseAgentActionConfig` interface + Zod schema: optional `message`
- [ ] `WebhookActionConfig` interface + Zod schema: `url`, optional `headers`, optional `secret`
- [ ] `DowngradeModelActionConfig` interface + Zod schema: `targetModel`, optional `message`
- [ ] `AgentGatePolicyActionConfig` interface + Zod schema: `agentgateUrl`, `policyId`, `action`, optional `params`
- [ ] All exported from `@agentlensai/core` barrel
- [ ] Package builds without errors

**Dependencies:** Story 0.1 (review confirms base types are solid)
**Est. Tests:** 6 (schema validation per config type: valid input passes, invalid input rejected)

---

### Story 1.2 — Agent Model Override & Pause Columns Migration

**As a** developer implementing the pause_agent and downgrade_model actions,
**I want** `model_override`, `paused_at`, and `pause_reason` columns on the `agents` table,
**So that** the engine can persist pause/override state and the dashboard/SDK can read it.

**Acceptance Criteria:**

- [ ] Migration adds `model_override TEXT`, `paused_at TEXT`, `pause_reason TEXT` to `agents` table
- [ ] Migration is idempotent (safe to run on databases that already have or don't have these columns)
- [ ] New index: `idx_agents_paused ON agents(tenant_id, paused_at) WHERE paused_at IS NOT NULL`
- [ ] Agent type in `types.ts` extended with optional `modelOverride`, `pausedAt`, `pauseReason` fields
- [ ] Existing agent queries continue to work (backward compatible)
- [ ] `PUT /api/agents/:id/unpause` endpoint clears `paused_at`, `pause_reason`, optionally `model_override`

**Dependencies:** Story 0.1
**Est. Tests:** 4 (migration up, idempotent run, agent query with new fields, unpause endpoint)

---

## Epic 2: Guardrail Engine & Server ✅ IMPLEMENTED (Review Required)

> The guardrail engine, conditions, actions, and REST routes are already implemented by Winston. These stories document what exists and are marked DONE pending review (Epic 0).

---

### Story 2.1 — GuardrailEngine: EventBus Subscription & Evaluation Pipeline ✅ DONE

**Status:** Implemented in `packages/server/src/lib/guardrails/engine.ts`. Tests passing.

**Covers PRD:** FR-G2.1, FR-G2.6, FR-G2.7, FR-G1.4, FR-G1.5, FR-G3.8, FR-G3.9, FR-G4.1

**What exists:**
- Engine subscribes to EventBus `event_ingested` events
- Loads enabled rules per tenant/agent
- Checks cooldown before evaluation
- Evaluates condition → dispatches action (or logs dry-run)
- Records trigger history
- Circuit breaker after 10 consecutive failures

**Dependencies:** Review via Story 0.2
**Existing Tests:** ~15 (engine.test.ts)

---

### Story 2.2 — Condition Evaluators (4 types) ✅ DONE

**Status:** Implemented in `packages/server/src/lib/guardrails/conditions.ts`. Tests passing.

**Covers PRD:** FR-G2.2, FR-G2.3, FR-G2.4, FR-G2.5

**What exists:**
- ErrorRateEvaluator: sliding window error rate calculation
- CostLimitEvaluator: session and daily cost aggregation
- HealthScoreEvaluator: uses HealthComputer with caching
- CustomMetricEvaluator: key path extraction with all operators

**Dependencies:** Review via Story 0.2
**Existing Tests:** ~18 (conditions.test.ts)

---

### Story 2.3 — Action Handlers (4 types) + REST Routes ✅ DONE

**Status:** Implemented in `packages/server/src/lib/guardrails/actions.ts` and `packages/server/src/routes/guardrails.ts`. Tests passing.

**Covers PRD:** FR-G3.1–FR-G3.9, FR-G5.1–FR-G5.11

**What exists:**
- PauseAgentHandler: sets paused_at, emits guardrail_triggered event
- WebhookHandler: HTTP POST with retry + exponential backoff
- ModelDowngradeHandler: sets model_override on agent
- AgentGatePolicyHandler: optional external API call
- 11 REST endpoints (CRUD + enable/disable/reset/history/unpause)
- All endpoints authenticated with tenant isolation

**Dependencies:** Review via Story 0.2
**Existing Tests:** ~22 (actions.test.ts + guardrails.test.ts)

---

## Epic 3: Framework Plugins (Python)

> Python SDK plugins for LangChain (enhanced), CrewAI, AutoGen, and Semantic Kernel. Each hooks into framework lifecycle callbacks and emits standardized AgentLens events.

---

### Story 3.1 — Enhanced LangChain Plugin: Chain, Agent & Retriever Callbacks

**As** Maya (agent developer),
**I want** the LangChain callback handler to capture chain lifecycle, agent actions, and retriever events (not just LLM and tool calls),
**So that** I can see which chain step failed and how agents reasoned in the AgentLens dashboard.

**Acceptance Criteria:**

- [ ] `on_chain_start`, `on_chain_end`, `on_chain_error` callbacks emit custom events with chain_type, chain_name, run_id, duration_ms (FR-F2.2)
- [ ] `on_agent_action`, `on_agent_finish` callbacks emit custom events with tool, tool_input, output, reasoning (FR-F2.6)
- [ ] `on_retriever_start`, `on_retriever_end` callbacks emit custom events with query, document_count, sources (FR-F2.5)
- [ ] LangGraph detection: `is_graph_node` flag set when chain is a LangGraph node (FR-F2.7)
- [ ] `agentId` auto-set from chain name or graph name (FR-F1.8)
- [ ] Framework metadata: `metadata.framework = "langchain"`, `metadata.framework_component` per callback type (FR-F1.7)
- [ ] All callback methods are fail-safe: exceptions logged, never propagated to LangChain (FR-F1.2, NFR-7)
- [ ] Handler works as `config={"callbacks": [handler]}` or via global `init()` (FR-F2.8)
- [ ] Supports LangChain v0.2+ and v0.3+ (FR-F2.9)
- [ ] Backward compatible: existing on_llm_start/end and on_tool_start/end unchanged

**Dependencies:** Story 0.1 (base.py review), existing LangChain handler
**Est. Tests:** 10 (chain start/end/error, agent action/finish, retriever start/end, fail-safety ×2, backward compatibility)

---

### Story 3.2 — CrewAI Plugin: Review & Complete

**As** Dani (CrewAI developer),
**I want** a CrewAI plugin that captures crew/agent/task lifecycle and delegation events,
**So that** I can see the full crew hierarchy and task delegation in AgentLens.

**Status:** Partially implemented. File exists at `packages/python-sdk/src/agentlensai/integrations/crewai.py`. Needs review and completion.

**Acceptance Criteria:**

- [ ] Review existing implementation against architecture §5.5 and PRD FR-F3.1–FR-F3.8
- [ ] Crew kickoff → `session_started` with crew name in tags (FR-F3.1)
- [ ] Crew completion → `session_ended` with summary (FR-F3.1)
- [ ] Agent start/end → custom events with role, goal, backstory (FR-F3.2)
- [ ] Task start/end → custom events with description, expected_output, assigned_agent, actual output (FR-F3.3)
- [ ] Task delegation → custom event with delegator, delegatee, reason (FR-F3.4)
- [ ] Tool usage within agents → `tool_call`/`tool_response` with calling agent in metadata (FR-F3.5)
- [ ] `agentId` set to `{crew_name}/{agent_role}` (FR-F3.6)
- [ ] Activatable via `Crew(agentlens=True)` or global `init()` (FR-F3.7)
- [ ] Supports CrewAI v0.28+ (FR-F3.8)
- [ ] All methods fail-safe (NFR-7)

**Dependencies:** Story 0.1 (base.py review)
**Est. Tests:** 10 (crew start/end, agent start/end, task start/end, delegation, tool capture, fail-safety ×2, agentId format)

---

### Story 3.3 — AutoGen Plugin: Review & Complete

**As** a developer using AutoGen for multi-agent conversations,
**I want** an AutoGen plugin that captures conversation lifecycle, message exchanges, and tool calls,
**So that** I can trace agent-to-agent communication in AgentLens.

**Status:** Partially implemented. File exists at `packages/python-sdk/src/agentlensai/integrations/autogen.py`. Needs review and completion.

**Acceptance Criteria:**

- [ ] Review existing implementation against architecture §5.6 and PRD FR-F4.1–FR-F4.8
- [ ] initiate_chat → `session_started` (FR-F4.1)
- [ ] Agent message exchanges → custom events with sender, receiver, content_preview, message_type (FR-F4.2)
- [ ] LLM calls by agents → `llm_call`/`llm_response` with calling agent in metadata (FR-F4.3)
- [ ] Code execution events → custom events with code content, result, exit_code (FR-F4.4, P1)
- [ ] Function/tool calls → `tool_call`/`tool_response` (FR-F4.5)
- [ ] `agentId` set from AutoGen agent names (FR-F4.6)
- [ ] Supports both AutoGen v0.2 (pyautogen) and v0.4+ (autogen-agentchat) (FR-F4.7)
- [ ] Activatable via `init()` auto-detection or explicit import (FR-F4.8)
- [ ] All methods fail-safe (NFR-7)

**Dependencies:** Story 0.1 (base.py review)
**Est. Tests:** 8 (conversation start, message capture, LLM capture, tool capture, fail-safety ×2, v0.2 compat, agentId)

---

### Story 3.4 — Semantic Kernel Plugin: Implement & Test

**As** a developer using Semantic Kernel,
**I want** an SK plugin that captures function invocations and AI service calls via SK's filter interface,
**So that** I get observability for kernel operations in AgentLens.

**Status:** File exists at `packages/python-sdk/src/agentlensai/integrations/semantic_kernel.py`. Needs review, completion, and testing.

**Acceptance Criteria:**

- [ ] Review existing implementation against architecture §5.7 and PRD FR-F5.1–FR-F5.9
- [ ] Implements `FunctionInvocationFilter` interface (FR-F5.1)
- [ ] Function invocations → `tool_call`/`tool_response`/`tool_error` with function_name, plugin_name, parameters (FR-F5.2)
- [ ] Planner operations → custom events with plan steps, goal, result (FR-F5.3, P1)
- [ ] Prompt rendering → custom events with template_name, variables (FR-F5.4, P1)
- [ ] AI service calls → `llm_call`/`llm_response` with service_id (FR-F5.5)
- [ ] Memory operations → custom events (FR-F5.6, P1)
- [ ] `agentId` from kernel name or configured ID (FR-F5.7)
- [ ] Supports SK for Python v1.0+ (FR-F5.8)
- [ ] Activatable via `kernel.add_filter()` or global `init()` (FR-F5.9)
- [ ] All methods fail-safe (NFR-7)

**Dependencies:** Story 0.1 (base.py review)
**Est. Tests:** 8 (function invocation success/error, LLM capture, fail-safety ×2, agentId, filter registration, init() integration)

---

### Story 3.5 — Plugin Integration Tests Against Real Frameworks

**As the** development team,
**We need** integration tests for each framework plugin running against pinned real framework versions,
**So that** we can verify plugins work end-to-end and detect when framework updates break them.

**Acceptance Criteria:**

- [ ] LangChain integration test: run a RetrievalQA chain with handler, verify chain/LLM/tool events emitted (NFR-18)
- [ ] CrewAI integration test: run a simple 2-agent crew, verify crew/agent/task events (NFR-18)
- [ ] AutoGen integration test: run a 2-agent conversation, verify message/LLM events (NFR-18)
- [ ] Semantic Kernel integration test: run a kernel with function, verify tool_call events (NFR-18)
- [ ] Each test verifies fail-safety: plugin with BrokenClient doesn't crash framework (NFR-20)
- [ ] Tests pin framework versions: langchain-core>=0.2, crewai>=0.28, autogen-agentchat>=0.4, semantic-kernel>=1.0
- [ ] Tests run in CI with optional framework installs (skip if framework not available)

**Dependencies:** Stories 3.1–3.4
**Est. Tests:** 6 (one integration + one fail-safety per framework with 4 frameworks = 8, but some combined = 6)

---

## Epic 4: SDK & CLI Integration

> Extend the Python SDK init(), add guardrail SDK methods, model override support, and CLI commands.

---

### Story 4.1 — Python SDK: Guardrail Methods

**As** Maya (agent developer),
**I want** Python SDK methods to list, check status, and manage guardrails programmatically,
**So that** I can integrate guardrail management into my deployment scripts.

**Acceptance Criteria:**

- [ ] `agentlensai.guardrails.list()` → list all guardrail rules
- [ ] `agentlensai.guardrails.get(rule_id)` → get rule detail + state
- [ ] `agentlensai.guardrails.create(...)` → create a new rule
- [ ] `agentlensai.guardrails.update(rule_id, ...)` → update rule config
- [ ] `agentlensai.guardrails.delete(rule_id)` → delete a rule
- [ ] `agentlensai.guardrails.enable(rule_id)` / `.disable(rule_id)` → toggle
- [ ] `agentlensai.guardrails.history(rule_id)` → trigger history
- [ ] `agentlensai.guardrails.reset(rule_id)` → reset state
- [ ] All methods use the existing `AgentLensClient` HTTP transport
- [ ] Methods are fail-safe: log errors, never crash user code

**Dependencies:** Story 0.2 (REST routes reviewed)
**Est. Tests:** 8 (one per method)

---

### Story 4.2 — Python SDK: Framework Auto-Detection in init()

**As** Maya (agent developer),
**I want** `agentlensai.init()` to auto-detect installed frameworks and activate plugins,
**So that** I don't need to manually import and configure each plugin.

**Acceptance Criteria:**

- [ ] `agentlensai.init(auto_detect=True)` detects installed frameworks by checking `importlib.util.find_spec()` (FR-F6.1)
- [ ] Detection is non-blocking: failed imports skipped silently (FR-F6.2)
- [ ] Detected frameworks logged at INFO level with versions (FR-F6.3)
- [ ] Manual plugin selection: `agentlensai.init(auto_detect=False, plugins=["langchain"])` (FR-F6.4)
- [ ] Detection runs once at init() time (FR-F6.5)
- [ ] `agentlensai.init()` without plugin args behaves identically to v0.7.0 (NFR-25)
- [ ] init() completes in < 500ms with auto-detection (NFR-5)
- [ ] Implementation follows architecture §5.8 (`_detection.py` module)

**Dependencies:** Stories 3.1–3.4 (plugins to detect)
**Est. Tests:** 6 (auto-detect with frameworks, auto-detect without, manual selection, backward compat, timing, unknown plugin)

---

### Story 4.3 — Python SDK: Model Override Support

**As** Raj (platform lead),
**I want** the SDK to respect model overrides set by guardrail actions,
**So that** when a guardrail triggers a model downgrade, my agents automatically use the cheaper model.

**Acceptance Criteria:**

- [ ] `agentlensai.init(guardrail_enforcement=True)` enables model override (FR-F7.4)
- [ ] SDK checks agent's `modelOverride` metadata on each LLM call (FR-F7.1)
- [ ] When override is set, SDK substitutes model parameter before forwarding to provider (FR-F7.2)
- [ ] Override check is cached (30s TTL) to avoid per-call HTTP requests
- [ ] Model override events logged: "Model downgraded from X to Y (rule: Z)" (FR-F7.3)
- [ ] `guardrail_enforcement=False` (default) → no override behavior
- [ ] Implementation follows architecture §5.9 (`_override.py` module)

**Dependencies:** Story 1.2 (agent model_override column), Story 0.2 (routes reviewed)
**Est. Tests:** 6 (override active, override not set, caching, opt-in/opt-out, logging, error handling)

---

### Story 4.4 — CLI Commands for Guardrails

**As** Maya (agent developer),
**I want** CLI commands to manage guardrails from the terminal,
**So that** I can create, list, and manage guardrails without using the dashboard.

**Acceptance Criteria:**

- [ ] `agentlens guardrails list` — list all rules with status summary
- [ ] `agentlens guardrails get <id>` — show rule detail + current state
- [ ] `agentlens guardrails create --name "..." --condition-type cost_limit --action-type pause_agent ...` — create a rule
- [ ] `agentlens guardrails enable <id>` / `disable <id>` — toggle rules
- [ ] `agentlens guardrails history <id>` — show trigger history
- [ ] `agentlens guardrails delete <id>` — delete a rule with confirmation
- [ ] Output formatted as tables (list) or structured detail (get)
- [ ] Commands use the existing CLI transport/auth pattern

**Dependencies:** Story 0.2 (REST routes reviewed)
**Est. Tests:** 8 (one per command + error handling)

---

## Epic 5: Guardrail Dashboard

> React pages for guardrail management: list, detail, create/edit form, and agent list enhancements.

---

### Story 5.1 — Guardrail List Page

**As** Raj (platform lead),
**I want** a `/guardrails` page showing all guardrail rules with status, condition, action, and trigger info,
**So that** I can see all my guardrails at a glance and manage them.

**Acceptance Criteria:**

- [ ] New page at route `/guardrails` (FR-G7.1)
- [ ] Route registered in `App.tsx`, nav item "🛡️ Guardrails" added to `Layout.tsx` sidebar
- [ ] Summary banner: Active Rules count (green), Triggered Today (yellow), Agents Paused (red)
- [ ] Filter bar: Status (All/Enabled/Disabled), Condition Type, Agent dropdown
- [ ] Table columns: Name, Condition summary (e.g., "Cost > $10/session"), Action type badge, Status (enabled/disabled + dry-run), Last Triggered (relative), Trigger Count, Actions
- [ ] Actions per row: View, Enable/Disable toggle, Edit (→ /guardrails/:id/edit), Delete (with confirmation)
- [ ] "Create Guardrail" button → `/guardrails/new`
- [ ] Row click → `/guardrails/:id`
- [ ] Loading, error, and empty states
- [ ] API client functions added to `client.ts` (getGuardrails, deleteGuardrail, enableGuardrail, disableGuardrail)
- [ ] Guardrail list loads in < 1 second for 100 rules (NFR-6)

**Dependencies:** Story 0.2 (REST routes), Story 1.1 (config types for display)
**Est. Tests:** 6 (renders list, filter by status, filter by type, actions work, empty state, loading state)

---

### Story 5.2 — Guardrail Detail Page

**As** Raj (platform lead),
**I want** a `/guardrails/:id` page showing full rule config, current state, and trigger history timeline,
**So that** I can investigate a guardrail's behavior and see when/why it triggered.

**Acceptance Criteria:**

- [ ] New page at route `/guardrails/:id` (FR-G7.2)
- [ ] Header: rule name, status badges (enabled/disabled, dry-run), action buttons (Edit, Enable/Disable, Reset State, Delete)
- [ ] Configuration card: description, condition type + config values (human-readable), action type + config values, scope (agent or global), cooldown
- [ ] Current state card: last triggered (absolute + relative), trigger count, current metric value vs threshold (progress bar), last evaluated, cooldown remaining
- [ ] Trigger history timeline: chronological list (newest first), each entry shows timestamp, metric value, threshold, action status (executed/dry-run/failed), linked session
- [ ] 404 page for invalid rule ID
- [ ] API client functions: getGuardrail, resetGuardrailState, getGuardrailHistory

**Dependencies:** Story 5.1
**Est. Tests:** 6 (renders detail, state card, trigger history, action buttons, 404, pagination)

---

### Story 5.3 — Guardrail Create/Edit Form

**As** Maya (agent developer),
**I want** a form to create and edit guardrail rules with dynamic fields based on condition/action type,
**So that** I can configure guardrails through the dashboard without memorizing API schemas.

**Acceptance Criteria:**

- [ ] Create form at `/guardrails/new`, edit form at `/guardrails/:id/edit` (FR-G7.3)
- [ ] Fields: Name (required), Description, Condition Type (dropdown: 4 types), dynamic Condition Config fields, Action Type (dropdown: 4 types), dynamic Action Config fields, Agent scope (optional dropdown), Cooldown (minutes, default 15), Dry-run toggle (default ON for new), Enabled toggle (default ON)
- [ ] Dynamic fields per condition type:
  - error_rate_threshold: threshold %, window minutes
  - cost_limit: max cost USD, scope radio (session/daily)
  - health_score_threshold: min score, window days
  - custom_metric: key path, operator select, value, window minutes
- [ ] Dynamic fields per action type:
  - pause_agent: optional message
  - notify_webhook: URL, optional headers editor, optional secret
  - downgrade_model: target model, optional message
  - agentgate_policy: AgentGate URL, policy ID, action, optional params
- [ ] Preview card: human-readable rule summary ("When [condition] for [agent], [action]")
- [ ] Client-side validation before submit
- [ ] On create success → navigate to `/guardrails/:id`
- [ ] On edit → pre-fill existing values
- [ ] API client: createGuardrail, updateGuardrail

**Dependencies:** Story 1.1 (config types for validation), Story 5.1 (navigation)
**Est. Tests:** 8 (create happy path, edit pre-fill, all 4 condition type forms, all 4 action type forms — grouped, validation, preview)

---

### Story 5.4 — Agent List: Paused Badge & Unpause Button

**As** Raj (platform lead),
**I want** the agent list page to show which agents are paused by guardrails with a one-click unpause button,
**So that** I can quickly identify and recover paused agents.

**Acceptance Criteria:**

- [ ] Agent list shows orange "⏸ Paused by guardrail" badge when `pausedAt` is set (FR-G7.4)
- [ ] Badge tooltip shows: rule name + pause reason
- [ ] "Resume" button visible on paused agents (FR-G7.5)
- [ ] Resume button calls `PUT /api/agents/:id/unpause` with option to clear model override
- [ ] Confirmation dialog: "Unpause agent X? This will also clear model override: gpt-4o-mini → (none)"
- [ ] Agent list refreshes after unpause
- [ ] API client: unpauseAgent

**Dependencies:** Story 1.2 (pause columns), Story 0.2 (unpause endpoint)
**Est. Tests:** 5 (badge visible when paused, badge hidden when not, unpause works, confirmation dialog, list refreshes)

---

### Story 5.5 — Guardrail Events in Activity Feed

**As** Raj (platform lead),
**I want** guardrail trigger events to appear in the existing activity feed,
**So that** I can see guardrail activity alongside other agent events.

**Acceptance Criteria:**

- [ ] Guardrail trigger events (custom events with type `guardrail_triggered`) shown in activity feed (FR-G7.6)
- [ ] Feed entry displays: "🛡️ Guardrail triggered: {rule_name}" with condition details
- [ ] Clicking entry links to guardrail detail page
- [ ] Events show with appropriate severity (warn for dry-run, error for enforced pause)
- [ ] No changes to event ingestion — uses existing custom event type

**Dependencies:** Story 5.2 (guardrail detail page to link to)
**Est. Tests:** 5 (event appears in feed, correct formatting, click-through link, severity coloring, dry-run vs enforced)

---

## Epic 6: MCP Tool & Documentation

> MCP tool review, SDK documentation, and guardrail/plugin user guides.

---

### Story 6.1 — Review: Guardrail MCP Tool & Transport ✅ REVIEW-ONLY

**Status:** Implemented in `packages/mcp/src/tools/guardrails.ts` and `packages/mcp/src/transport.ts`. Needs review.

**As** Agent-X (self-monitoring AI agent),
**I want** the `agentlens_guardrails` MCP tool to correctly list, check status, view history, and manage guardrails,
**So that** I can monitor my own guardrail state and understand when I've been rate-limited.

**Review Checklist:**

- [ ] Tool registered as `agentlens_guardrails` (FR-G6.1)
- [ ] `list` action returns all rules with enabled/disabled status and trigger counts (FR-G6.2)
- [ ] `status` action returns evaluation state: last triggered, cooldown remaining, current value (FR-G6.3)
- [ ] `history` action returns recent triggers with timestamps and results (FR-G6.4)
- [ ] `create` action creates a new rule with full configuration (FR-G6.5)
- [ ] Tool description explains guardrail concepts clearly (FR-G6.6)
- [ ] Output is human-readable text, not raw JSON
- [ ] Transport methods added for all guardrail endpoints
- [ ] Error handling returns MCP error content

**Acceptance Criteria:**

- [ ] Review documented with findings
- [ ] Any issues resolved
- [ ] Existing tests pass

**Dependencies:** Story 0.2 (REST routes reviewed)
**Est. Tests:** 0 (review only — existing tests validated)

---

### Story 6.2 — Guardrail Documentation

**As** a developer using AgentLens,
**I want** comprehensive documentation for the guardrails feature,
**So that** I can configure and manage guardrails effectively.

**Acceptance Criteria:**

- [ ] Guardrail concept guide: what guardrails are, when to use them, how they work
- [ ] Condition types reference: each type with config fields, examples, and calibration tips
- [ ] Action types reference: each type with config fields and behavior details
- [ ] Threshold calibration guide: how to choose thresholds, start with dry-run, examples from personas (Maya's $10 cost breaker, Raj's health < 40)
- [ ] REST API reference for all 11 guardrail endpoints
- [ ] MCP tool usage guide with examples
- [ ] CLI command reference
- [ ] Python SDK guardrail methods reference
- [ ] Troubleshooting: false positives, cooldown tuning, webhook debugging

**Dependencies:** Stories 4.1, 4.4, 5.1–5.5, 6.1 (all guardrail features complete)
**Est. Tests:** 0 (documentation)

---

### Story 6.3 — Framework Plugin Documentation

**As** a developer adopting framework plugins,
**I want** per-framework quickstart guides and a plugin architecture overview,
**So that** I can integrate AgentLens with my framework in minutes.

**Acceptance Criteria:**

- [ ] Plugin architecture overview: BasePlugin, event mapping, fail-safety guarantees
- [ ] LangChain quickstart: install, init, callback handler setup, what events you'll see
- [ ] CrewAI quickstart: install, init, crew hierarchy in dashboard
- [ ] AutoGen quickstart: install, init, message tracing in dashboard
- [ ] Semantic Kernel quickstart: install, filter registration, function capture in dashboard
- [ ] Auto-detection guide: how init() finds frameworks, manual override
- [ ] Model override guide: guardrail_enforcement flag, how model substitution works
- [ ] Event mapping reference table (all frameworks → AgentLens event types)
- [ ] Troubleshooting: plugin not detected, events not appearing, version compatibility

**Dependencies:** Stories 3.1–3.5, 4.2, 4.3 (all plugin features complete)
**Est. Tests:** 0 (documentation)

---

## Story Dependency Map (Full)

```
Story 0.1 (Review: Types/Store/Migration)
├──→ Story 0.2 (Review: Engine/Routes)
│    ├──→ Story 6.1 (Review: MCP Tool)
│    ├──→ Story 4.1 (SDK Guardrail Methods)
│    └──→ Story 4.4 (CLI Commands)
├──→ Story 1.1 (Config Types)
│    └──→ Story 5.1 (List Page)
│         ├──→ Story 5.2 (Detail Page)
│         │    └──→ Story 5.5 (Activity Feed)
│         └──→ Story 5.3 (Create/Edit Form)
├──→ Story 1.2 (Agent Migration)
│    ├──→ Story 4.3 (Model Override)
│    └──→ Story 5.4 (Paused Badge)
├──→ Story 3.1 (LangChain Plugin)
├──→ Story 3.2 (CrewAI Plugin)
├──→ Story 3.3 (AutoGen Plugin)
├──→ Story 3.4 (SK Plugin)
└──→ Story 3.5 (Plugin Integration Tests)
     └──→ Story 4.2 (Auto-Detection)

Story 4.2 + 4.3 → Story 6.3 (Plugin Docs)
Story 4.1 + 4.4 + 5.1-5.5 + 6.1 → Story 6.2 (Guardrail Docs)
```

---

## Test Count Summary

| Story | Description | Est. Tests |
|-------|-------------|-----------|
| 0.1 | Review: Types/Store/Migration | 0 (review) |
| 0.2 | Review: Engine/Routes | 0 (review) |
| 1.1 | Condition/Action Config Types | 6 |
| 1.2 | Agent Migration (pause/override) | 4 |
| 2.1 | GuardrailEngine ✅ | ~15 (existing) |
| 2.2 | Condition Evaluators ✅ | ~18 (existing) |
| 2.3 | Actions + Routes ✅ | ~22 (existing) |
| 3.1 | LangChain Plugin Enhanced | 10 |
| 3.2 | CrewAI Plugin | 10 |
| 3.3 | AutoGen Plugin | 8 |
| 3.4 | Semantic Kernel Plugin | 8 |
| 3.5 | Plugin Integration Tests | 6 |
| 4.1 | SDK Guardrail Methods | 8 |
| 4.2 | Auto-Detection in init() | 6 |
| 4.3 | Model Override Support | 6 |
| 4.4 | CLI Commands | 8 |
| 5.1 | Guardrail List Page | 6 |
| 5.2 | Guardrail Detail Page | 6 |
| 5.3 | Guardrail Create/Edit Form | 8 |
| 5.4 | Agent Paused Badge + Unpause | 5 |
| 5.5 | Activity Feed Events | 5 |
| 6.1 | Review: MCP Tool ✅ | 0 (review) |
| 6.2 | Guardrail Documentation | 0 (docs) |
| 6.3 | Plugin Documentation | 0 (docs) |
| **TOTAL** | | **~179 new + ~55 existing** |

---

## PRD Requirement Traceability

### Guardrails

| PRD ID | Story | Status |
|--------|-------|--------|
| FR-G1.1–G1.7 | 0.1, 2.1 | ✅ DONE (review) |
| FR-G2.1–G2.7 | 0.2, 2.1, 2.2 | ✅ DONE (review) |
| FR-G3.1–G3.9 | 0.2, 2.3 | ✅ DONE (review) |
| FR-G4.1–G4.4 | 0.1, 0.2, 1.2 | Partially done, 1.2 is new |
| FR-G5.1–G5.11 | 0.2, 2.3, 1.2 | ✅ DONE (review), 1.2 adds unpause |
| FR-G6.1–G6.6 | 6.1 | ✅ DONE (review) |
| FR-G7.1–G7.6 | 5.1–5.5 | 🔲 NEW |

### Framework Plugins

| PRD ID | Story | Status |
|--------|-------|--------|
| FR-F1.1–F1.8 | 3.1–3.4 | 🔲 NEW (partial code exists) |
| FR-F2.1–F2.9 | 3.1 | 🔲 NEW |
| FR-F3.1–F3.8 | 3.2 | 🔲 NEW (partial code exists) |
| FR-F4.1–F4.8 | 3.3 | 🔲 NEW (partial code exists) |
| FR-F5.1–F5.9 | 3.4 | 🔲 NEW (partial code exists) |
| FR-F6.1–F6.5 | 4.2 | 🔲 NEW |
| FR-F7.1–F7.5 | 4.3 | 🔲 NEW |

### NFRs

| NFR | Story | Status |
|-----|-------|--------|
| NFR-1 (< 50ms eval) | 0.2 | ✅ DONE (review benchmark) |
| NFR-2 (no POST latency) | 0.2 | ✅ DONE (review) |
| NFR-3 (< 5s webhook) | 0.2 | ✅ DONE (review) |
| NFR-4 (< 5ms plugin) | 3.5 | 🔲 NEW |
| NFR-5 (< 500ms init) | 4.2 | 🔲 NEW |
| NFR-6 (< 1s list page) | 5.1 | 🔲 NEW |
| NFR-7 (plugin fail-safety) | 3.1–3.5 | 🔲 NEW |
| NFR-8–10 (fail-safety) | 0.2 | ✅ DONE (review) |
| NFR-11–15 (security) | 0.2 | ✅ DONE (review) |
| NFR-16–17 (server tests) | 0.2 | ✅ DONE (review) |
| NFR-18 (plugin integration tests) | 3.5 | 🔲 NEW |
| NFR-19 (property tests) | 0.2 | 🔲 May need additions |
| NFR-20 (fail-safety tests) | 3.5 | 🔲 NEW |
| NFR-21 (E2E tests) | 0.2 | 🔲 May need additions |
| NFR-22–27 (compatibility) | 0.1, 0.2 | ✅ DONE (review) |
| NFR-28–30 (observability) | 0.2 | ✅ DONE (review) |

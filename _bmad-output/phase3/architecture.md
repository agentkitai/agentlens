# AgentLens v0.8.0 — Technical Architecture

## Phase 3: Proactive Guardrails & Framework Plugins

---

## 1. Proactive Guardrails Architecture

### 1.1 Data Model

#### GuardrailRule
```typescript
interface GuardrailRule {
  id: string;                    // ULID
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;
  
  // Condition
  conditionType: GuardrailConditionType;
  conditionConfig: Record<string, unknown>; // type-specific config
  
  // Action
  actionType: GuardrailActionType;
  actionConfig: Record<string, unknown>;    // type-specific config
  
  // Scope
  agentId?: string;              // null = all agents
  
  // Cooldown
  cooldownMinutes: number;       // minimum time between triggers (default: 15)
  
  // Mode
  dryRun: boolean;               // log but don't execute action
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}
```

#### Condition Types
```typescript
type GuardrailConditionType =
  | 'error_rate_threshold'     // error rate % in window
  | 'cost_limit'               // cost $ threshold (session or daily)
  | 'health_score_threshold'   // health score below N
  | 'custom_metric';           // arbitrary metric threshold

// Condition configs:
// error_rate_threshold: { threshold: number (0-100), windowMinutes: number }
// cost_limit: { maxCostUsd: number, scope: 'session' | 'daily' }
// health_score_threshold: { minScore: number (0-100), windowDays: number }
// custom_metric: { metricName: string, operator: 'gt' | 'lt' | 'eq', value: number, windowMinutes: number }
```

#### Action Types
```typescript
type GuardrailActionType =
  | 'pause_agent'              // emit guardrail_triggered event
  | 'notify_webhook'           // HTTP POST to URL
  | 'downgrade_model'          // emit model downgrade recommendation
  | 'agentgate_policy';        // call AgentGate API

// Action configs:
// pause_agent: { message?: string }
// notify_webhook: { url: string, headers?: Record<string, string> }
// downgrade_model: { targetModel: string, message?: string }
// agentgate_policy: { agentgateUrl: string, policyId: string, action: string }
```

#### GuardrailState (runtime state)
```typescript
interface GuardrailState {
  ruleId: string;
  tenantId: string;
  lastTriggeredAt?: string;    // for cooldown calculation
  triggerCount: number;         // total triggers
  lastEvaluatedAt?: string;
  currentValue?: number;        // last evaluated metric value
}
```

#### GuardrailTriggerHistory
```typescript
interface GuardrailTriggerHistory {
  id: string;                  // ULID
  ruleId: string;
  tenantId: string;
  triggeredAt: string;
  conditionValue: number;      // the metric value that triggered
  conditionThreshold: number;  // the threshold it was compared against
  actionExecuted: boolean;     // false if dry-run or cooldown
  actionResult?: string;       // 'success', 'failed', 'dry_run', 'cooldown'
  metadata: Record<string, unknown>; // additional context
}
```

### 1.2 SQLite Schema

```sql
CREATE TABLE guardrail_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  condition_type TEXT NOT NULL,
  condition_config TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL,
  action_config TEXT NOT NULL DEFAULT '{}',
  agent_id TEXT,
  cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guardrail_state (
  rule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  last_triggered_at TEXT,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at TEXT,
  current_value REAL,
  PRIMARY KEY (rule_id, tenant_id)
);

CREATE TABLE guardrail_trigger_history (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  condition_value REAL NOT NULL,
  condition_threshold REAL NOT NULL,
  action_executed INTEGER NOT NULL DEFAULT 0,
  action_result TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

### 1.3 Evaluation Pipeline

```
Event POST → Store event → Return 201 → [ASYNC] EventBus.emit('event_ingested')
                                              ↓
                                    GuardrailEngine.onEvent(event)
                                              ↓
                                    Load enabled rules for tenant + agent
                                              ↓
                                    For each rule:
                                      1. Check cooldown → skip if in cooldown
                                      2. Evaluate condition → compute metric
                                      3. Update state (lastEvaluatedAt, currentValue)
                                      4. If condition met:
                                         a. Check dry_run → log only
                                         b. Execute action
                                         c. Record trigger history
                                         d. Update state (lastTriggeredAt, triggerCount)
```

Key design decisions:
- **Subscribes to EventBus** — same pattern as AlertEngine and SSE stream
- **Never blocks event ingestion** — runs in the same process but async
- **Evaluates per-event** — lightweight checks, no batch windowing needed
- **Cooldown check is first** — cheapest check, short-circuits early

### 1.4 REST API Endpoints

```
POST   /api/guardrails              — Create rule
GET    /api/guardrails              — List rules
GET    /api/guardrails/:id          — Get rule
PUT    /api/guardrails/:id          — Update rule
DELETE /api/guardrails/:id          — Delete rule
GET    /api/guardrails/:id/status   — Get rule status + recent triggers
GET    /api/guardrails/history      — List trigger history (filterable)
```

### 1.5 MCP Tool

```
agentlens_guardrails — Check guardrail status for the current agent
  Inputs: { agentId?: string }
  Returns: List of active rules, their status, recent triggers
```

---

## 2. Framework Plugins Architecture

### 2.1 Base Plugin Class

```python
class BaseFrameworkPlugin:
    """Base class for all framework plugins."""
    
    def __init__(self, client=None, agent_id=None, session_id=None, redact=False):
        self._client = client
        self._agent_id = agent_id
        self._session_id = session_id or str(uuid.uuid4())
        self._redact = redact
    
    def _get_client_and_config(self) -> tuple | None:
        """Get client config from constructor or global state."""
        # Same pattern as existing LangChain handler
    
    def _send_event(self, client, event: dict) -> None:
        """Send event to server. NEVER raises."""
        try:
            client._request("POST", "/api/events", json={"events": [event]})
        except Exception:
            logger.debug("AgentLens: failed to send event", exc_info=True)
    
    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
```

### 2.2 Plugin Implementations

#### LangChain (extends existing)
- Already has: LLM start/end, tool start/end/error
- Add: chain_start/end, agent_action, retriever events
- Maps to: custom events with source='langchain', framework metadata

#### CrewAI
```python
class AgentLensCrewAIHandler(BaseFrameworkPlugin):
    """CrewAI task/agent lifecycle handler."""
    
    # Hooks into CrewAI's step callback mechanism
    def on_task_start(task, agent): ...
    def on_task_end(task, agent, output): ...
    def on_agent_action(agent, action): ...
    def on_crew_start(crew): ...
    def on_crew_end(crew, result): ...
```

#### AutoGen
```python
class AgentLensAutoGenHandler(BaseFrameworkPlugin):
    """AutoGen conversation/agent handler."""
    
    # Implements autogen's ConversableAgent hooks
    def on_message_sent(sender, receiver, message): ...
    def on_message_received(sender, receiver, message): ...
    def on_tool_call(agent, tool_name, args): ...
    def on_tool_result(agent, tool_name, result): ...
```

#### Semantic Kernel
```python
class AgentLensSKHandler(BaseFrameworkPlugin):
    """Semantic Kernel function/planner handler."""
    
    # Implements SK's FunctionInvocationFilter
    def on_function_invoking(context): ...
    def on_function_invoked(context): ...
```

### 2.3 Event Mapping

All framework events map to existing AgentLens event types:

| Framework Concept | AgentLens Event Type | Metadata |
|------------------|---------------------|----------|
| Chain/Crew/Conversation start | session_started | source=framework, framework_type=... |
| Chain/Crew/Conversation end | session_ended | source=framework |
| LLM call | llm_call + llm_response | source=framework |
| Tool invocation | tool_call + tool_response | source=framework |
| Tool error | tool_error | source=framework |
| Agent action | custom | type='agent_action', source=framework |
| Agent delegation | custom | type='agent_delegation' |
| Memory operation | custom | type='memory_operation' |

### 2.4 Auto-Detection in init()

```python
def _instrument_frameworks() -> None:
    """Auto-detect and instrument installed frameworks."""
    
    if importlib.util.find_spec("langchain_core") is not None:
        # LangChain already handled by existing code
        # New: register enhanced handler
        pass
    
    if importlib.util.find_spec("crewai") is not None:
        from agentlensai.integrations.crewai import instrument_crewai
        instrument_crewai()
    
    if importlib.util.find_spec("autogen") is not None:
        from agentlensai.integrations.autogen import instrument_autogen
        instrument_autogen()
    
    if importlib.util.find_spec("semantic_kernel") is not None:
        from agentlensai.integrations.semantic_kernel import instrument_semantic_kernel
        instrument_semantic_kernel()
```

---

## 3. Integration Points

### 3.1 Event Bus Integration (Guardrails)
The GuardrailEngine subscribes to the EventBus like the existing AlertEngine:
```typescript
eventBus.on('event_ingested', (busEvent) => {
  guardrailEngine.evaluateEvent(busEvent.event);
});
```

### 3.2 Server Startup
```typescript
// In startServer():
const guardrailEngine = new GuardrailEngine(store, db);
guardrailEngine.start();
```

### 3.3 Dashboard
New page: `/guardrails` — lists rules, status, trigger history.
Uses existing React patterns (fetch from API, table display, forms for CRUD).

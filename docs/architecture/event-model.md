# Event Model

Every piece of data in AgentLens is represented as an event. Events are immutable, append-only, and cryptographically linked.

## Event Structure

```typescript
interface AgentLensEvent {
  id: string;           // ULID (time-sortable unique ID)
  timestamp: string;    // ISO 8601
  sessionId: string;    // Groups events into agent sessions
  agentId: string;      // Which agent produced this event
  eventType: EventType; // One of 18 types
  severity: EventSeverity; // debug | info | warn | error | critical
  payload: object;      // Type-specific data
  metadata: object;     // Additional context
  prevHash: string | null; // Previous event's hash in this session
  hash: string;         // SHA-256 of this event (includes prevHash)
}
```

## Event Types (18)

### Agent Lifecycle
- `session_started` — Agent session begins
- `session_ended` — Agent session ends

### Tool Calls
- `tool_call` — Agent invokes a tool
- `tool_response` — Tool returns a result
- `tool_error` — Tool call fails

### Approval Flow (AgentGate)
- `approval_requested` — Agent requests human approval
- `approval_granted` — Human approves the action
- `approval_denied` — Human denies the action
- `approval_expired` — Approval request timed out

### Data Collection (FormBridge)
- `form_submitted` — Form sent to human
- `form_completed` — Human completed the form
- `form_expired` — Form timed out

### LLM Call Tracking
- `llm_call` — Request sent to an LLM provider (prompt, model, parameters)
- `llm_response` — Completion received from an LLM provider (tokens, cost, latency)

### Cost Tracking
- `cost_tracked` — Token usage and cost recorded

### Alerting
- `alert_triggered` — Alert rule threshold breached
- `alert_resolved` — Alert condition resolved

### Extension
- `custom` — User-defined event type

## Severity Levels

| Level | When to Use |
|---|---|
| `debug` | Verbose diagnostic information |
| `info` | Normal operation events (default) |
| `warn` | Something unexpected but not an error |
| `error` | Operation failed |
| `critical` | System-level failure requiring immediate attention |

## Hash Chain

Events within a session are linked by a SHA-256 hash chain:

```
Event 1: prevHash=null,  hash=SHA256(event1 data + null)
Event 2: prevHash=hash1, hash=SHA256(event2 data + hash1)
Event 3: prevHash=hash2, hash=SHA256(event3 data + hash2)
```

This provides **tamper evidence**: if any event is modified after ingestion, the chain breaks and the session timeline API reports `chainValid: false`.

The hash is computed from a canonical JSON representation of the event's key fields (id, timestamp, sessionId, agentId, eventType, severity, payload, metadata, prevHash).

## Sessions

Sessions are materialized aggregates that track:

```typescript
interface Session {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'completed' | 'error';
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  totalCostUsd: number;
  tags: string[];
}
```

Session aggregates (eventCount, toolCallCount, errorCount, totalCostUsd) are updated in real time as events are ingested — no batch computation required.

## Payload Truncation

Event payloads are truncated to **10 KB** (UTF-8). If a payload exceeds this limit, it's truncated with a `__truncated: true` indicator. This prevents large payloads from degrading query performance.

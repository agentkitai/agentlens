# Replay API

Session replay endpoint. Reconstructs a session step by step with cumulative context at each point.

## GET /api/sessions/:id/replay

Returns a `ReplayState` for the given session, containing ordered steps with paired events and reconstructed context.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Session ID |

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `offset` | number | 0 | ≥ 0 | Start at this step index |
| `limit` | number | 1000 | 1–5000 | Maximum steps to return |
| `eventTypes` | string | — | — | Comma-separated event type filter (e.g., `llm_call,tool_call`) |
| `includeContext` | boolean | `true` | — | Include reconstructed context per step |

### Valid Event Types

`session_started`, `session_ended`, `llm_call`, `llm_response`, `tool_call`, `tool_response`, `error`, `decision`, `observation`, `custom`

### Response (200)

```json
{
  "session": {
    "id": "ses_abc123",
    "agentId": "my-agent",
    "status": "completed",
    "startedAt": "2026-02-08T10:30:00.000Z",
    "endedAt": "2026-02-08T10:32:15.000Z"
  },
  "chainValid": true,
  "totalSteps": 42,
  "steps": [
    {
      "index": 0,
      "event": {
        "id": "evt_001",
        "eventType": "session_started",
        "timestamp": "2026-02-08T10:30:00.000Z",
        "payload": {}
      },
      "pairedEvent": null,
      "pairDurationMs": null,
      "context": {
        "eventIndex": 0,
        "totalEvents": 42,
        "cumulativeCostUsd": 0.0,
        "elapsedMs": 0,
        "eventCounts": { "session_started": 1 },
        "llmHistory": [],
        "toolResults": [],
        "pendingApprovals": [],
        "errorCount": 0,
        "warnings": []
      }
    },
    {
      "index": 1,
      "event": {
        "id": "evt_002",
        "eventType": "llm_call",
        "timestamp": "2026-02-08T10:30:01.000Z",
        "payload": { "provider": "openai", "model": "gpt-4o" }
      },
      "pairedEvent": {
        "id": "evt_003",
        "eventType": "llm_response",
        "timestamp": "2026-02-08T10:30:02.200Z"
      },
      "pairDurationMs": 1200,
      "context": {
        "eventIndex": 1,
        "totalEvents": 42,
        "cumulativeCostUsd": 0.012,
        "elapsedMs": 1000,
        "eventCounts": { "session_started": 1, "llm_call": 1 },
        "llmHistory": [
          {
            "callId": "call_001",
            "provider": "openai",
            "model": "gpt-4o",
            "messages": [],
            "response": "...",
            "costUsd": 0.012,
            "latencyMs": 1200
          }
        ],
        "toolResults": [],
        "pendingApprovals": [],
        "errorCount": 0,
        "warnings": []
      }
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 1000,
    "hasMore": false
  },
  "summary": {
    "totalCost": 0.0342,
    "totalDurationMs": 135000,
    "totalLlmCalls": 4,
    "totalToolCalls": 6,
    "totalErrors": 0,
    "models": ["gpt-4o"],
    "tools": ["read_file", "search_code", "write_file"]
  }
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `session` | object | Session metadata |
| `chainValid` | boolean | Whether the event hash chain is valid |
| `totalSteps` | number | Total steps in the full replay |
| `steps` | array | Ordered replay steps (may be paginated) |
| `steps[].index` | number | 0-based step index |
| `steps[].event` | object | The event at this step |
| `steps[].pairedEvent` | object\|null | Paired event (e.g., tool_call → tool_response) |
| `steps[].pairDurationMs` | number\|null | Duration between paired events (ms) |
| `steps[].context` | object | Reconstructed context at this step |
| `steps[].context.cumulativeCostUsd` | number | Total cost up to this step |
| `steps[].context.elapsedMs` | number | Time since session start |
| `steps[].context.eventCounts` | object | Event type counts up to this step |
| `steps[].context.llmHistory` | array | LLM conversation history (capped at 50) |
| `steps[].context.toolResults` | array | Tool call results available at this step |
| `steps[].context.pendingApprovals` | array | Approval statuses |
| `steps[].context.errorCount` | number | Cumulative error count |
| `steps[].context.warnings` | array | Warnings triggered at this step |
| `pagination` | object | Pagination info |
| `pagination.hasMore` | boolean | Whether more steps are available |
| `summary` | object | Session-level summary |

### Caching

Replay states are cached server-side in an LRU cache:
- **Max entries:** 100
- **TTL:** 10 minutes
- **LLM history cap:** 50 entries per step (memory guard)

### Errors

| Status | Condition |
|---|---|
| 400 | Invalid query parameter |
| 404 | Session not found |

# Session Replay

Session Replay lets you step through any past session event by event, with full context reconstruction at each step. Think of it as a flight recorder playback — see exactly what the agent saw, thought, and did, with cumulative cost, LLM history, tool results, and error tracking.

## What Gets Reconstructed

At each step in the replay, the context includes:

| Field | Description |
|---|---|
| **Cumulative cost** | Total USD spent up to this point |
| **Elapsed time** | Time since session start |
| **Event counts** | Counts by event type up to this point |
| **LLM history** | Full conversation history (messages, responses, tool calls) |
| **Tool results** | Tool call results available at this point |
| **Pending approvals** | AgentGate approval statuses |
| **Error count** | Cumulative errors |
| **Warnings** | Cost or latency warnings triggered at this step |

Events are paired where applicable — e.g., `tool_call` ↔ `tool_response`, `llm_call` ↔ `llm_response` — with duration between pairs calculated.

## Using Session Replay

### Dashboard

The **Session Replay** page provides a visual step-through interface:

- **Timeline scrubber** — drag or click to jump to any step
- **Step list** — numbered, timestamped events with type icons
- **Context panel** — shows the full reconstructed context at the current step
- **Filters** — filter by event type to focus on specific interactions
- **Controls** — play/pause, step forward/back, speed control

### MCP Tool

```
agentlens_replay({
  sessionId: "ses_abc123",
  summaryOnly: false,
  eventTypes: "llm_call,tool_call"
})
```

Returns a formatted timeline:

```
📼 Session Replay: ses_abc123

Agent: my-agent
Status: completed
Started: 2026-02-08T10:30:00Z
Duration: 2m 15s
Total Cost: $0.0342
Events: llm_call: 4, tool_call: 6, tool_response: 6

1. [10:30:00] 🟢 session_started
   Session initialized for agent my-agent

2. [10:30:01] 🤖 llm_call (1.2s)
   GPT-4o: "Analyzing the deployment configuration..."
   💰 $0.0120
   [cost-so-far: $0.0120 | errors: 0]

3. [10:30:02] 🔧 tool_call (0.3s)
   read_file: config/deploy.yaml
   [cost-so-far: $0.0120 | errors: 0]
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | **Required.** Session to replay |
| `fromStep` | number | Start step number (0-based) |
| `toStep` | number | End step number (inclusive) |
| `eventTypes` | string | Comma-separated filter (e.g., `"llm_call,tool_call"`) |
| `summaryOnly` | boolean | Return only the header (no steps). Default: `false` |

### REST API

```bash
# Full replay
curl http://localhost:3400/api/sessions/ses_abc123/replay \
  -H "Authorization: Bearer als_your_key"

# Paginated replay (first 100 steps)
curl "http://localhost:3400/api/sessions/ses_abc123/replay?offset=0&limit=100" \
  -H "Authorization: Bearer als_your_key"

# Filter by event type
curl "http://localhost:3400/api/sessions/ses_abc123/replay?eventTypes=llm_call,tool_call" \
  -H "Authorization: Bearer als_your_key"

# Without context (lighter response)
curl "http://localhost:3400/api/sessions/ses_abc123/replay?includeContext=false" \
  -H "Authorization: Bearer als_your_key"
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `offset` | number | 0 | Start at this step index |
| `limit` | number | 1000 | Max steps to return (max: 5000) |
| `eventTypes` | string | — | Comma-separated event type filter |
| `includeContext` | boolean | `true` | Include reconstructed context per step |

### Response Structure

```json
{
  "session": { "id": "ses_abc123", "agentId": "my-agent", "status": "completed", "..." : "..." },
  "chainValid": true,
  "totalSteps": 42,
  "steps": [
    {
      "index": 0,
      "event": { "..." : "..." },
      "pairedEvent": null,
      "context": {
        "eventIndex": 0,
        "totalEvents": 42,
        "cumulativeCostUsd": 0.0,
        "elapsedMs": 0,
        "eventCounts": {},
        "llmHistory": [],
        "toolResults": [],
        "pendingApprovals": [],
        "errorCount": 0,
        "warnings": []
      }
    }
  ],
  "pagination": { "offset": 0, "limit": 1000, "hasMore": false },
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

## Caching

Replay states are cached server-side using an LRU cache (100 entries, 10-minute TTL). Repeated requests for the same session return quickly from cache. LLM history within cached entries is capped at 50 entries per step to limit memory usage.

## Use Cases

- **Post-mortem debugging** — Step through a failed session to find exactly where and why it went wrong
- **Cost analysis** — Watch cost accumulate step by step to identify expensive operations
- **Audit** — Verify the agent's decision-making process at each point in time
- **Training** — Show new team members how an agent handles specific scenarios

## See Also

- [REST API Reference → Replay](../reference/replay.md)
- [Dashboard Guide](./dashboard.md) — Session Replay page

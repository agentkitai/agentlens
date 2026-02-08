# MCP Integration

AgentLens ships as an MCP server (`@agentlensai/mcp`) that agents add to their tool configuration. This is the primary integration method — it requires zero code changes in your agent.

## How It Works

1. Your agent connects to the AgentLens MCP server via stdio transport
2. The MCP server exposes 4 tools that the agent can call
3. Events are sent to the AgentLens API server over HTTP
4. Events appear in the dashboard in real time

```
Agent  ──MCP stdio──►  @agentlensai/mcp  ──HTTP──►  @agentlensai/server
                        (4 tools)                    (API + Dashboard)
```

## MCP Tools

### `agentlens_session_start`

Start a new monitoring session. Call this at the beginning of an agent workflow.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | ✅ | Unique identifier for the agent |
| `agentName` | string | — | Human-readable agent name |
| `tags` | string[] | — | Tags for categorizing the session |

**Returns:** `{ sessionId: string }`

### `agentlens_log_event`

Log an event within a session. Use this for tool calls, errors, custom events, and cost tracking.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | ✅ | Session ID from `session_start` |
| `agentId` | string | ✅ | Agent identifier |
| `eventType` | string | ✅ | One of the 16 event types |
| `severity` | string | — | `debug` / `info` / `warn` / `error` / `critical` (default: `info`) |
| `payload` | object | ✅ | Event-specific payload (see Event Types below) |
| `metadata` | object | — | Additional metadata |

### `agentlens_session_end`

End a monitoring session. Call this when the agent workflow completes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | ✅ | Session ID to end |
| `reason` | string | ✅ | `completed` / `error` / `timeout` / `manual` |
| `summary` | string | — | Human-readable summary |

### `agentlens_query_events`

Query events for agent self-inspection. Agents can review their own recent activity.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | — | Filter by session |
| `eventType` | string | — | Filter by event type |
| `limit` | number | — | Max results (default: 10) |

## Event Types

Each event type has a specific payload schema:

### Tool Events

```json
// tool_call
{
  "toolName": "search_database",
  "callId": "call_01",
  "arguments": { "query": "user records" },
  "serverName": "my-mcp-server"
}

// tool_response
{
  "callId": "call_01",
  "toolName": "search_database",
  "result": { "count": 42 },
  "durationMs": 342
}

// tool_error
{
  "callId": "call_01",
  "toolName": "search_database",
  "error": "Connection timeout",
  "errorCode": "ETIMEOUT",
  "durationMs": 5000
}
```

### Cost Tracking

```json
// cost_tracked
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "inputTokens": 1500,
  "outputTokens": 800,
  "totalTokens": 2300,
  "costUsd": 0.0092,
  "trigger": "search_database"
}
```

### Custom Events

```json
// custom
{
  "type": "user_feedback",
  "data": { "rating": 5, "comment": "Helpful response" }
}
```

## Buffering & Reliability

The MCP server buffers events locally and flushes to the API in batches:

- **Batch size:** Up to 100 events per flush
- **Flush interval:** Every 1 second
- **Buffer capacity:** Up to 10,000 events if the API is unreachable
- **Recovery:** Buffered events are flushed automatically when the API reconnects

This means your agent continues working even if the AgentLens server is temporarily down.

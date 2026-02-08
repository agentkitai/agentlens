# Events API

## POST /api/events

Ingest a batch of events. Events are validated, assigned IDs, added to the session hash chain, and persisted atomically.

### Request Body

```json
{
  "events": [
    {
      "sessionId": "01HXYZ...",
      "agentId": "my-agent",
      "eventType": "tool_call",
      "severity": "info",
      "payload": {
        "toolName": "search",
        "callId": "c1",
        "arguments": { "query": "test" }
      },
      "metadata": {},
      "timestamp": "2026-02-08T10:00:00.000Z"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `events` | array | ✅ | Array of 1–1000 events |
| `events[].sessionId` | string | ✅ | Session identifier |
| `events[].agentId` | string | ✅ | Agent identifier |
| `events[].eventType` | string | ✅ | One of the 16 event types (see below) |
| `events[].severity` | string | — | `debug` / `info` / `warn` / `error` / `critical` (default: `info`) |
| `events[].payload` | object | ✅ | Event-type-specific payload |
| `events[].metadata` | object | — | Additional metadata (default: `{}`) |
| `events[].timestamp` | string | — | ISO 8601 timestamp (default: server time) |

### Event Types

| Type | Payload Fields |
|---|---|
| `session_started` | `agentName?`, `agentVersion?`, `mcpClientInfo?`, `tags?` |
| `session_ended` | `reason` (completed/error/timeout/manual), `summary?`, `totalToolCalls?`, `totalDurationMs?` |
| `tool_call` | `toolName`, `callId`, `arguments`, `serverName?` |
| `tool_response` | `callId`, `toolName`, `result`, `durationMs` |
| `tool_error` | `callId`, `toolName`, `error`, `errorCode?`, `durationMs` |
| `approval_requested` | `requestId`, `action`, `params`, `urgency` |
| `approval_granted` | `requestId`, `action`, `decidedBy`, `reason?` |
| `approval_denied` | `requestId`, `action`, `decidedBy`, `reason?` |
| `approval_expired` | `requestId`, `action`, `decidedBy`, `reason?` |
| `form_submitted` | `submissionId`, `formId`, `formName?`, `fieldCount` |
| `form_completed` | `submissionId`, `formId`, `completedBy`, `durationMs` |
| `form_expired` | `submissionId`, `formId`, `expiredAfterMs` |
| `cost_tracked` | `provider`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `trigger?` |
| `alert_triggered` | `alertRuleId`, `alertName`, `condition`, `currentValue`, `threshold`, `message` |
| `alert_resolved` | `alertRuleId`, `alertName`, `resolvedBy?` |
| `custom` | `type`, `data` |

### Response (201)

```json
{
  "ingested": 1,
  "events": [
    { "id": "01HXYZ...", "hash": "a1b2c3..." }
  ]
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid JSON, validation error, or empty events array |
| 500 | Storage error |

### curl Example

```bash
curl -X POST http://localhost:3400/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{
    "events": [{
      "sessionId": "sess_01",
      "agentId": "my-agent",
      "eventType": "tool_call",
      "payload": {
        "toolName": "search_database",
        "callId": "call_01",
        "arguments": { "query": "user records" }
      }
    }]
  }'
```

### SDK Example

```typescript
import { AgentLensClient } from '@agentlens/sdk';

const client = new AgentLensClient({
  apiUrl: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

await client.ingestEvents([{
  sessionId: 'sess_01',
  agentId: 'my-agent',
  eventType: 'tool_call',
  payload: {
    toolName: 'search_database',
    callId: 'call_01',
    arguments: { query: 'user records' },
  },
}]);
```

---

## GET /api/events

Query events with flexible filters and pagination.

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | string | Filter by session ID |
| `agentId` | string | Filter by agent ID |
| `eventType` | string | Filter by event type (comma-separated for multiple) |
| `severity` | string | Filter by severity (comma-separated) |
| `from` | string | Start of time range (ISO 8601) |
| `to` | string | End of time range (ISO 8601) |
| `search` | string | Full-text search in payloads |
| `order` | string | Sort order: `asc` or `desc` (default: `desc`) |
| `limit` | number | Results per page (default: 50, max: 500) |
| `offset` | number | Pagination offset (default: 0) |

### Response (200)

```json
{
  "events": [
    {
      "id": "01HXYZ...",
      "timestamp": "2026-02-08T10:00:00.000Z",
      "sessionId": "sess_01",
      "agentId": "my-agent",
      "eventType": "tool_call",
      "severity": "info",
      "payload": { "toolName": "search", "callId": "c1", "arguments": {} },
      "metadata": {},
      "prevHash": null,
      "hash": "a1b2c3..."
    }
  ],
  "total": 1234,
  "hasMore": true
}
```

### curl Example

```bash
# Get tool errors in the last 24 hours
curl "http://localhost:3400/api/events?eventType=tool_error&severity=error&from=2026-02-07T00:00:00Z" \
  -H "Authorization: Bearer als_your_key"
```

---

## GET /api/events/:id

Get a single event by ID.

### Response (200)

```json
{
  "id": "01HXYZ...",
  "timestamp": "2026-02-08T10:00:00.000Z",
  "sessionId": "sess_01",
  "agentId": "my-agent",
  "eventType": "tool_call",
  "severity": "info",
  "payload": { "toolName": "search", "callId": "c1", "arguments": {} },
  "metadata": {},
  "prevHash": null,
  "hash": "a1b2c3..."
}
```

### Errors

| Status | Cause |
|---|---|
| 404 | Event not found |

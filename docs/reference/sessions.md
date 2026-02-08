# Sessions API

## GET /api/sessions

List sessions with filtering and pagination.

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `agentId` | string | Filter by agent ID |
| `status` | string | Filter by status: `active`, `completed`, `error` (comma-separated) |
| `from` | string | Start of time range (ISO 8601) |
| `to` | string | End of time range (ISO 8601) |
| `tags` | string | Filter by tags (comma-separated) |
| `limit` | number | Results per page (default: 50, max: 500) |
| `offset` | number | Pagination offset (default: 0) |

### Response (200)

```json
{
  "sessions": [
    {
      "id": "sess_01HXYZ",
      "agentId": "my-agent",
      "agentName": "My Agent",
      "startedAt": "2026-02-08T10:00:00.000Z",
      "endedAt": "2026-02-08T10:05:00.000Z",
      "status": "completed",
      "eventCount": 47,
      "toolCallCount": 15,
      "errorCount": 0,
      "totalCostUsd": 0.42,
      "tags": ["production"]
    }
  ],
  "total": 256,
  "hasMore": true
}
```

### curl Example

```bash
# List error sessions from the last week
curl "http://localhost:3400/api/sessions?status=error&from=2026-02-01T00:00:00Z" \
  -H "Authorization: Bearer als_your_key"
```

### SDK Example

```typescript
const { sessions, total } = await client.listSessions({
  status: 'error',
  from: '2026-02-01T00:00:00Z',
  limit: 20,
});
```

---

## GET /api/sessions/:id

Get detailed information about a single session.

### Response (200)

```json
{
  "id": "sess_01HXYZ",
  "agentId": "my-agent",
  "agentName": "My Agent",
  "startedAt": "2026-02-08T10:00:00.000Z",
  "endedAt": "2026-02-08T10:05:00.000Z",
  "status": "completed",
  "eventCount": 47,
  "toolCallCount": 15,
  "errorCount": 0,
  "totalCostUsd": 0.42,
  "tags": ["production"]
}
```

### Errors

| Status | Cause |
|---|---|
| 404 | Session not found |

---

## GET /api/sessions/:id/timeline

Get all events for a session in ascending chronological order, with hash chain verification.

### Response (200)

```json
{
  "events": [
    {
      "id": "01H001...",
      "timestamp": "2026-02-08T10:00:00.000Z",
      "sessionId": "sess_01HXYZ",
      "agentId": "my-agent",
      "eventType": "session_started",
      "severity": "info",
      "payload": { "agentName": "My Agent", "tags": ["production"] },
      "metadata": {},
      "prevHash": null,
      "hash": "abc123..."
    },
    {
      "id": "01H002...",
      "timestamp": "2026-02-08T10:00:01.342Z",
      "sessionId": "sess_01HXYZ",
      "agentId": "my-agent",
      "eventType": "tool_call",
      "severity": "info",
      "payload": { "toolName": "search_database", "callId": "c1", "arguments": { "query": "users" } },
      "metadata": {},
      "prevHash": "abc123...",
      "hash": "def456..."
    }
  ],
  "chainValid": true
}
```

The `chainValid` field indicates whether the SHA-256 hash chain is intact (no events have been tampered with).

### curl Example

```bash
curl "http://localhost:3400/api/sessions/sess_01HXYZ/timeline" \
  -H "Authorization: Bearer als_your_key"
```

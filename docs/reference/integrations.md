# Integrations API

## POST /api/events/ingest

Webhook ingestion endpoint for AgentGate, FormBridge, and generic third-party sources. Events are mapped to AgentLens event types and persisted.

### Request Body

```json
{
  "source": "agentgate",
  "event": "request.approved",
  "data": {
    "requestId": "req_123",
    "action": "send_email",
    "decidedBy": "admin@company.com",
    "reason": "Approved for known recipient"
  },
  "timestamp": "2026-02-08T10:00:00.000Z",
  "context": {
    "agentlens_session_id": "sess_01HXYZ",
    "agentlens_agent_id": "my-agent"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | ✅ | `agentgate`, `formbridge`, or `generic` |
| `event` | string | ✅ | Source-specific event name |
| `data` | object | ✅ | Event payload |
| `timestamp` | string | — | ISO 8601 timestamp (default: server time) |
| `context` | object | — | Correlation context for session linking |
| `context.agentlens_session_id` | string | — | Link to an existing session |
| `context.agentlens_agent_id` | string | — | Agent identifier |

### Signature Verification

For `agentgate` and `formbridge` sources, the request must include an HMAC-SHA256 signature:

```
X-Webhook-Signature: <hmac-sha256-hex-of-raw-body>
```

Generic webhooks don't require signatures.

### AgentGate Events

| Webhook Event | Maps To | Payload |
|---|---|---|
| `request.created` | `approval_requested` | `requestId`, `action`, `params`, `urgency` |
| `request.approved` | `approval_granted` | `requestId`, `action`, `decidedBy`, `reason?` |
| `request.denied` | `approval_denied` | `requestId`, `action`, `decidedBy`, `reason?` |
| `request.expired` | `approval_expired` | `requestId`, `action`, `decidedBy`, `reason?` |

### FormBridge Events

| Webhook Event | Maps To | Payload |
|---|---|---|
| `submission.created` | `form_submitted` | `submissionId`, `formId`, `formName?`, `fieldCount` |
| `submission.completed` | `form_completed` | `submissionId`, `formId`, `completedBy`, `durationMs` |
| `submission.expired` | `form_expired` | `submissionId`, `formId`, `expiredAfterMs` |

### Generic Events

For the `generic` source, the `data` object should include:

```json
{
  "eventType": "custom",
  "type": "my-event-type",
  "data": { "key": "value" }
}
```

### Response (201)

```json
{
  "ok": true,
  "eventId": "01HXYZ...",
  "eventType": "approval_granted",
  "sessionId": "sess_01HXYZ"
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid JSON, missing source, missing event, unknown event type |
| 401 | Invalid webhook signature |
| 500 | Webhook secret not configured for source |

### curl Examples

**AgentGate webhook:**

```bash
# Compute signature
BODY='{"source":"agentgate","event":"request.approved","data":{"requestId":"req_123","action":"send_email","decidedBy":"admin"}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "your-secret" | awk '{print $2}')

curl -X POST http://localhost:3400/api/events/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

**Generic webhook (no signature required):**

```bash
curl -X POST http://localhost:3400/api/events/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "generic",
    "event": "custom",
    "data": {
      "eventType": "custom",
      "type": "deployment",
      "data": { "version": "2.0.0" }
    },
    "context": {
      "agentlens_session_id": "sess_01HXYZ",
      "agentlens_agent_id": "deploy-bot"
    }
  }'
```

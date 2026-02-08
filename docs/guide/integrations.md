# Integrations

AgentLens integrates with the AgentKit ecosystem via webhooks. Approval events from AgentGate and data collection events from FormBridge appear directly in your agent session timelines.

## AgentGate Integration

[AgentGate](https://github.com/amitpaz/agentgate) is a human-in-the-loop approval gateway. When connected to AgentLens, approval requests and decisions show up in the session timeline with distinct styling.

### Setup

1. In AgentGate, configure a webhook pointing to your AgentLens server:

```
URL: http://your-agentlens:3400/api/events/ingest
Secret: your-shared-hmac-secret
```

2. In AgentLens, set the AgentGate webhook secret via the Settings page or API:

```bash
curl -X PUT http://localhost:3400/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{"agentGateSecret": "your-shared-hmac-secret"}'
```

### Event Mapping

| AgentGate Event | AgentLens Event Type | Timeline Icon |
|---|---|---|
| `request.created` | `approval_requested` | ⏳ |
| `request.approved` | `approval_granted` | ✅ |
| `request.denied` | `approval_denied` | ❌ |
| `request.expired` | `approval_expired` | ⏰ |

### Session Correlation

To link AgentGate events with AgentLens sessions, include the AgentLens context in your AgentGate webhook payload:

```json
{
  "source": "agentgate",
  "event": "request.approved",
  "data": { "requestId": "req_123", "action": "send_email", "decidedBy": "admin" },
  "context": {
    "agentlens_session_id": "01HXYZ...",
    "agentlens_agent_id": "my-agent"
  }
}
```

## FormBridge Integration

[FormBridge](https://github.com/amitpaz/formbridge) handles structured data collection from humans during agent workflows. When connected, form submission events appear in the timeline.

### Setup

1. In FormBridge, configure a webhook pointing to AgentLens:

```
URL: http://your-agentlens:3400/api/events/ingest
Secret: your-shared-hmac-secret
```

2. In AgentLens, set the FormBridge webhook secret:

```bash
curl -X PUT http://localhost:3400/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{"formBridgeSecret": "your-shared-hmac-secret"}'
```

### Event Mapping

| FormBridge Event | AgentLens Event Type | Description |
|---|---|---|
| `submission.created` | `form_submitted` | Form was sent to a human |
| `submission.completed` | `form_completed` | Human completed the form |
| `submission.expired` | `form_expired` | Form expired without completion |

## Generic Webhooks

You can send custom events from any source using the generic webhook format:

```bash
curl -X POST http://localhost:3400/api/events/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "generic",
    "event": "custom",
    "data": {
      "eventType": "custom",
      "type": "deployment",
      "data": { "version": "2.1.0", "environment": "production" }
    },
    "context": {
      "agentlens_session_id": "01HXYZ...",
      "agentlens_agent_id": "deploy-bot"
    }
  }'
```

Generic webhooks don't require HMAC signature verification.

## Webhook Signature Verification

AgentGate and FormBridge webhooks are verified using **HMAC-SHA256**:

1. The sender computes `HMAC-SHA256(raw_body, shared_secret)` as a hex string
2. The signature is sent in the `X-Webhook-Signature` header
3. AgentLens verifies the signature using timing-safe comparison

This prevents unauthorized event injection.

# Cost Tracking

AgentLens tracks token usage and estimated costs across all your agents, giving you visibility into LLM spending.

## How It Works

Agents log `cost_tracked` events with token counts and estimated cost:

```
Tool: agentlens_log_event
Arguments: {
  "sessionId": "01HXYZ...",
  "agentId": "my-agent",
  "eventType": "cost_tracked",
  "payload": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "inputTokens": 1500,
    "outputTokens": 800,
    "totalTokens": 2300,
    "costUsd": 0.0092,
    "trigger": "search_database"
  }
}
```

## Cost Payload Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | string | ✅ | LLM provider (e.g., `anthropic`, `openai`) |
| `model` | string | ✅ | Model name |
| `inputTokens` | number | ✅ | Input/prompt tokens |
| `outputTokens` | number | ✅ | Output/completion tokens |
| `totalTokens` | number | ✅ | Total tokens |
| `costUsd` | number | ✅ | Estimated cost in USD |
| `trigger` | string | — | What triggered this cost (e.g., tool name) |

## Dashboard Views

### Session Cost

Each session shows its total estimated cost in the sessions list and detail view.

### Cost Analytics

The **Analytics** → **Costs** view shows:

- **Cost by agent** — Which agents are most expensive?
- **Cost over time** — Spending trends by hour/day/week
- **Token breakdown** — Input vs output tokens by agent

### Cost Alerts

Set up alerts to catch cost spikes:

```bash
curl -X POST http://localhost:3400/api/alerts/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{
    "name": "Daily cost spike",
    "condition": "cost_exceeds",
    "threshold": 50.0,
    "windowMinutes": 1440,
    "enabled": true
  }'
```

## API Endpoints

Query cost data programmatically:

```bash
# Cost breakdown by agent and time
curl "http://localhost:3400/api/analytics/costs?from=2026-02-01&to=2026-02-08&granularity=day" \
  -H "Authorization: Bearer als_your_key"
```

See [Analytics API Reference](/reference/analytics) for full details.

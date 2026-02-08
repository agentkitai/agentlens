# Alerting

AgentLens includes a configurable alerting system that monitors agent behavior and fires notifications when thresholds are breached.

## Alert Conditions

| Condition | Description | Example |
|---|---|---|
| `error_rate_exceeds` | Error events as % of total events exceeds threshold | > 5% errors in last 60 minutes |
| `cost_exceeds` | Total cost in USD exceeds threshold in window | > $10 in last 24 hours |
| `latency_exceeds` | Average tool call latency exceeds threshold (ms) | > 5000ms avg in last 30 minutes |
| `event_count_exceeds` | Total event count exceeds threshold in window | > 10,000 events in 1 hour |
| `no_events_for` | No events received for N minutes | No events for 60 minutes |

## Creating Alert Rules

### Via Dashboard

Navigate to **Alerts** → **Create Rule** and fill in:
- Rule name
- Condition type
- Threshold value
- Time window (minutes)
- Scope (optional: limit to specific agent or tags)
- Notification channels (webhook URLs)

### Via API

```bash
curl -X POST http://localhost:3400/api/alerts/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{
    "name": "High error rate",
    "condition": "error_rate_exceeds",
    "threshold": 0.05,
    "windowMinutes": 60,
    "enabled": true,
    "scope": { "agentId": "my-agent" },
    "notifyChannels": ["https://hooks.slack.com/services/..."]
  }'
```

## Alert History

All alert triggers and resolutions are recorded and viewable in the dashboard or via API:

```bash
curl http://localhost:3400/api/alerts/history \
  -H "Authorization: Bearer als_your_key"
```

## Notification Channels

Currently supported:
- **Webhook** — POST to any URL with the alert payload
- **Console** — Logged to server stdout

The webhook payload format:

```json
{
  "type": "alert_triggered",
  "rule": { "id": "...", "name": "High error rate", "condition": "error_rate_exceeds" },
  "history": { "id": "...", "currentValue": 0.08, "threshold": 0.05 },
  "timestamp": "2026-02-08T10:00:00.000Z"
}
```

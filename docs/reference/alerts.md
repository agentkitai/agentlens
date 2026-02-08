# Alerts API

## POST /api/alerts/rules

Create a new alert rule.

### Request Body

```json
{
  "name": "High error rate",
  "enabled": true,
  "condition": "error_rate_exceeds",
  "threshold": 0.05,
  "windowMinutes": 60,
  "scope": {
    "agentId": "my-agent",
    "tags": ["production"]
  },
  "notifyChannels": ["https://hooks.slack.com/services/..."]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Rule name (1–200 chars) |
| `enabled` | boolean | — | Whether rule is active (default: `true`) |
| `condition` | string | ✅ | Alert condition (see below) |
| `threshold` | number | ✅ | Threshold value (≥ 0) |
| `windowMinutes` | number | ✅ | Evaluation window in minutes (1–43200) |
| `scope` | object | — | Optional scope filter |
| `scope.agentId` | string | — | Limit rule to a specific agent |
| `scope.tags` | string[] | — | Limit rule to sessions with these tags |
| `notifyChannels` | string[] | — | Webhook URLs for notifications |

### Alert Conditions

| Condition | Threshold Unit | Description |
|---|---|---|
| `error_rate_exceeds` | ratio (0–1) | Error events / total events |
| `cost_exceeds` | USD | Total cost in window |
| `latency_exceeds` | milliseconds | Average tool call latency |
| `event_count_exceeds` | count | Total events in window |
| `no_events_for` | minutes | No events received for N minutes |

### Response (201)

```json
{
  "id": "01HXYZ...",
  "name": "High error rate",
  "enabled": true,
  "condition": "error_rate_exceeds",
  "threshold": 0.05,
  "windowMinutes": 60,
  "scope": { "agentId": "my-agent", "tags": ["production"] },
  "notifyChannels": ["https://hooks.slack.com/services/..."],
  "createdAt": "2026-02-08T10:00:00.000Z",
  "updatedAt": "2026-02-08T10:00:00.000Z"
}
```

### curl Example

```bash
curl -X POST http://localhost:3400/api/alerts/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer als_your_key" \
  -d '{
    "name": "High error rate",
    "condition": "error_rate_exceeds",
    "threshold": 0.05,
    "windowMinutes": 60
  }'
```

---

## GET /api/alerts/rules

List all alert rules.

### Response (200)

```json
{
  "rules": [
    {
      "id": "01HXYZ...",
      "name": "High error rate",
      "enabled": true,
      "condition": "error_rate_exceeds",
      "threshold": 0.05,
      "windowMinutes": 60,
      "scope": {},
      "notifyChannels": [],
      "createdAt": "2026-02-08T10:00:00.000Z",
      "updatedAt": "2026-02-08T10:00:00.000Z"
    }
  ]
}
```

---

## GET /api/alerts/rules/:id

Get a single alert rule.

### Response (200)

Returns a single alert rule object (same shape as in the list).

### Errors

| Status | Cause |
|---|---|
| 404 | Alert rule not found |

---

## PUT /api/alerts/rules/:id

Update an existing alert rule. Only provided fields are updated.

### Request Body

```json
{
  "name": "Updated rule name",
  "enabled": false,
  "threshold": 0.1
}
```

All fields are optional. Same schema as creation but every field is optional.

### Response (200)

Returns the updated alert rule object.

### Errors

| Status | Cause |
|---|---|
| 400 | Validation error |
| 404 | Alert rule not found |

---

## DELETE /api/alerts/rules/:id

Delete an alert rule.

### Response (200)

```json
{
  "id": "01HXYZ...",
  "deleted": true
}
```

### Errors

| Status | Cause |
|---|---|
| 404 | Alert rule not found |

---

## GET /api/alerts/history

List alert history entries (triggers and resolutions).

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ruleId` | string | — | Filter by alert rule ID |
| `limit` | number | 50 | Results per page (max: 500) |
| `offset` | number | 0 | Pagination offset |

### Response (200)

```json
{
  "entries": [
    {
      "id": "01HXYZ...",
      "ruleId": "01HABC...",
      "triggeredAt": "2026-02-08T10:00:00.000Z",
      "resolvedAt": "2026-02-08T10:15:00.000Z",
      "currentValue": 0.08,
      "threshold": 0.05,
      "notified": true
    }
  ],
  "total": 42,
  "hasMore": false
}
```

### curl Example

```bash
curl "http://localhost:3400/api/alerts/history?limit=10" \
  -H "Authorization: Bearer als_your_key"
```

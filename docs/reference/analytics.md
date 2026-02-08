# Analytics API

## GET /api/analytics

Bucketed metrics over time. Returns event counts, tool call counts, error counts, average latency, and cost grouped by time bucket.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |
| `granularity` | string | `hour` | Bucket size: `hour`, `day`, or `week` |
| `agentId` | string | — | Filter to a specific agent |

### Response (200)

```json
{
  "buckets": [
    {
      "bucket": "2026-02-08T10:00:00Z",
      "eventCount": 150,
      "toolCallCount": 45,
      "errorCount": 2,
      "avgLatencyMs": 234,
      "totalCostUsd": 1.23
    }
  ],
  "totals": {
    "eventCount": 1500,
    "toolCallCount": 450,
    "errorCount": 12,
    "avgLatencyMs": 218,
    "totalCostUsd": 12.34
  }
}
```

### curl Example

```bash
curl "http://localhost:3400/api/analytics?from=2026-02-01&to=2026-02-08&granularity=day" \
  -H "Authorization: Bearer als_your_key"
```

---

## GET /api/analytics/llm

LLM-specific analytics: aggregate metrics by model, provider, and time. Includes summary statistics, per-model breakdown, and time-bucketed series.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |
| `granularity` | string | `hour` | Bucket size: `hour`, `day`, or `week` |
| `agentId` | string | — | Filter to a specific agent |
| `model` | string | — | Filter to a specific model |
| `provider` | string | — | Filter to a specific provider |

### Response (200)

```json
{
  "summary": {
    "totalCalls": 42,
    "totalCostUsd": 12.34,
    "totalInputTokens": 150000,
    "totalOutputTokens": 50000,
    "avgLatencyMs": 1250,
    "avgCostPerCall": 0.29
  },
  "byModel": [
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "calls": 20,
      "costUsd": 8.50,
      "inputTokens": 100000,
      "outputTokens": 30000,
      "avgLatencyMs": 1500
    }
  ],
  "byTime": [
    {
      "bucket": "2026-02-08T10:00:00Z",
      "calls": 5,
      "costUsd": 1.20,
      "inputTokens": 15000,
      "outputTokens": 5000,
      "avgLatencyMs": 900
    }
  ]
}
```

### curl Example

```bash
curl "http://localhost:3400/api/analytics/llm?from=2026-02-01&granularity=day&model=claude-sonnet-4-20250514" \
  -H "Authorization: Bearer als_your_key"
```

### SDK Example

```typescript
const analytics = await client.getLlmAnalytics({
  from: '2026-02-01',
  to: '2026-02-08',
  granularity: 'day',
});

console.log(analytics.summary);
// { totalCalls: 42, totalCostUsd: 12.34, ... }

console.log(analytics.byModel);
// [{ provider: "anthropic", model: "claude-sonnet-4-20250514", calls: 20, ... }]
```

---

## GET /api/analytics/costs

Cost breakdown by agent and time period.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |
| `granularity` | string | `day` | Bucket size: `hour`, `day`, or `week` |

### Response (200)

```json
{
  "byAgent": [
    {
      "agentId": "my-agent",
      "totalCostUsd": 5.67,
      "totalInputTokens": 125000,
      "totalOutputTokens": 42000,
      "totalTokens": 167000,
      "eventCount": 89
    }
  ],
  "overTime": [
    {
      "bucket": "2026-02-08T00:00:00Z",
      "totalCostUsd": 2.34,
      "eventCount": 45
    }
  ],
  "totals": {
    "totalCostUsd": 12.34,
    "totalInputTokens": 250000,
    "totalOutputTokens": 84000,
    "totalTokens": 334000
  }
}
```

### curl Example

```bash
curl "http://localhost:3400/api/analytics/costs?from=2026-02-01&granularity=day" \
  -H "Authorization: Bearer als_your_key"
```

---

## GET /api/analytics/agents

Per-agent metrics: session count, error rate, average duration, total cost.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |

### Response (200)

```json
{
  "agents": [
    {
      "agentId": "my-agent",
      "sessionCount": 42,
      "totalEvents": 1500,
      "totalErrors": 12,
      "errorRate": 0.008,
      "totalCostUsd": 5.67,
      "avgDurationMs": 45000
    }
  ]
}
```

### curl Example

```bash
curl "http://localhost:3400/api/analytics/agents?from=2026-02-01" \
  -H "Authorization: Bearer als_your_key"
```

---

## GET /api/analytics/tools

Tool usage statistics: call frequency, error rate, and average duration per tool.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |

### Response (200)

```json
{
  "tools": [
    {
      "toolName": "search_database",
      "callCount": 250,
      "errorCount": 3,
      "errorRate": 0.012,
      "avgDurationMs": 342
    },
    {
      "toolName": "send_email",
      "callCount": 15,
      "errorCount": 0,
      "errorRate": 0,
      "avgDurationMs": 1200
    }
  ]
}
```

### curl Example

```bash
curl "http://localhost:3400/api/analytics/tools?from=2026-02-01" \
  -H "Authorization: Bearer als_your_key"
```

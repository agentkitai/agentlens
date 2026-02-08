# LLM Analytics API

## GET /api/analytics/llm

Returns aggregated LLM call metrics: summary statistics, per-model breakdown, and time-bucketed series.

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
    },
    {
      "provider": "openai",
      "model": "gpt-4o",
      "calls": 15,
      "costUsd": 3.00,
      "inputTokens": 35000,
      "outputTokens": 15000,
      "avgLatencyMs": 900
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
    },
    {
      "bucket": "2026-02-08T11:00:00Z",
      "calls": 8,
      "costUsd": 2.10,
      "inputTokens": 25000,
      "outputTokens": 8000,
      "avgLatencyMs": 1100
    }
  ]
}
```

### Response Fields

#### `summary`

| Field | Type | Description |
|---|---|---|
| `totalCalls` | number | Total number of LLM calls |
| `totalCostUsd` | number | Total cost in USD |
| `totalInputTokens` | number | Total input/prompt tokens |
| `totalOutputTokens` | number | Total output/completion tokens |
| `avgLatencyMs` | number | Average latency in milliseconds |
| `avgCostPerCall` | number | Average cost per call in USD |

#### `byModel[]`

| Field | Type | Description |
|---|---|---|
| `provider` | string | Provider name |
| `model` | string | Model identifier |
| `calls` | number | Number of calls to this model |
| `costUsd` | number | Total cost for this model |
| `inputTokens` | number | Total input tokens for this model |
| `outputTokens` | number | Total output tokens for this model |
| `avgLatencyMs` | number | Average latency for this model |

#### `byTime[]`

| Field | Type | Description |
|---|---|---|
| `bucket` | string | Time bucket start (ISO 8601) |
| `calls` | number | Calls in this bucket |
| `costUsd` | number | Cost in this bucket |
| `inputTokens` | number | Input tokens in this bucket |
| `outputTokens` | number | Output tokens in this bucket |
| `avgLatencyMs` | number | Average latency in this bucket |

### curl Example

```bash
# Get LLM analytics for the past week, by day
curl "http://localhost:3400/api/analytics/llm?from=2026-02-01&to=2026-02-08&granularity=day" \
  -H "Authorization: Bearer als_your_key"

# Filter to a specific model
curl "http://localhost:3400/api/analytics/llm?model=claude-sonnet-4-20250514&from=2026-02-01" \
  -H "Authorization: Bearer als_your_key"

# Filter by agent and provider
curl "http://localhost:3400/api/analytics/llm?agentId=my-agent&provider=anthropic" \
  -H "Authorization: Bearer als_your_key"
```

### SDK Example

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

// Get full analytics
const analytics = await client.getLlmAnalytics({
  from: '2026-02-01',
  to: '2026-02-08',
  granularity: 'day',
});

console.log(`Total LLM calls: ${analytics.summary.totalCalls}`);
console.log(`Total cost: $${analytics.summary.totalCostUsd.toFixed(2)}`);
console.log(`Average latency: ${analytics.summary.avgLatencyMs}ms`);

// Per-model breakdown
for (const model of analytics.byModel) {
  console.log(`${model.provider}/${model.model}: ${model.calls} calls, $${model.costUsd.toFixed(2)}`);
}
```

### CLI Example

```bash
# Summary stats
agentlens llm stats

# Per-model breakdown
agentlens llm models --from 2026-02-01

# Recent calls
agentlens llm recent --model claude-sonnet-4-20250514
```

See the [LLM Call Tracking guide](/guide/llm-tracking) for full documentation.

# Benchmarks API

A/B benchmarking endpoints. Create experiments, manage lifecycle, and retrieve statistical comparison results.

## POST /api/benchmarks

Create a new benchmark.

### Request Body

```json
{
  "name": "GPT-4o vs Claude Sonnet",
  "description": "Compare cost and latency for customer support agent",
  "agentId": "support-agent",
  "variants": [
    { "name": "GPT-4o", "tag": "v-gpt4o", "description": "OpenAI GPT-4o" },
    { "name": "Claude Sonnet", "tag": "v-claude-sonnet", "description": "Anthropic Claude 3 Sonnet" }
  ],
  "metrics": ["avg_cost", "avg_latency", "error_rate", "completion_rate"],
  "minSessionsPerVariant": 30,
  "timeRange": {
    "from": "2026-02-01T00:00:00Z",
    "to": "2026-02-28T23:59:59Z"
  }
}
```

### Body Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Benchmark name |
| `description` | string | — | Optional description |
| `agentId` | string | — | Scope to a specific agent |
| `variants` | array | ✅ | 2–10 variants to compare |
| `variants[].name` | string | ✅ | Variant display name |
| `variants[].tag` | string | ✅ | Session tag for this variant |
| `variants[].description` | string | — | Variant description |
| `variants[].agentId` | string | — | Override agent ID for this variant |
| `metrics` | array | — | Metrics to compare (default: all except `health_score`) |
| `minSessionsPerVariant` | number | — | Minimum sessions for meaningful results |
| `timeRange` | object | — | Time range filter for sessions |

### Valid Metrics

`error_rate`, `avg_cost`, `avg_latency`, `tool_success_rate`, `completion_rate`, `avg_tokens`, `avg_duration`

> `health_score` is not yet supported for benchmarks.

### Response (201)

Returns the created benchmark object with generated `id` and `status: "draft"`.

### Errors

| Status | Condition |
|---|---|
| 400 | Validation error (missing name, <2 variants, invalid metric, etc.) |

---

## GET /api/benchmarks

List benchmarks.

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `status` | string | — | — | Filter by status: `draft`, `running`, `completed`, `cancelled` |
| `agentId` | string | — | — | Filter by agent ID |
| `limit` | number | 20 | 1–100 | Results per page |
| `offset` | number | 0 | ≥ 0 | Pagination offset |

### Response (200)

```json
{
  "benchmarks": [
    {
      "id": "bench_abc123",
      "name": "GPT-4o vs Claude Sonnet",
      "description": "...",
      "status": "running",
      "agentId": "support-agent",
      "metrics": ["avg_cost", "avg_latency"],
      "variants": [
        { "id": "var_001", "name": "GPT-4o", "tag": "v-gpt4o" },
        { "id": "var_002", "name": "Claude Sonnet", "tag": "v-claude-sonnet" }
      ],
      "createdAt": "2026-02-01T00:00:00.000Z",
      "updatedAt": "2026-02-05T10:00:00.000Z"
    }
  ],
  "total": 5,
  "hasMore": false
}
```

---

## GET /api/benchmarks/:id

Get benchmark detail. Includes per-variant session counts.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Benchmark ID |

### Response (200)

Returns the benchmark object with variants enriched with `sessionCount`.

```json
{
  "id": "bench_abc123",
  "name": "GPT-4o vs Claude Sonnet",
  "status": "running",
  "variants": [
    { "id": "var_001", "name": "GPT-4o", "tag": "v-gpt4o", "sessionCount": 25 },
    { "id": "var_002", "name": "Claude Sonnet", "tag": "v-claude-sonnet", "sessionCount": 31 }
  ],
  "metrics": ["avg_cost", "avg_latency", "error_rate", "completion_rate"],
  "minSessionsPerVariant": 30,
  "createdAt": "2026-02-01T00:00:00.000Z",
  "updatedAt": "2026-02-05T10:00:00.000Z"
}
```

### Errors

| Status | Condition |
|---|---|
| 404 | Benchmark not found |

---

## PUT /api/benchmarks/:id/status

Transition benchmark status.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Benchmark ID |

### Request Body

```json
{
  "status": "running"
}
```

### Valid Transitions

| From | To |
|---|---|
| `draft` | `running`, `cancelled` |
| `running` | `completed`, `cancelled` |

### Pre-conditions

- **draft → running:** Each variant must have at least 1 session.
- **running → completed:** Triggers result computation and caching.

### Response (200)

Returns the updated benchmark object.

### Errors

| Status | Condition |
|---|---|
| 400 | Invalid status value |
| 404 | Benchmark not found |
| 409 | Invalid transition (e.g., completed → running) or no sessions for a variant |

---

## GET /api/benchmarks/:id/results

Get statistical comparison results.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Benchmark ID |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `includeDistributions` | boolean | `false` | Include raw value arrays for distribution charts |

### Response (200)

```json
{
  "benchmarkId": "bench_abc123",
  "tenantId": "default",
  "variants": [
    {
      "variantId": "var_001",
      "variantName": "GPT-4o",
      "sessionCount": 50,
      "metrics": {
        "avg_cost": { "mean": 0.032, "median": 0.028, "stddev": 0.012, "min": 0.005, "max": 0.089, "count": 50 },
        "avg_latency": { "mean": 1200, "median": 1100, "stddev": 300, "min": 400, "max": 2500, "count": 50 }
      }
    },
    {
      "variantId": "var_002",
      "variantName": "Claude Sonnet",
      "sessionCount": 48,
      "metrics": {
        "avg_cost": { "mean": 0.021, "median": 0.019, "stddev": 0.008, "min": 0.003, "max": 0.052, "count": 48 },
        "avg_latency": { "mean": 890, "median": 820, "stddev": 250, "min": 300, "max": 1800, "count": 48 }
      }
    }
  ],
  "comparisons": [
    {
      "metric": "avg_cost",
      "variantA": { "id": "var_001", "name": "GPT-4o", "stats": { "..." : "..." } },
      "variantB": { "id": "var_002", "name": "Claude Sonnet", "stats": { "..." : "..." } },
      "absoluteDiff": -0.011,
      "percentDiff": -34.4,
      "testType": "welch_t",
      "testStatistic": 3.12,
      "pValue": 0.0023,
      "confidenceInterval": { "lower": -0.018, "upper": -0.004 },
      "effectSize": 0.89,
      "significant": true,
      "winner": "Claude Sonnet",
      "confidence": "★★★"
    }
  ],
  "summary": "Claude Sonnet wins on avg_cost (p=0.002) and avg_latency (p=0.016). No significant difference on error_rate or completion_rate.",
  "computedAt": "2026-02-08T10:30:00.000Z"
}
```

### Response Fields — Comparisons

| Field | Type | Description |
|---|---|---|
| `metric` | string | Metric being compared |
| `testType` | string | `welch_t` (continuous) or `chi_squared` (rates) |
| `testStatistic` | number | Test statistic value |
| `pValue` | number | p-value |
| `confidenceInterval` | object | 95% CI for the difference |
| `effectSize` | number | Cohen's d or phi coefficient |
| `significant` | boolean | `true` if p < 0.05 |
| `winner` | string\|undefined | Variant name of the winner (if significant) |
| `confidence` | string | `★★★` (p<0.01), `★★` (p<0.05), `★` (p<0.1), `—` (ns) |

### Errors

| Status | Condition |
|---|---|
| 400 | Benchmark is still in `draft` status |
| 404 | Benchmark not found |

---

## DELETE /api/benchmarks/:id

Delete a benchmark. Only `draft` and `cancelled` benchmarks can be deleted.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Benchmark ID |

### Response (204)

No content.

### Errors

| Status | Condition |
|---|---|
| 404 | Benchmark not found |
| 409 | Benchmark is `running` or `completed` |

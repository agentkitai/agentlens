# Health API

Agent health scoring endpoints. Compute health scores across 5 dimensions, retrieve overview data for all agents, and access historical snapshots.

## GET /api/agents/:id/health

Compute the health score for a single agent.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Agent ID |

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `window` | number | 7 | 1–90 | Rolling window in days |

### Response (200)

```json
{
  "agentId": "my-agent",
  "overallScore": 82,
  "trend": "improving",
  "trendDelta": 5.3,
  "dimensions": [
    {
      "name": "error_rate",
      "score": 90,
      "weight": 0.30,
      "rawValue": 0.05,
      "description": "5% error rate across 40 sessions"
    },
    {
      "name": "cost_efficiency",
      "score": 75,
      "weight": 0.20,
      "rawValue": 0.034,
      "description": "Average cost $0.034 per session"
    },
    {
      "name": "tool_success",
      "score": 88,
      "weight": 0.20,
      "rawValue": 0.88,
      "description": "88% tool call success rate"
    },
    {
      "name": "latency",
      "score": 72,
      "weight": 0.15,
      "rawValue": 2300,
      "description": "Average latency 2300ms"
    },
    {
      "name": "completion_rate",
      "score": 85,
      "weight": 0.15,
      "rawValue": 0.85,
      "description": "85% session completion rate"
    }
  ],
  "window": {
    "from": "2026-02-01T00:00:00.000Z",
    "to": "2026-02-08T00:00:00.000Z"
  },
  "sessionCount": 40,
  "computedAt": "2026-02-08T10:30:00.000Z"
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `agentId` | string | The agent ID |
| `overallScore` | number | Weighted health score (0–100) |
| `trend` | string | `improving`, `stable`, or `degrading` |
| `trendDelta` | number | Point change from previous window |
| `dimensions` | array | Per-dimension scores |
| `dimensions[].name` | string | Dimension name |
| `dimensions[].score` | number | Score (0–100) |
| `dimensions[].weight` | number | Weight (0–1) |
| `dimensions[].rawValue` | number | Raw metric value |
| `dimensions[].description` | string | Human-readable description |
| `window` | object | Time range used for computation |
| `sessionCount` | number | Sessions in the window |
| `computedAt` | string | ISO 8601 timestamp |

### Errors

| Status | Condition |
|---|---|
| 400 | Invalid `window` parameter |
| 404 | No sessions found for agent in window |

---

## GET /api/health/overview

Health overview for all agents.

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `window` | number | 7 | 1–90 | Rolling window in days |

### Response (200)

```json
{
  "agents": [
    {
      "agentId": "agent-a",
      "overallScore": 82,
      "trend": "improving",
      "trendDelta": 5.3,
      "dimensions": [ "..." ],
      "window": { "from": "...", "to": "..." },
      "sessionCount": 40,
      "computedAt": "..."
    },
    {
      "agentId": "agent-b",
      "overallScore": 65,
      "trend": "degrading",
      "trendDelta": -8.1,
      "dimensions": [ "..." ],
      "window": { "from": "...", "to": "..." },
      "sessionCount": 12,
      "computedAt": "..."
    }
  ],
  "computedAt": "2026-02-08T10:30:00.000Z"
}
```

---

## GET /api/health/history

Historical health snapshots for an agent. Snapshots are saved automatically the first time health is queried each day.

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `agentId` | string | *(required)* | — | Agent ID |
| `days` | number | 30 | 1–365 | How many days of history |

### Response (200)

```json
{
  "snapshots": [
    {
      "agentId": "my-agent",
      "date": "2026-02-07",
      "overallScore": 80,
      "errorRateScore": 88,
      "costEfficiencyScore": 73,
      "toolSuccessScore": 85,
      "latencyScore": 70,
      "completionRateScore": 82,
      "sessionCount": 15
    },
    {
      "agentId": "my-agent",
      "date": "2026-02-06",
      "overallScore": 77,
      "errorRateScore": 85,
      "costEfficiencyScore": 70,
      "toolSuccessScore": 82,
      "latencyScore": 68,
      "completionRateScore": 80,
      "sessionCount": 12
    }
  ],
  "agentId": "my-agent",
  "days": 30
}
```

### Errors

| Status | Condition |
|---|---|
| 400 | Missing `agentId` or invalid `days` |

---

## GET /api/config/health-weights

Returns the current health scoring weights.

### Response (200)

```json
{
  "errorRate": 0.30,
  "costEfficiency": 0.20,
  "toolSuccess": 0.20,
  "latency": 0.15,
  "completionRate": 0.15
}
```

---

## PUT /api/config/health-weights

Update health scoring weights. **Currently returns 501** — weight customization is planned for a future release.

### Request Body

```json
{
  "errorRate": 0.25,
  "costEfficiency": 0.25,
  "toolSuccess": 0.20,
  "latency": 0.15,
  "completionRate": 0.15
}
```

### Response (501)

```json
{
  "error": "Weight customization coming in a future release",
  "status": 501
}
```

# Reflect API

Analyze behavioral patterns across agent sessions — error patterns, tool sequences, cost analysis, and performance trends.

## GET /api/reflect

Run a pattern analysis across sessions and events.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `analysis` | string | *(required)* | Analysis type (see below) |
| `agentId` | string | — | Filter to a specific agent |
| `from` | string | — | Start of time range (ISO 8601) |
| `to` | string | — | End of time range (ISO 8601) |
| `limit` | number | `20` | Maximum results / patterns |

### Analysis Types

| Type | Description |
|---|---|
| `error_patterns` | Recurring error patterns across sessions — groups similar errors, shows frequency and time range |
| `tool_sequences` | Common tool usage patterns — frequently used tool chains, their success rates, and error rates |
| `cost_analysis` | Cost breakdown by model and agent — total spend, per-session averages, trend direction |
| `performance_trends` | Success rate, duration, and error trends over time — with an overall assessment |

### Response (200)

```json
{
  "analysis": "error_patterns",
  "insights": [
    {
      "type": "error_pattern",
      "summary": "Connection timeout when calling external API",
      "data": {
        "pattern": "Connection timeout",
        "count": 15,
        "firstSeen": "2026-01-15T08:30:00.000Z",
        "lastSeen": "2026-02-07T14:20:00.000Z",
        "affectedSessions": ["ses_001", "ses_002", "ses_003"],
        "precedingTools": [["fetch_api", "process_response"]]
      },
      "confidence": 0.92
    }
  ],
  "metadata": {
    "sessionsAnalyzed": 50,
    "eventsAnalyzed": 1200,
    "timeRange": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-02-08T00:00:00.000Z"
    }
  }
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `analysis` | string | The analysis type that was run |
| `insights` | array | Array of structured insights |
| `insights[].type` | string | Insight classification |
| `insights[].summary` | string | Human-readable summary |
| `insights[].data` | object | Analysis-type-specific structured data |
| `insights[].confidence` | number | Confidence score (0–1) |
| `metadata.sessionsAnalyzed` | number | Number of sessions included |
| `metadata.eventsAnalyzed` | number | Number of events processed |
| `metadata.timeRange` | object | Actual time range analyzed |

### Analysis-Specific Data Shapes

#### error_patterns

```json
{
  "pattern": "Connection timeout",
  "count": 15,
  "firstSeen": "2026-01-15T08:30:00.000Z",
  "lastSeen": "2026-02-07T14:20:00.000Z",
  "affectedSessions": ["ses_001", "ses_002"],
  "precedingTools": [["fetch_api", "process_response"]]
}
```

#### tool_sequences

```json
{
  "tools": ["search_db", "format_result", "respond"],
  "frequency": 25,
  "sessions": 12,
  "errorRate": 0.08
}
```

#### cost_analysis

Summary insight:

```json
{
  "totalCost": 12.45,
  "avgPerSession": 0.25,
  "totalSessions": 50
}
```

Model breakdown insight:

```json
{
  "model": "claude-opus-4-6",
  "callCount": 200,
  "totalCost": 8.50,
  "avgCostPerCall": 0.0425
}
```

#### performance_trends

Current stats insight:

```json
{
  "successRate": 0.94,
  "avgDuration": 12500,
  "avgToolCalls": 8.3,
  "avgErrors": 0.4
}
```

Assessment insight:

```json
{
  "assessment": "improving"
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Missing or invalid `analysis` parameter |
| 401 | Invalid or missing API key |

### curl Examples

```bash
# Error patterns
curl "http://localhost:3400/api/reflect?analysis=error_patterns" \
  -H "Authorization: Bearer als_your_key"

# Cost analysis for a specific agent
curl "http://localhost:3400/api/reflect?analysis=cost_analysis&agentId=my-agent&from=2026-01-01T00:00:00Z" \
  -H "Authorization: Bearer als_your_key"

# Tool sequences
curl "http://localhost:3400/api/reflect?analysis=tool_sequences&limit=20" \
  -H "Authorization: Bearer als_your_key"

# Performance trends
curl "http://localhost:3400/api/reflect?analysis=performance_trends" \
  -H "Authorization: Bearer als_your_key"
```

### CLI Usage

```bash
agentlens reflect error_patterns
agentlens reflect cost_analysis --agent my-agent --from 2026-01-01
agentlens reflect tool_sequences --limit 20
agentlens reflect performance_trends
```

### SDK Example

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

const result = await client.reflect({
  analysis: 'error_patterns',
  agentId: 'my-agent',
  from: '2026-01-01T00:00:00Z',
});

for (const insight of result.insights) {
  console.log(`[${insight.type}] ${insight.summary} (confidence: ${insight.confidence})`);
}

console.log(`Analyzed ${result.metadata.sessionsAnalyzed} sessions, ${result.metadata.eventsAnalyzed} events`);
```

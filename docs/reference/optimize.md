# Optimize API

Cost optimization endpoint. Analyzes LLM call patterns and returns model switch recommendations.

## GET /api/optimize/recommendations

Returns cost optimization recommendations based on LLM call patterns in the specified period.

### Query Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `agentId` | string | — | — | Filter to a specific agent |
| `period` | number | 7 | 1–90 | Analysis period in days |
| `limit` | number | 10 | 1–50 | Maximum recommendations to return |

### Response (200)

```json
{
  "recommendations": [
    {
      "currentModel": "gpt-4o",
      "recommendedModel": "gpt-4o-mini",
      "complexityTier": "simple",
      "currentCostPerCall": 0.0120,
      "recommendedCostPerCall": 0.0003,
      "monthlySavings": 89.20,
      "callVolume": 1203,
      "currentSuccessRate": 0.98,
      "recommendedSuccessRate": 0.97,
      "confidence": "high",
      "agentId": "my-agent"
    },
    {
      "currentModel": "claude-3-opus",
      "recommendedModel": "claude-3-sonnet",
      "complexityTier": "moderate",
      "currentCostPerCall": 0.0450,
      "recommendedCostPerCall": 0.0120,
      "monthlySavings": 53.30,
      "callVolume": 644,
      "currentSuccessRate": 0.95,
      "recommendedSuccessRate": 0.93,
      "confidence": "medium",
      "agentId": "my-agent"
    }
  ],
  "totalPotentialSavings": 142.50,
  "period": 7,
  "analyzedCalls": 3847
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `recommendations` | array | Sorted by `monthlySavings` descending |
| `recommendations[].currentModel` | string | Model currently in use |
| `recommendations[].recommendedModel` | string | Suggested cheaper alternative |
| `recommendations[].complexityTier` | string | `simple`, `moderate`, or `complex` |
| `recommendations[].currentCostPerCall` | number | Average cost per call with current model (USD) |
| `recommendations[].recommendedCostPerCall` | number | Estimated cost per call with recommended model (USD) |
| `recommendations[].monthlySavings` | number | Projected monthly savings (USD) |
| `recommendations[].callVolume` | number | Number of calls analyzed |
| `recommendations[].currentSuccessRate` | number | Success rate with current model (0–1) |
| `recommendations[].recommendedSuccessRate` | number | Estimated success rate with recommended model (0–1) |
| `recommendations[].confidence` | string | `low`, `medium`, or `high` |
| `recommendations[].agentId` | string | Agent this recommendation applies to |
| `totalPotentialSavings` | number | Sum of all recommendation savings (USD/month) |
| `period` | number | Analysis period used (days) |
| `analyzedCalls` | number | Total LLM calls analyzed |

### Errors

| Status | Condition |
|---|---|
| 400 | Invalid `period` or `limit` parameter |

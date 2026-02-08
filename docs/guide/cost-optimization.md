# Cost Optimization

AgentLens analyzes your LLM call patterns and recommends cheaper model alternatives. The optimization engine classifies calls by complexity tier and identifies where expensive models are being used for tasks that cheaper models handle equally well.

## How It Works

### Complexity Classification

Every LLM call is classified into a complexity tier based on token count, tool usage, and conversation depth:

| Tier | Description | Example |
|---|---|---|
| **Simple** | Short prompts, no tool calls, single-turn | Status checks, simple Q&A |
| **Moderate** | Medium prompts, some tool calls, multi-turn | Data lookup, formatting tasks |
| **Complex** | Long prompts, many tool calls, deep reasoning | Code generation, complex analysis |

### Recommendation Engine

The engine compares model usage per complexity tier:

1. Groups LLM calls by `(agent, model, complexity_tier)`
2. For each group, checks if a cheaper model has comparable success rates at that tier
3. Projects monthly savings based on call volume and per-call cost difference
4. Assigns a confidence level based on sample size and success rate gap

### Confidence Levels

| Level | Meaning |
|---|---|
| **High** | Large sample size, comparable success rates, high potential savings |
| **Medium** | Moderate sample size or small success rate gap |
| **Low** | Small sample size or uncertain success rate impact |

## Using Cost Optimization

### Dashboard

The **Cost Optimization** page shows all recommendations sorted by potential monthly savings. Each card shows the current model, recommended alternative, complexity tier, projected savings, confidence level, and success rate comparison.

### MCP Tool

```
agentlens_optimize({ period: 7, limit: 5 })
```

Returns recommendations sorted by savings. Example output:

```
💰 Cost Optimization Recommendations

Total Potential Savings: $142.50/month (analyzed 3,847 calls over 7 days)

1. Switch gpt-4o → gpt-4o-mini for SIMPLE tasks
   Savings: $89.20/month | Confidence: HIGH (1,203 calls)
   Current success: 98% → Recommended success: 97%

2. Switch claude-3-opus → claude-3-sonnet for MODERATE tasks
   Savings: $53.30/month | Confidence: MEDIUM (644 calls)
   Current success: 95% → Recommended success: 93%
```

### CLI

```bash
agentlens optimize                                    # All recommendations
agentlens optimize --agent my-agent                   # Agent-specific
agentlens optimize --period 7 --limit 5               # Last 7 days, top 5
agentlens optimize --format json                      # Raw JSON output
```

### REST API

```bash
curl "http://localhost:3400/api/optimize/recommendations?period=7&limit=10" \
  -H "Authorization: Bearer als_your_key"

# Filter by agent
curl "http://localhost:3400/api/optimize/recommendations?agentId=my-agent&period=30" \
  -H "Authorization: Bearer als_your_key"
```

### Python SDK

```python
from agentlensai import AgentLensClient

client = AgentLensClient("http://localhost:3400", api_key="als_your_key")
result = client.get_optimization_recommendations(period=7, limit=10)

print(f"Potential savings: ${result.total_potential_savings:.2f}/month")
for rec in result.recommendations:
    print(f"  {rec.current_model} → {rec.recommended_model}: ${rec.monthly_savings:.2f}/mo")
```

## Parameters

| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `agentId` | string | — | — | Filter to a specific agent |
| `period` | number | 7 | 1–90 | Analysis period in days |
| `limit` | number | 10 | 1–50 | Maximum recommendations |

## Acting on Recommendations

Recommendations are suggestions, not automatic changes. To act on them:

1. Review the confidence level and success rate comparison
2. For **high confidence** recommendations with comparable success rates, the switch is low-risk
3. For **medium/low confidence**, consider running an [A/B benchmark](./benchmarking.md) first
4. After switching, monitor the agent's [health score](./health-scores.md) for any degradation

## See Also

- [REST API Reference → Optimize](../reference/optimize.md)
- [Health Scores Guide](./health-scores.md) — monitor impact of model changes
- [A/B Benchmarking Guide](./benchmarking.md) — validate recommendations before switching

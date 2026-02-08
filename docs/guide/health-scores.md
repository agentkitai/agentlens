# Health Scores

AgentLens computes a **5-dimension health score** (0–100) for each agent, giving you a single number that captures overall reliability and performance. Health scores update automatically as sessions complete and track trends over time.

## Dimensions

Each dimension is scored 0–100 and contributes to the weighted overall score:

| Dimension | Weight | What it measures |
|---|---|---|
| **Error Rate** | 0.30 | Percentage of sessions with errors. Lower is better. |
| **Cost Efficiency** | 0.20 | Cost relative to agent's own historical average. Penalizes spikes. |
| **Tool Success** | 0.20 | Ratio of successful tool calls vs. total tool calls. |
| **Latency** | 0.15 | Average session duration relative to historical baseline. |
| **Completion Rate** | 0.15 | Percentage of sessions that reach `completed` status. |

The overall score is a weighted sum: `Σ(dimension_score × weight)`.

## Trends

Health scores include a trend indicator comparing the current window to the previous window of the same length:

| Trend | Meaning |
|---|---|
| ↑ `improving` | Score increased by >2 points |
| → `stable` | Score changed by ≤2 points |
| ↓ `degrading` | Score decreased by >2 points |

The `trendDelta` field gives the exact point change (e.g., `+5.3` or `-8.1`).

## Using Health Scores

### Dashboard

The **Health Overview** page shows all agents with their overall score, trend, and session count. Click any agent to see the dimension breakdown and historical chart.

### MCP Tool

```
agentlens_health({ window: 7 })
```

Returns the current agent's health score with dimension breakdown. Requires an active session.

### CLI

```bash
agentlens health                              # Overview of all agents
agentlens health --agent my-agent             # Detailed score with dimensions
agentlens health --agent my-agent --history   # Historical trend
agentlens health --format json                # Raw JSON output
```

### REST API

```bash
# Single agent health
curl http://localhost:3400/api/agents/my-agent/health?window=7 \
  -H "Authorization: Bearer als_your_key"

# All agents overview
curl http://localhost:3400/api/health/overview?window=7 \
  -H "Authorization: Bearer als_your_key"

# Historical snapshots
curl "http://localhost:3400/api/health/history?agentId=my-agent&days=30" \
  -H "Authorization: Bearer als_your_key"
```

### Python SDK

```python
from agentlensai import AgentLensClient

client = AgentLensClient("http://localhost:3400", api_key="als_your_key")

# Single agent
health = client.get_health("my-agent", window=7)
print(f"Score: {health.overall_score}/100 ({health.trend})")

# Overview
overview = client.get_health_overview(window=7)
for agent in overview:
    print(f"{agent.agent_id}: {agent.overall_score}/100")

# History
history = client.get_health_history("my-agent", days=30)
for snapshot in history:
    print(f"{snapshot.date}: {snapshot.overall_score}")
```

## Snapshots

Health snapshots are saved automatically the first time an agent's health is queried each day. This builds a historical record without requiring scheduled jobs. Snapshots include all dimension scores and the session count for that day.

## Configuration

### Weights

Default weights are defined in `@agentlensai/core`:

```json
{
  "errorRate": 0.30,
  "costEfficiency": 0.20,
  "toolSuccess": 0.20,
  "latency": 0.15,
  "completionRate": 0.15
}
```

Current weights can be read via `GET /api/config/health-weights`. Custom weight configuration is planned for a future release.

### Window

The `window` parameter (1–90 days) controls how far back the health computation looks. Default is **7 days**. Shorter windows react faster to recent changes; longer windows smooth out noise.

## See Also

- [REST API Reference → Health](../reference/health.md)
- [Cost Optimization Guide](./cost-optimization.md) — uses health data to inform recommendations
- [Dashboard Guide](./dashboard.md) — Health Overview page

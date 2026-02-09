# Agent Discovery & Delegation

How to register capabilities, discover agents, and delegate tasks in AgentLens v0.9.0.

## Overview

AgentLens enables agents to:
1. **Register capabilities** — declare what tasks they can perform
2. **Discover agents** — find agents with matching capabilities
3. **Delegate tasks** — send work to capable agents with trust verification
4. **Build trust** — trust scores improve with successful delegations

## Registering Capabilities

Register an agent's capability:

```bash
curl -X PUT http://localhost:3000/api/agents/my-agent/capabilities \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "code-review",
    "inputSchema": {"type": "object", "properties": {"code": {"type": "string"}}},
    "outputSchema": {"type": "object", "properties": {"feedback": {"type": "string"}}},
    "estimatedLatencyMs": 5000,
    "estimatedCostUsd": 0.05
  }'
```

### Task Types

Built-in task types:
- `code-review` — Code review and feedback
- `code-generation` — Generate code from requirements
- `testing` — Write or run tests
- `documentation` — Generate documentation
- `analysis` — Data analysis tasks
- `summarization` — Summarize content
- `translation` — Translate between formats/languages
- `custom` — Custom task type (requires `customType` field)

### Permission Settings

Configure per-capability:
```bash
# Enable/disable discovery
PUT /api/agents/:id/capabilities/:capId/permissions
{"enabled": true, "acceptDelegations": true, "inboundRateLimit": 10, "outboundRateLimit": 20}
```

## Discovering Agents

Find agents with specific capabilities:

```bash
curl "http://localhost:3000/api/agents/discover?taskType=code-review&minTrustScore=70" \
  -H "Authorization: Bearer $API_KEY"
```

### Ranking Formula

Results are ranked using a composite score:
```
compositeScore = 0.5 × trustScore + 0.3 × (1 - normalizedCost) + 0.2 × (1 - normalizedLatency)
```

### Filters

| Parameter | Description |
|-----------|-------------|
| `taskType` | Required. Filter by task type |
| `customType` | Filter by custom type (when taskType=custom) |
| `minTrustScore` | Minimum trust score (0-100) |
| `maxCostUsd` | Maximum cost per task |
| `maxLatencyMs` | Maximum latency |
| `limit` | Max results (default 20, max 20) |

## Delegating Tasks

### 4-Phase Protocol

1. **REQUEST** — Requester sends task to target agent
2. **ACCEPT** — Target agent accepts the delegation
3. **EXECUTE** — Target agent processes the task
4. **RETURN** — Result is returned to the requester

### Send a Delegation

```bash
curl -X POST http://localhost:3000/api/delegation/delegate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "requester-agent",
    "targetAnonymousId": "target-anon-uuid",
    "taskType": "code-review",
    "input": {"code": "function foo() { return 1; }"},
    "timeoutMs": 30000,
    "fallbackEnabled": true,
    "maxRetries": 3
  }'
```

### Fallback

When `fallbackEnabled: true`, if the primary target fails/times out, AgentLens automatically tries the next-ranked discovery result, up to `maxRetries` times.

### Rate Limits

| Direction | Default | Configurable |
|-----------|---------|-------------|
| **Inbound** | 10/min per agent | Yes, per capability |
| **Outbound** | 20/min per agent | Yes, per capability |

## Trust Scoring

Trust scores are computed from two components:

```
trustScore = 0.6 × healthComponent + 0.4 × delegationSuccessRate
```

| Component | Source | Weight |
|-----------|--------|--------|
| **Health** | Average health score over 30 days | 60% |
| **Delegation** | Success rate of completed delegations | 40% |

- Scores below 10 completed delegations are marked **provisional**
- Trust percentile ranks agents within a tenant
- Minimum trust threshold is configurable per tenant (default: 60)

### View Trust Score

```bash
curl http://localhost:3000/api/trust/my-agent \
  -H "Authorization: Bearer $API_KEY"
```

Response:
```json
{
  "agentId": "my-agent",
  "rawScore": 72.5,
  "healthComponent": 80.0,
  "delegationComponent": 61.25,
  "percentile": 85,
  "provisional": false,
  "totalDelegations": 15,
  "successfulDelegations": 12
}
```

# Guardrails

Guardrails are automated safety rules that monitor your agents and take action when conditions are met. They protect against runaway costs, high error rates, degraded health, and custom metric violations.

## Concepts

### Conditions

A condition defines **what to watch**. When the condition evaluates to true, the guardrail triggers. AgentLens supports four condition types:

| Condition | Description | Key Config |
|---|---|---|
| `error_rate_threshold` | Fires when error rate exceeds a percentage | `threshold` (0–100), `windowMs` |
| `cost_limit` | Fires when cost exceeds a dollar amount | `maxCostUsd`, `periodMs` |
| `health_score_threshold` | Fires when health score drops below minimum | `minScore` (0–100), `dimension` |
| `custom_metric` | Fires on any numeric metric comparison | `metricKey`, `operator`, `value` |

### Actions

An action defines **what to do** when the condition fires:

| Action | Description | Key Config |
|---|---|---|
| `pause_agent` | Pauses the agent (sets `pausedAt`) | `reason` |
| `notify_webhook` | Sends a POST to a URL with trigger details | `url` |
| `downgrade_model` | Switches the agent to a cheaper model | `targetModel` |
| `agentgate_policy` | Applies an AgentGate approval policy | `policyId` |

### Dry Run

Every guardrail rule has a `dryRun` flag. When enabled:
- The condition is still evaluated
- The trigger is recorded in history
- **The action is NOT executed**

This lets you test rules safely before enabling enforcement.

### Cooldown

After a guardrail triggers, it enters a cooldown period (`cooldownMinutes`). During cooldown, the condition is still evaluated but won't trigger again. This prevents action storms.

## Creating Rules

### Via API

```bash
# Create a rule that pauses an agent when error rate exceeds 30%
curl -X POST http://localhost:3400/api/guardrails \
  -H "Authorization: Bearer als_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Error Rate - Pause",
    "conditionType": "error_rate_threshold",
    "conditionConfig": { "threshold": 30, "windowMs": 300000 },
    "actionType": "pause_agent",
    "actionConfig": { "reason": "Error rate exceeded 30%" },
    "cooldownMinutes": 15,
    "enabled": true,
    "dryRun": false
  }'

# Create a cost limit rule scoped to a specific agent
curl -X POST http://localhost:3400/api/guardrails \
  -H "Authorization: Bearer als_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Cost Cap",
    "agentId": "expensive-agent",
    "conditionType": "cost_limit",
    "conditionConfig": { "maxCostUsd": 50, "periodMs": 86400000 },
    "actionType": "notify_webhook",
    "actionConfig": { "url": "https://hooks.slack.com/your-webhook" },
    "cooldownMinutes": 60,
    "enabled": true,
    "dryRun": true
  }'
```

### Via CLI

```bash
# List all guardrail rules
npx @agentlensai/cli guardrails list

# Create a rule
npx @agentlensai/cli guardrails create \
  --name "Health Alert" \
  --condition health_score_threshold \
  --config '{"minScore": 50}' \
  --action notify_webhook \
  --action-config '{"url": "https://hooks.slack.com/..."}' \
  --cooldown 30

# Toggle a rule on/off
npx @agentlensai/cli guardrails toggle <rule-id>

# View trigger history
npx @agentlensai/cli guardrails history --limit 20

# Delete a rule
npx @agentlensai/cli guardrails delete <rule-id>
```

### Via Dashboard

1. Navigate to **Guardrails** in the sidebar
2. Click **+ Create Rule**
3. Fill in:
   - **Name** — descriptive label
   - **Agent** — scope to one agent or leave as "All Agents"
   - **Condition** — select type and configure thresholds
   - **Action** — select type and configure parameters
   - **Cooldown** — minutes between re-triggers
   - **Dry Run** — toggle for testing mode
4. Click **Create Rule**

## Condition Types in Detail

### Error Rate Threshold

Monitors the percentage of events with `severity: error` within a sliding time window.

```json
{
  "conditionType": "error_rate_threshold",
  "conditionConfig": {
    "threshold": 25,
    "windowMs": 600000
  }
}
```

- `threshold` — error rate percentage (0–100)
- `windowMs` — sliding window in milliseconds (default: 300000 = 5 min)

### Cost Limit

Monitors cumulative cost within a rolling period.

```json
{
  "conditionType": "cost_limit",
  "conditionConfig": {
    "maxCostUsd": 100,
    "periodMs": 86400000
  }
}
```

- `maxCostUsd` — maximum cost in USD
- `periodMs` — period in milliseconds (86400000 = 24 hours)

### Health Score Threshold

Monitors the agent's health score (computed from the 5-dimension health scoring system).

```json
{
  "conditionType": "health_score_threshold",
  "conditionConfig": {
    "minScore": 40,
    "dimension": "reliability"
  }
}
```

- `minScore` — minimum acceptable health score (0–100)
- `dimension` — optional: monitor a specific dimension instead of overall score

### Custom Metric

Monitors any numeric metric using a comparison operator.

```json
{
  "conditionType": "custom_metric",
  "conditionConfig": {
    "metricKey": "queue_depth",
    "operator": "gt",
    "value": 1000
  }
}
```

- `metricKey` — the metric identifier to watch
- `operator` — one of `gt`, `gte`, `lt`, `lte`, `eq`
- `value` — the threshold value

## Action Types in Detail

### Pause Agent

Sets the agent's `pausedAt` timestamp and `pauseReason`. Paused agents can be resumed via the API.

```json
{
  "actionType": "pause_agent",
  "actionConfig": {
    "reason": "Cost limit exceeded - manual review required"
  }
}
```

### Notify Webhook

Sends an HTTP POST with trigger details to the specified URL.

```json
{
  "actionType": "notify_webhook",
  "actionConfig": {
    "url": "https://hooks.slack.com/services/T.../B.../..."
  }
}
```

The webhook payload includes: rule name, condition type, current value, threshold, agent ID, timestamp, and dry-run status.

### Downgrade Model

Sets a `modelOverride` on the agent, directing it to use a cheaper model.

```json
{
  "actionType": "downgrade_model",
  "actionConfig": {
    "targetModel": "gpt-4o-mini"
  }
}
```

### AgentGate Policy

Applies an AgentGate approval policy to the agent, requiring human approval for subsequent actions.

```json
{
  "actionType": "agentgate_policy",
  "actionConfig": {
    "policyId": "require-approval-all"
  }
}
```

## Monitoring Triggers

### API

```bash
# List all trigger history
curl http://localhost:3400/api/guardrails/history?limit=50 \
  -H "Authorization: Bearer als_your_key"

# Get status for a specific rule (includes recent triggers)
curl http://localhost:3400/api/guardrails/<rule-id>/status \
  -H "Authorization: Bearer als_your_key"
```

### Dashboard

- **Guardrail List** (`/guardrails`) — shows trigger count and last triggered time for each rule
- **Guardrail Detail** (`/guardrails/:id`) — full rule config, runtime state, and trigger history table
- **Activity Feed** (`/guardrails/activity`) — real-time feed of all triggers across all rules with filtering

## Best Practices

1. **Start with dry run** — Always create new rules in dry-run mode first. Monitor for a few days to verify the condition triggers at the right threshold before enabling enforcement.

2. **Set appropriate cooldowns** — A 15-minute cooldown prevents action storms but still catches recurring issues. For cost rules, consider longer cooldowns (60+ minutes).

3. **Layer your guardrails** — Use multiple rules at different thresholds:
   - Warning at 20% error rate → webhook notification
   - Critical at 40% error rate → pause agent

4. **Scope to agents** — Global rules (no `agentId`) apply to all agents. Use agent-scoped rules for agent-specific thresholds.

5. **Monitor the Activity Feed** — Check `/guardrails/activity` regularly to understand trigger patterns and tune thresholds.

6. **Combine with health scores** — Use `health_score_threshold` for holistic monitoring that considers multiple dimensions, rather than watching individual metrics.

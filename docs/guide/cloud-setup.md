# AgentLens Cloud — Setup Guide

Get started with AgentLens Cloud in under 5 minutes. No server to deploy, no infrastructure to manage.

## 1. Sign Up

1. Go to [https://app.agentlens.ai](https://app.agentlens.ai)
2. Click **Sign Up** — authenticate with GitHub, Google, or email
3. You'll land on the **Organization Dashboard** with a default org created for you

## 2. Create Your First API Key

1. Navigate to **Settings → API Keys**
2. Click **Create API Key**
3. Give it a name (e.g., `dev-local`) and select a role (`admin` or `member`)
4. Copy the key (`als_cloud_...`) — **it's shown only once**

Or use the CLI:

```bash
npx @agentlensai/cli cloud login
npx @agentlensai/cli cloud keys create --name dev-local
```

## 3. Install the SDK

### Python

```bash
pip install agentlensai[all-providers]   # all 9 LLM providers
# or pick specific ones:
pip install agentlensai[openai]          # just OpenAI
pip install agentlensai[anthropic]       # just Anthropic
```

### TypeScript

```bash
npm install @agentlensai/sdk
```

## 4. Instrument Your Agent

### Python — Anthropic

```python
import agentlensai

agentlensai.init(
    cloud=True,
    api_key="als_cloud_your_key_here",
    agent_id="my-agent",
)

import anthropic
client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
# ^ Automatically captured: model, tokens, cost, latency, full prompt/completion

agentlensai.shutdown()
```

### Python — OpenAI

```python
import agentlensai

agentlensai.init(
    cloud=True,
    api_key="als_cloud_your_key_here",
    agent_id="my-agent",
)

import openai
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)

agentlensai.shutdown()
```

### Python — LiteLLM

```python
import agentlensai

agentlensai.init(
    cloud=True,
    api_key="als_cloud_your_key_here",
    agent_id="my-agent",
)

import litellm
response = litellm.completion(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)

agentlensai.shutdown()
```

### TypeScript

```typescript
import { AgentLensClient } from '@agentlensai/sdk';

const client = new AgentLensClient({
  cloud: true,
  apiKey: 'als_cloud_your_key_here',
});

const sessions = await client.getSessions();
console.log(sessions);
```

### Environment Variables

Instead of passing parameters directly, you can use environment variables:

```bash
export AGENTLENS_CLOUD=true
export AGENTLENS_API_KEY=als_cloud_your_key_here
export AGENTLENS_AGENT_ID=my-agent
```

```python
import agentlensai
agentlensai.init(cloud=True)  # picks up API key from env
```

## 5. Verify Your First Event

After running your instrumented code, verify data is flowing:

**Dashboard:** Open [https://app.agentlens.ai](https://app.agentlens.ai) → **Sessions** — you should see your session appear within seconds.

**CLI:**

```bash
npx @agentlensai/cli cloud sessions --limit 5
```

**SDK:**

```python
from agentlensai import AgentLensClient

client = AgentLensClient(cloud=True, api_key="als_cloud_your_key_here")
sessions = client.get_sessions(limit=5)
for s in sessions:
    print(f"{s.id} — {s.agent_id} — {s.status}")
client.close()
```

## 6. Dashboard Walkthrough

### Overview Page
The landing page shows live metrics: total sessions, events, errors, and active agents. The 24-hour timeline chart updates in real time.

### Sessions
Browse all agent sessions with sortable columns: agent name, status, start time, duration, event count, error count, and cost. Click any session to see its full timeline.

### LLM Analytics
View aggregate LLM metrics: total calls, cost, latency, and token usage. Break down by provider and model. Filter by agent or time range.

### Health Scores
Monitor agent reliability with 5-dimension health scoring (error rate, cost efficiency, tool success, latency, completion rate). Track trends over time.

### API Keys
Manage your API keys: create, revoke, and see last-used timestamps. Each key is scoped to your organization.

### Team Management
Invite team members, assign roles (`owner`, `admin`, `member`), and manage organization settings.

### Usage & Billing
View current usage (events ingested, storage), plan limits, and billing history. Upgrade or manage your subscription.

## Troubleshooting

### "401 Unauthorized" on event ingestion

- **Check your API key** — ensure it starts with `als_cloud_` and hasn't been revoked
- **Check the environment** — run `echo $AGENTLENS_API_KEY` to confirm it's set
- **Key might be expired** — create a new one in the dashboard

### Events not appearing in dashboard

- **Call `agentlensai.shutdown()`** — the SDK batches events and flushes on shutdown. Without it, the last batch may not be sent.
- **Check network** — ensure your machine can reach `https://api.agentlens.ai`
- **Check agent_id** — filter by the correct agent in the dashboard
- **Sync mode for debugging** — use `agentlensai.init(cloud=True, api_key="...", sync_mode=True)` to send events synchronously and see errors immediately

### "429 Too Many Requests"

You've hit the rate limit for your plan. Options:
- Wait and retry (the SDK has built-in retry with exponential backoff)
- Upgrade your plan for higher limits
- Reduce event volume by filtering what you instrument

### SSL/TLS errors

- Ensure your Python/Node.js has up-to-date CA certificates
- If behind a corporate proxy, configure `HTTPS_PROXY` environment variable

### "Connection refused" or timeouts

- Verify you're using `cloud=True` (not pointing at `localhost`)
- Check firewall rules — outbound HTTPS (port 443) to `api.agentlens.ai` must be allowed

### SDK version mismatch

Cloud mode requires `agentlensai >= 0.11.0`. Upgrade:

```bash
pip install --upgrade agentlensai
# or
npm install @agentlensai/sdk@latest
```

## Next Steps

- [SDK Migration Guide](./cloud-migration.md) — migrating from self-hosted to cloud
- [API Reference](../reference/api.md) — full REST API documentation
- [Agent Memory Guide](./agent-memory.md) — memory, recall, and lessons

# AgentLens Cloud — Migration Guide

Migrate from a self-hosted AgentLens instance to AgentLens Cloud. The process takes about 5 minutes per agent — all your instrumentation code stays the same.

## What Changes

| Aspect | Self-Hosted | Cloud |
|---|---|---|
| **Server** | You run `@agentlensai/server` | Managed at `api.agentlens.ai` |
| **Init parameter** | `url="http://localhost:3400"` | `cloud=True` |
| **API key format** | `als_...` (local) | `als_cloud_...` (cloud) |
| **Database** | Local SQLite | Managed Postgres (multi-tenant) |
| **Dashboard** | `http://localhost:3400` | `https://app.agentlens.ai` |

## What Stays the Same

**Everything about your instrumentation is unchanged:**

- ✅ All auto-instrumented providers (OpenAI, Anthropic, LiteLLM, Bedrock, Vertex, Gemini, Mistral, Cohere, Ollama)
- ✅ MCP server integration (Claude Desktop, Cursor)
- ✅ All SDK methods (`get_sessions`, `get_llm_analytics`, `recall`, `learn`, etc.)
- ✅ Event types, session lifecycle, hash chain verification
- ✅ Health scores, cost optimization, benchmarks, guardrails
- ✅ Agent memory (recall, lessons, reflect, context)
- ✅ Framework plugins (LangChain, CrewAI, AutoGen, Semantic Kernel)
- ✅ Redaction (`redact=True`) and privacy controls

## Step-by-Step Migration

### 1. Sign up for AgentLens Cloud

Go to [https://app.agentlens.ai](https://app.agentlens.ai) and create an account. See the [Cloud Setup Guide](./cloud-setup.md) for details.

### 2. Create a cloud API key

In the dashboard: **Settings → API Keys → Create API Key**. Copy the `als_cloud_...` key.

### 3. Update SDK version

Cloud mode requires `agentlensai >= 0.11.0`:

```bash
pip install --upgrade agentlensai
# or
npm install @agentlensai/sdk@latest
```

### 4. Update your init call

**Before (self-hosted):**

```python
import agentlensai

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_local_key",
    agent_id="my-agent",
)
```

**After (cloud):**

```python
import agentlensai

agentlensai.init(
    cloud=True,
    api_key="als_cloud_your_key_here",
    agent_id="my-agent",
)
```

That's it. One parameter changes (`url` → `cloud=True`), plus the new API key. Everything else stays identical.

**TypeScript — Before:**

```typescript
const client = new AgentLensClient({
  baseUrl: 'http://localhost:3400',
  apiKey: 'als_your_local_key',
});
```

**TypeScript — After:**

```typescript
const client = new AgentLensClient({
  cloud: true,
  apiKey: 'als_cloud_your_key_here',
});
```

### 5. Update environment variables (if used)

**Before:**

```bash
export AGENTLENS_SERVER_URL=http://localhost:3400
export AGENTLENS_API_KEY=als_your_local_key
```

**After:**

```bash
export AGENTLENS_CLOUD=true
export AGENTLENS_API_KEY=als_cloud_your_key_here
# Remove AGENTLENS_SERVER_URL — not needed with cloud=True
unset AGENTLENS_SERVER_URL
```

### 6. Update MCP configuration (if used)

**Before (Claude Desktop / Cursor):**

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_local_key"
      }
    }
  }
}
```

**After:**

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_CLOUD": "true",
        "AGENTLENS_API_KEY": "als_cloud_your_key_here"
      }
    }
  }
}
```

## Verify Migration

Run your agent and confirm data appears in the cloud dashboard:

```python
import agentlensai

agentlensai.init(cloud=True, api_key="als_cloud_your_key_here", agent_id="my-agent")

# Trigger one LLM call
import openai
client = openai.OpenAI()
client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Migration test"}],
)

agentlensai.shutdown()
print("Check https://app.agentlens.ai — you should see the session.")
```

Or use the CLI:

```bash
npx @agentlensai/cli cloud sessions --limit 1
```

## Migrate Historical Data (Optional)

To export data from your self-hosted instance and import into cloud:

```bash
# Export from self-hosted
npx @agentlensai/cli export --output agentlens-export.json

# Import to cloud
npx @agentlensai/cli cloud import --file agentlens-export.json --api-key als_cloud_your_key_here
```

> **Note:** The import preserves session IDs, event data, and hash chains. Lessons and memory are included.

## Rollback to Self-Hosted

If you need to switch back, reverse the changes:

1. **Revert init call:**

```python
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_local_key",
    agent_id="my-agent",
)
```

2. **Revert environment variables:**

```bash
export AGENTLENS_SERVER_URL=http://localhost:3400
export AGENTLENS_API_KEY=als_your_local_key
unset AGENTLENS_CLOUD
```

3. **Restart your self-hosted server:**

```bash
npx @agentlensai/server
```

4. **Revert MCP config** (if applicable) — restore the `AGENTLENS_API_URL` entry.

Your self-hosted instance and data remain intact throughout. Cloud and self-hosted can even run side-by-side during a transition period if you keep both API keys active.

## FAQ

**Can I run cloud and self-hosted simultaneously?**
Yes. Use different `agent_id` values or separate init calls. This is useful for a gradual migration.

**Is my data encrypted in transit?**
Yes. All communication with `api.agentlens.ai` uses TLS 1.3.

**What about data residency?**
AgentLens Cloud runs in US regions by default. Contact us for EU or other region requirements.

**Do I still need the server package?**
No. With `cloud=True`, you don't need to run `@agentlensai/server`. You only need the SDK (`agentlensai` for Python or `@agentlensai/sdk` for TypeScript).

## Next Steps

- [Cloud Setup Guide](./cloud-setup.md) — full setup walkthrough
- [API Reference](../reference/api.md) — REST API documentation

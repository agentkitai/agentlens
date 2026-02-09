# Getting Started

Get AgentLens running and capturing agent events in under 5 minutes.

## Prerequisites

- **Node.js** ≥ 20.0.0
- An MCP-compatible AI agent (Claude Desktop, Cursor, or any MCP client)

## Step 1: Start the Server

The fastest way to start is with `npx`:

```bash
npx @agentlensai/server
```

The server starts on **http://localhost:3400** with a SQLite database (no external dependencies).

You'll see:

```
🔍 AgentLens server listening on http://localhost:3400
📦 Database: ./agentlens.db (SQLite WAL mode)
🔓 Auth: disabled (set AUTH_DISABLED=false for production)
```

::: tip Production Setup
For production, install it as a dependency:

```bash
npm install @agentlensai/server
# or
pnpm add @agentlensai/server
```
:::

## Step 2: Create an API Key

API keys authenticate your agents with the AgentLens server.

```bash
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-first-agent"}'
```

Response:

```json
{
  "id": "01HXYZ...",
  "key": "als_a1b2c3d4e5f6...",
  "name": "my-first-agent",
  "scopes": ["*"],
  "createdAt": "2026-02-08T00:00:00.000Z"
}
```

::: warning Save your key!
The raw API key (`als_...`) is only shown once. Copy it now — the server stores only a SHA-256 hash.
:::

## Step 3: Configure Your MCP Agent

Add AgentLens as an MCP server in your agent's configuration.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here",
        "AGENTLENS_AGENT_NAME": "claude-desktop"
      }
    }
  }
}
```

### Cursor

Edit `.cursor/mcp.json` in your project root (or globally in `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here",
        "AGENTLENS_AGENT_NAME": "cursor-agent"
      }
    }
  }
}
```

### Custom MCP Agent

If you're building your own agent with the MCP SDK:

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here",
        "AGENTLENS_AGENT_NAME": "my-custom-agent",
        "AGENTLENS_AGENT_VERSION": "1.0.0",
        "AGENTLENS_ENVIRONMENT": "development"
      }
    }
  }
}
```

## Step 4: Use AgentLens Tools in Your Agent

Once connected, the agent can use these MCP tools:

### Start a Session

```
Tool: agentlens_session_start
Arguments: { "agentId": "my-agent", "agentName": "My Agent", "tags": ["dev"] }
→ Returns: { "sessionId": "01HXYZ..." }
```

### Log Events

```
Tool: agentlens_log_event
Arguments: {
  "sessionId": "01HXYZ...",
  "eventType": "tool_call",
  "payload": { "toolName": "search", "callId": "c1", "arguments": { "query": "test" } }
}
```

### End a Session

```
Tool: agentlens_session_end
Arguments: { "sessionId": "01HXYZ...", "reason": "completed" }
```

### Query Events (Agent Self-Inspection)

```
Tool: agentlens_query_events
Arguments: { "sessionId": "01HXYZ...", "limit": 10 }
→ Returns: array of recent events in this session
```

## Step 5: Open the Dashboard

Navigate to **http://localhost:3400** in your browser.

You'll see:

- **Overview** — Metrics grid with total sessions, events, error rates, and cost
- **Sessions** — List of all agent sessions with status, duration, and event counts
- **Session Detail** — Click any session to see a vertical timeline of every event
- **Events Explorer** — Filterable list of all events across all sessions
- **Analytics** — Charts for event trends, cost breakdown, and agent comparisons
- **Alerts** — Configure and view alert rules and history

## Alternative: Python Auto-Instrumentation

If you're building in Python, you can skip MCP entirely and use **auto-instrumentation** — one line captures every LLM call across 9 providers:

```bash
pip install agentlensai[all-providers]   # all 9 providers
# or pick specific ones:
pip install agentlensai[openai]          # just OpenAI
pip install agentlensai[bedrock,ollama]  # Bedrock + Ollama
```

```python
import agentlensai

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-agent",
    integrations="auto",  # auto-discovers all installed provider SDKs
)

# Every LLM call is now captured automatically
import openai
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
# ^ Logged: model, tokens, cost, latency, full prompt/completion

agentlensai.shutdown()
```

Supported providers: OpenAI, Anthropic, LiteLLM, AWS Bedrock, Google Vertex AI, Google Gemini, Mistral AI, Cohere, and Ollama. See the [Python SDK README](../../packages/python-sdk/README.md) for full provider documentation.

## Next Steps

- [Configuration Reference](/guide/configuration) — Environment variables and options
- [MCP Integration Guide](/guide/mcp-integration) — Deep dive into the MCP server
- [API Reference](/reference/api) — Full REST API documentation
- [Integrations](/guide/integrations) — Connect AgentGate and FormBridge

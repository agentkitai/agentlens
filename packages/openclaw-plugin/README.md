# AgentLens OpenClaw Plugin

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that automatically captures LLM API calls and relays telemetry to [AgentLens](https://github.com/agentkitai/agentlens).

## What it does

- Intercepts all Anthropic API calls made by OpenClaw
- Captures request metadata (model, prompt preview, tool count)
- Captures response data (tokens, cost, latency, finish reason)
- Extracts individual tool calls
- Posts structured events to your AgentLens instance

## Events emitted

| Event Type | Data |
|-----------|------|
| `llm_call` | Model, prompt preview, message count, tools available |
| `llm_response` | Token usage, cost (USD), latency, finish reason |
| `tool_call` | Tool name, call ID |

## Setup

### 1. Install the plugin

Copy this directory into your OpenClaw extensions folder:

```bash
cp -r packages/openclaw-plugin /usr/lib/node_modules/openclaw/extensions/agentlens-relay
```

### 2. Enable in OpenClaw config

```bash
openclaw config patch '{"plugins":{"entries":{"agentlens-relay":{"enabled":true}}}}'
```

### 3. Make sure AgentLens is running

The plugin sends events to `http://localhost:3000` by default. Override with:

```bash
export AGENTLENS_URL=http://your-agentlens:3000
export AGENTLENS_AGENT_ID=your-agent-id
```

### 4. Restart OpenClaw

```bash
openclaw gateway restart
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTLENS_URL` | `http://localhost:3000` | AgentLens server URL |
| `AGENTLENS_AGENT_ID` | `openclaw-brad` | Agent identifier for events |

## How it works

The plugin wraps `globalThis.fetch` to intercept HTTP requests to `api.anthropic.com`. It uses `ReadableStream.tee()` to split the response stream — one branch goes to OpenClaw normally, the other is read in the background for telemetry extraction.

No proxy server, no preload scripts, no external processes. Just a single in-process plugin.

## Debug

Check `/tmp/agentlens-relay-debug.log` for detailed capture logs.

## License

MIT

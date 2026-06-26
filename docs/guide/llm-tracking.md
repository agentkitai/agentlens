# LLM Call Tracking

Track every prompt sent to an LLM and every completion received — with full cost, latency, and token visibility.

## Overview

LLM Call Tracking adds first-class `llm_call` and `llm_response` event types to AgentLens. Instead of treating LLM interactions as opaque black boxes, you get complete observability into:

- **Prompt visibility** — See exactly what messages were sent to each model
- **Completion inspection** — Read model responses, including tool calls
- **Cost tracking** — Per-call and aggregate cost in USD, broken down by model and provider
- **Latency monitoring** — Measure response times across models and spot slowdowns
- **Token accounting** — Input, output, thinking, and cache token breakdowns

This complements the existing `cost_tracked` event type (which remains valid for backward compatibility) by adding the full prompt/completion content alongside cost data.

## Auto-Instrumentation (Recommended)

The easiest way to capture LLM calls is **Python auto-instrumentation** — zero manual logging needed:

```bash
pip install agentlensai[all-providers]
```

```python
import agentlensai

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-agent",
    integrations="auto",  # auto-discovers all installed provider SDKs
)

# Every LLM call is now captured automatically across 9 providers:
# OpenAI, Anthropic, LiteLLM, Bedrock, Vertex AI, Gemini, Mistral, Cohere, Ollama
```

This captures prompts, completions, tokens, cost, and latency with zero code changes to your LLM calls. See the [Python SDK docs](../../packages/python-sdk/README.md) for per-provider examples.

The sections below cover **manual logging** via the SDK and MCP — useful when auto-instrumentation isn't available (e.g., TypeScript apps) or when you need fine-grained control.

## Quick Start (Manual)

The fastest way to manually log an LLM call is with the SDK:

```typescript
import { AgentLensClient } from '@agentkitai/agentlens-sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

await client.logLlmCall('session_01', 'my-agent', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'What is the capital of France?' },
  ],
  completion: 'The capital of France is Paris.',
  finishReason: 'stop',
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  costUsd: 0.0003,
  latencyMs: 450,
});
```

This single call emits **two paired events** — an `llm_call` with the request and an `llm_response` with the completion — linked by a shared `callId`.

## Event Types

LLM tracking uses two event types that mirror the existing `tool_call` / `tool_response` pattern:

### `llm_call`

Recorded when a request is sent to an LLM provider.

| Field | Type | Required | Description |
|---|---|---|---|
| `callId` | string | ✅ | Correlation ID to match with the response |
| `provider` | string | ✅ | Provider name (`anthropic`, `openai`, `google`) |
| `model` | string | ✅ | Model identifier (`claude-sonnet-4-20250514`, `gpt-4o`) |
| `messages` | LlmMessage[] | ✅ | The prompt messages sent to the model |
| `systemPrompt` | string | — | System prompt (if separate from messages) |
| `parameters` | object | — | Model parameters (`temperature`, `maxTokens`, etc.) |
| `tools` | array | — | Tool/function definitions provided to the model |
| `redacted` | boolean | — | If `true`, prompt content was stripped for privacy |

### `llm_response`

Recorded when the completion is received from the provider.

| Field | Type | Required | Description |
|---|---|---|---|
| `callId` | string | ✅ | Correlation ID matching the `llm_call` |
| `provider` | string | ✅ | Provider name |
| `model` | string | ✅ | Model used (may differ from requested if auto-routed) |
| `completion` | string \| null | ✅ | The completion content |
| `toolCalls` | array | — | Tool calls requested by the model |
| `finishReason` | string | ✅ | `stop`, `length`, `tool_use`, `content_filter`, or `error` |
| `usage` | object | ✅ | Token counts (see below) |
| `costUsd` | number | ✅ | Cost in USD |
| `latencyMs` | number | ✅ | End-to-end latency in milliseconds |
| `redacted` | boolean | — | If `true`, completion content was stripped |

#### Token Usage Object

| Field | Type | Required | Description |
|---|---|---|---|
| `inputTokens` | number | ✅ | Prompt/input tokens |
| `outputTokens` | number | ✅ | Completion/output tokens |
| `totalTokens` | number | ✅ | Total tokens |
| `thinkingTokens` | number | — | Reasoning/thinking tokens (if applicable) |
| `cacheReadTokens` | number | — | Cache read tokens |
| `cacheWriteTokens` | number | — | Cache write tokens |

### How Pairing Works

Both events share the same `callId` (a UUID). The dashboard and analytics engine use this to:

1. Display them as a single expandable node in the timeline
2. Calculate latency (from the `latencyMs` field on the response)
3. Correlate prompt content with completion content

```
llm_call  { callId: "abc-123", model: "gpt-4o", messages: [...] }
    ↕  paired by callId
llm_response  { callId: "abc-123", model: "gpt-4o", completion: "...", latencyMs: 1200 }
```

## Using the SDK

The `logLlmCall()` method is the recommended way to log LLM interactions. It handles event pairing automatically.

```typescript
import { AgentLensClient } from '@agentkitai/agentlens-sdk';

const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_your_key',
});

// Log a complete LLM call with all details
const { callId } = await client.logLlmCall('session_01', 'my-agent', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Summarize this document...' },
  ],
  systemPrompt: 'You are a helpful assistant.',
  completion: 'Here is the summary: ...',
  finishReason: 'stop',
  usage: {
    inputTokens: 1500,
    outputTokens: 800,
    totalTokens: 2300,
    thinkingTokens: 0,
  },
  costUsd: 0.0092,
  latencyMs: 1350,
  parameters: {
    temperature: 0.7,
    maxTokens: 4096,
  },
  tools: [
    {
      name: 'search_database',
      description: 'Search the internal database',
      parameters: { query: { type: 'string' } },
    },
  ],
});

console.log(`Logged LLM call: ${callId}`);
```

Internally, this sends two events (`llm_call` + `llm_response`) in a single batch request.

## Using MCP

The MCP server exposes an `agentlens_log_llm_call` tool that agents can call directly. This is ideal for agents that integrate via MCP rather than the SDK.

### `agentlens_log_llm_call`

Log a complete LLM interaction (request + response) in a single call.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | ✅ | Active session ID |
| `provider` | string | ✅ | Provider name |
| `model` | string | ✅ | Model identifier |
| `messages` | array | ✅ | Prompt messages |
| `systemPrompt` | string | — | System prompt |
| `completion` | string \| null | ✅ | Model response |
| `toolCalls` | array | — | Tool calls from the model |
| `finishReason` | string | ✅ | Stop reason |
| `usage` | object | ✅ | `{ inputTokens, outputTokens, totalTokens }` |
| `costUsd` | number | ✅ | Cost in USD |
| `latencyMs` | number | ✅ | Latency in milliseconds |
| `parameters` | object | — | Model parameters |
| `tools` | array | — | Tool definitions provided |

**Returns:** `{ callId: string, eventsLogged: 2 }`

Example MCP tool call:

```json
{
  "tool": "agentlens_log_llm_call",
  "arguments": {
    "sessionId": "01HXYZ...",
    "provider": "openai",
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ],
    "completion": "Hello! How can I help you today?",
    "finishReason": "stop",
    "usage": { "inputTokens": 5, "outputTokens": 9, "totalTokens": 14 },
    "costUsd": 0.0001,
    "latencyMs": 320
  }
}
```

## Privacy / Redaction

For sensitive prompts, use the `redact: true` option to strip prompt and completion content before storage. Only metadata (model, tokens, cost, latency) is retained.

### SDK

```typescript
await client.logLlmCall('session_01', 'my-agent', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'My SSN is 123-45-6789...' },
  ],
  completion: 'I see your SSN is...',
  finishReason: 'stop',
  usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
  costUsd: 0.001,
  latencyMs: 500,
  redact: true, // ← Content will be replaced with [REDACTED]
});
```

When `redact: true` is set:

- All message `content` fields are replaced with `[REDACTED]`
- The `systemPrompt` is replaced with `[REDACTED]`
- The `completion` is replaced with `[REDACTED]`
- A `redacted: true` flag is set on both events
- Token counts, cost, latency, model, and provider are **preserved**

This lets you track LLM usage and costs without storing sensitive content.

## Analytics

### REST Endpoint

#### `GET /api/analytics/llm`

Returns aggregated LLM metrics including summary stats, per-model breakdown, and time series.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | 24h ago | Start of time range (ISO 8601) |
| `to` | string | now | End of time range (ISO 8601) |
| `granularity` | string | `hour` | Bucket size: `hour`, `day`, or `week` |
| `agentId` | string | — | Filter by agent |
| `model` | string | — | Filter by model |
| `provider` | string | — | Filter by provider |

**Response:**

```json
{
  "summary": {
    "totalCalls": 42,
    "totalCostUsd": 12.34,
    "totalInputTokens": 150000,
    "totalOutputTokens": 50000,
    "avgLatencyMs": 1250,
    "avgCostPerCall": 0.29
  },
  "byModel": [
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "calls": 20,
      "costUsd": 8.50,
      "inputTokens": 100000,
      "outputTokens": 30000,
      "avgLatencyMs": 1500
    }
  ],
  "byTime": [
    {
      "bucket": "2026-02-08T10:00:00Z",
      "calls": 5,
      "costUsd": 1.20,
      "inputTokens": 15000,
      "outputTokens": 5000,
      "avgLatencyMs": 900
    }
  ]
}
```

**curl Example:**

```bash
curl "http://localhost:3400/api/analytics/llm?from=2026-02-01&granularity=day" \
  -H "Authorization: Bearer als_your_key"
```

### SDK Method

```typescript
const analytics = await client.getLlmAnalytics({
  from: '2026-02-01',
  to: '2026-02-08',
  granularity: 'day',
  model: 'claude-sonnet-4-20250514',
});

console.log(`Total calls: ${analytics.summary.totalCalls}`);
console.log(`Total cost: $${analytics.summary.totalCostUsd.toFixed(2)}`);
console.log(`Avg latency: ${analytics.summary.avgLatencyMs}ms`);
```

## CLI

The `agentlens llm` command provides quick access to LLM metrics from the terminal.

### `agentlens llm stats`

Show an overall LLM usage summary:

```bash
$ agentlens llm stats

LLM Usage Summary
  Total Calls:     42
  Total Cost:      $12.34
  Total Tokens:    200,000 (150,000 in / 50,000 out)
  Avg Latency:     1,250ms
  Avg Cost/Call:   $0.29
```

### `agentlens llm models`

List models used with cost breakdown:

```bash
$ agentlens llm models

 Provider  │ Model                │ Calls │ Tokens  │ Cost    │ Avg Latency
───────────┼──────────────────────┼───────┼─────────┼─────────┼────────────
 anthropic │ claude-sonnet-4-20250514   │ 20    │ 130,000 │ $8.50   │ 1,500ms
 openai    │ gpt-4o               │ 15    │ 50,000  │ $3.00   │ 900ms
 google    │ gemini-pro           │ 7     │ 20,000  │ $0.84   │ 1,100ms
```

### `agentlens llm recent`

Show recent LLM calls:

```bash
$ agentlens llm recent

 Timestamp        │ Model              │ Tokens │ Cost    │ Latency │ Finish
──────────────────┼────────────────────┼────────┼─────────┼─────────┼────────
 Feb 08, 11:42:15 │ claude-sonnet-4-20250514 │ 2,300  │ $0.009  │ 1,350ms │ stop
 Feb 08, 11:41:02 │ gpt-4o             │ 1,800  │ $0.005  │ 890ms   │ stop
 Feb 08, 11:39:55 │ claude-sonnet-4-20250514 │ 4,100  │ $0.016  │ 2,100ms │ tool_use
```

### Common Flags

All subcommands support:

| Flag | Description |
|---|---|
| `--from <date>` | Start date (ISO 8601) |
| `--to <date>` | End date (ISO 8601) |
| `--agent <id>` | Filter by agent ID |
| `--model <name>` | Filter by model name |
| `--url <url>` | Server URL (default: from config or `http://localhost:3400`) |
| `--json` | Output raw JSON |
| `--help` | Show help |

## Dashboard

### LLM Analytics Page

The dashboard includes an **LLM Analytics** page (accessible from the sidebar under "Prompts") with:

- **Summary cards** — Total LLM calls, total cost, average latency, tokens used
- **Cost by model chart** — Stacked bar chart showing cost distribution across models
- **Latency distribution** — Histogram showing p50/p90/p99 latencies
- **Model comparison table** — Sortable table with provider, model, call count, tokens, cost, and average latency
- **Time series** — LLM calls over time with cost overlay

Use the date range picker and agent/model/provider filters to narrow the view.

### Prompt Viewer

Click any `llm_call` / `llm_response` pair in the session timeline to open the detail panel:

- **Prompt tab** — Messages displayed in chat-bubble style (user messages left-aligned, assistant messages right-aligned, tool messages monospaced)
- **Completion tab** — Model response with syntax highlighting for code blocks
- **Metadata tab** — Provider, model, parameters, token breakdown (input/output/thinking/cache), cost, latency
- **Tools tab** — Tool definitions provided to the model (if any)

Each item has a copy-to-clipboard button for easy extraction.

## Provider Examples

### OpenAI

```typescript
import OpenAI from 'openai';

const openai = new OpenAI();

const start = Date.now();
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
const latencyMs = Date.now() - start;

await client.logLlmCall('session_01', 'my-agent', {
  provider: 'openai',
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
  completion: response.choices[0]?.message?.content ?? null,
  finishReason: response.choices[0]?.finish_reason ?? 'stop',
  usage: {
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  },
  costUsd: calculateOpenAICost(response.usage, 'gpt-4o'),
  latencyMs,
});
```

### Anthropic

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const start = Date.now();
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
const latencyMs = Date.now() - start;

await client.logLlmCall('session_01', 'my-agent', {
  provider: 'anthropic',
  model: response.model,
  messages: [{ role: 'user', content: 'Hello!' }],
  completion: response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(''),
  finishReason: response.stop_reason ?? 'stop',
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  },
  costUsd: calculateAnthropicCost(response.usage, response.model),
  latencyMs,
});
```

### Google (Gemini)

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

const start = Date.now();
const result = await model.generateContent('Hello!');
const latencyMs = Date.now() - start;

const response = result.response;
const usage = response.usageMetadata;

await client.logLlmCall('session_01', 'my-agent', {
  provider: 'google',
  model: 'gemini-pro',
  messages: [{ role: 'user', content: 'Hello!' }],
  completion: response.text(),
  finishReason: response.candidates?.[0]?.finishReason ?? 'stop',
  usage: {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
  },
  costUsd: calculateGeminiCost(usage, 'gemini-pro'),
  latencyMs,
});
```

::: tip
The cost calculation functions (`calculateOpenAICost`, `calculateAnthropicCost`, `calculateGeminiCost`) are not provided by AgentLens — implement them based on your provider's pricing page, or use a library like [llm-cost](https://www.npmjs.com/package/llm-cost).
:::

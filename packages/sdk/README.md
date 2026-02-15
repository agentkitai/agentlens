# @agentlensai/sdk

TypeScript SDK for the AgentLens observability API.

## Installation

```bash
npm install @agentlensai/sdk
```

## Quick Start

```ts
import { AgentLensClient } from '@agentlensai/sdk';

const client = AgentLensClient.fromEnv();

// Check server health
const health = await client.health();
console.log(health.status); // "ok"

// Query events
const { events, total } = await client.queryEvents({
  agentId: 'my-agent',
  limit: 10,
});
```

## Configuration

### `fromEnv()` — Zero-Config Setup

```ts
const client = AgentLensClient.fromEnv();
```

Reads from environment variables:

| Env Var | Default | Description |
|---------|---------|-------------|
| `AGENTLENS_SERVER_URL` | `http://localhost:3400` | Server URL |
| `AGENTLENS_API_KEY` | — | API key |

Override any value:

```ts
const client = AgentLensClient.fromEnv({
  url: 'https://api.agentlens.ai',
  apiKey: 'als_xxx',
});
```

### Constructor Options

```ts
const client = new AgentLensClient({
  url: 'http://localhost:3400',
  apiKey: 'als_xxx',
  timeout: 30_000,
  retry: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 30000 },
  failOpen: false,
  onError: (err) => console.warn(err.message),
});
```

## Retry Configuration

Built-in exponential backoff with jitter. Retries on:
- Network errors / timeouts
- `429 Too Many Requests` (respects `Retry-After` header)
- `503 Service Unavailable` (backpressure)

Never retries: `400`, `401`, `402`, `404`.

```ts
const client = new AgentLensClient({
  url: 'http://localhost:3400',
  retry: {
    maxRetries: 5,
    backoffBaseMs: 500,
    backoffMaxMs: 60_000,
  },
});
```

## Fail-Open Mode

When `failOpen: true`, all methods catch errors and return safe defaults (`undefined`) instead of throwing. Ideal for production where observability should never crash your app.

```ts
const client = new AgentLensClient({
  url: 'http://localhost:3400',
  failOpen: true,
  onError: (err) => myLogger.warn('AgentLens error:', err.message),
});

// This won't throw even if the server is down
const events = await client.queryEvents({ agentId: 'my-agent' });
```

## Error Handling

All errors extend `AgentLensError`:

```ts
import {
  AgentLensError,
  AuthenticationError,   // 401
  NotFoundError,         // 404
  ValidationError,       // 400
  ConnectionError,       // network/timeout
  RateLimitError,        // 429 (has .retryAfter)
  QuotaExceededError,    // 402
  BackpressureError,     // 503
} from '@agentlensai/sdk';

try {
  await client.getEvent('bad-id');
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log('Event not found');
  } else if (err instanceof RateLimitError) {
    console.log(`Retry after ${err.retryAfter}s`);
  }
}
```

## API Reference

### Events

| Method | Description |
|--------|-------------|
| `queryEvents(query?)` | Query events with filters and pagination |
| `getEvent(id)` | Get a single event by ID |

### Sessions

| Method | Description |
|--------|-------------|
| `getSessions(query?)` | Query sessions with filters |
| `getSession(id)` | Get a single session |
| `getSessionTimeline(sessionId)` | Full event timeline with hash chain verification |

### LLM Call Tracking

| Method | Description |
|--------|-------------|
| `logLlmCall(sessionId, agentId, params)` | Log a complete LLM call (request + response). Supports `redact: true` |
| `getLlmAnalytics(params?)` | Aggregate metrics by model, time, provider |

```ts
const { callId } = await client.logLlmCall('session-1', 'my-agent', {
  provider: 'openai',
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  completion: 'Hi there!',
  finishReason: 'stop',
  usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  costUsd: 0.001,
  latencyMs: 450,
  redact: false,
});
```

### Recall (Semantic Search)

| Method | Description |
|--------|-------------|
| `recall(query)` | Semantic search over embeddings |

### Reflect (Pattern Analysis)

| Method | Description |
|--------|-------------|
| `reflect(query)` | Analyze patterns across sessions |

### Context

| Method | Description |
|--------|-------------|
| `getContext(query)` | Cross-session context for a topic |

### Agents & Health

| Method | Description |
|--------|-------------|
| `getAgent(agentId)` | Get agent details |
| `getHealth(agentId, window?)` | Health score for an agent |
| `getHealthOverview(window?)` | Health overview for all agents |
| `getHealthHistory(agentId, days?)` | Historical health snapshots |

### Optimization

| Method | Description |
|--------|-------------|
| `getOptimizationRecommendations(options?)` | Cost optimization recommendations |

### Guardrails

| Method | Description |
|--------|-------------|
| `listGuardrails(options?)` | List all guardrail rules |
| `getGuardrail(id)` | Get a guardrail rule |
| `createGuardrail(params)` | Create a guardrail rule |
| `updateGuardrail(id, updates)` | Update a guardrail rule |
| `deleteGuardrail(id)` | Delete a guardrail rule |
| `enableGuardrail(id)` | Enable a guardrail rule |
| `disableGuardrail(id)` | Disable a guardrail rule |
| `getGuardrailHistory(options?)` | Trigger history |
| `getGuardrailStatus(id)` | Status + recent triggers |

### Server

| Method | Description |
|--------|-------------|
| `health()` | Server health check (no auth) |

## Lessons API (Deprecated)

Lesson methods have been removed. Use [lore-sdk](https://github.com/amitpaz1/lore) directly.

```ts
// ❌ Old
await client.createLesson(...); // throws

// ✅ New
import { LoreClient } from 'lore-sdk';
const lore = new LoreClient();
await lore.createLesson(...);
```

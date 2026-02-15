# AgentLens Migration Guide

## Lessons API → lore-sdk

**The Lessons API is deprecated and will be removed in a future release.**

All lesson methods (`createLesson`, `getLessons`, `getLesson`, `updateLesson`, `deleteLesson`) now throw an error in the TypeScript SDK and emit deprecation warnings in the Python SDK.

Migrate to [lore-sdk](https://github.com/amitpaz1/lore):

### TypeScript

```bash
npm install lore-sdk
```

```ts
// ❌ Before
import { AgentLensClient } from '@agentlensai/sdk';
const client = AgentLensClient.fromEnv();
await client.createLesson({ ... }); // throws!

// ✅ After
import { LoreClient } from 'lore-sdk';
const lore = new LoreClient();
await lore.createLesson({ ... });
```

### Python

```bash
pip install lore-sdk
```

```python
# ❌ Before
from agentlensai import AgentLensClient
client = AgentLensClient("http://localhost:3400")
client.create_lesson(...)  # deprecated

# ✅ After
from lore_sdk import LoreClient
lore = LoreClient()
lore.create_lesson(...)
```

## Environment Variable Support

Both SDKs now read configuration from environment variables:

| Env Var | Description |
|---------|-------------|
| `AGENTLENS_SERVER_URL` | Server URL (default: `http://localhost:3400`) |
| `AGENTLENS_API_KEY` | API key for authentication |

**TypeScript:**

```ts
// Reads AGENTLENS_SERVER_URL and AGENTLENS_API_KEY automatically
const client = AgentLensClient.fromEnv();
```

**Python:**

```python
# Reads env vars automatically
import agentlensai
agentlensai.init(agent_id="my-agent")
```

## New Error Classes

Both SDKs now provide typed error classes for precise error handling:

| Error | HTTP Status | Description |
|-------|-------------|-------------|
| `AgentLensError` | — | Base error class |
| `AuthenticationError` | 401 | Invalid or missing API key |
| `NotFoundError` | 404 | Resource not found |
| `ValidationError` | 400 | Invalid request parameters |
| `ConnectionError` | — | Network/timeout errors |
| `RateLimitError` | 429 | Rate limited (has `retryAfter`) |
| `QuotaExceededError` | 402 | Account quota exceeded |
| `BackpressureError` | 503 | Server under load |

## Fail-Open Mode (TypeScript)

New `failOpen` option ensures AgentLens never crashes your application:

```ts
const client = new AgentLensClient({
  url: 'http://localhost:3400',
  failOpen: true,
  onError: (err) => logger.warn(err.message),
});

// Returns undefined instead of throwing on errors
const events = await client.queryEvents();
```

## PII Filtering (Python)

New built-in PII filtering with `init()`:

```python
from agentlensai import PII_EMAIL, PII_SSN, PII_CREDIT_CARD, PII_PHONE

agentlensai.init(
    agent_id="my-agent",
    pii_patterns=[PII_EMAIL, PII_SSN],
)
```

Or use `redact=True` for full content redaction, or `pii_filter=` for custom logic.

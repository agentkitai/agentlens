# agentlensai

Python SDK for AgentLens — observability and audit trail for AI agents.

## Installation

```bash
pip install agentlensai
```

## Quick Start — Auto-Instrumentation

The fastest way to get started. One call instruments all installed LLM providers automatically.

```python
import agentlensai

session_id = agentlensai.init(
    agent_id="my-agent",
    api_key="als_xxx",  # or set AGENTLENS_API_KEY
)

# That's it! All OpenAI/Anthropic/etc. calls are now tracked.
import openai
client = openai.OpenAI()
client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}],
)
# ^ This call is automatically captured by AgentLens

# When done:
agentlensai.shutdown()
```

### `init()` Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `url` | `http://localhost:3400` | Server URL (positional) |
| `server_url` | — | Server URL (keyword, takes precedence) |
| `cloud` | `False` | Use AgentLens Cloud (`https://api.agentlens.ai`) |
| `api_key` | `AGENTLENS_API_KEY` env | API key |
| `agent_id` | `"default"` | Agent identifier |
| `session_id` | auto-generated | Session ID |
| `redact` | `False` | Strip prompt/completion content |
| `pii_patterns` | `None` | List of regex patterns for PII filtering |
| `pii_filter` | `None` | Custom filter function for strings |
| `sync_mode` | `False` | Send events synchronously |
| `integrations` | `"auto"` | Which providers to instrument |

### Environment Variables

| Env Var | Description |
|---------|-------------|
| `AGENTLENS_SERVER_URL` | Server URL |
| `AGENTLENS_API_KEY` | API key |

## Manual Client Usage

```python
from agentlensai import AgentLensClient

client = AgentLensClient("http://localhost:3400", api_key="als_xxx")

# Query events
result = client.query_events(agent_id="my-agent", limit=10)
for event in result.events:
    print(event.event_type, event.timestamp)

# Log an LLM call manually
from agentlensai import LogLlmCallParams, LlmMessage, TokenUsage

result = client.log_llm_call(
    session_id="sess-1",
    agent_id="my-agent",
    params=LogLlmCallParams(
        provider="openai",
        model="gpt-4",
        messages=[LlmMessage(role="user", content="Hello")],
        completion="Hi there!",
        finish_reason="stop",
        usage=TokenUsage(input_tokens=5, output_tokens=3, total_tokens=8),
        cost_usd=0.001,
        latency_ms=450,
    ),
)
print(result.call_id)

# Context manager
with AgentLensClient("http://localhost:3400") as client:
    health = client.health()
```

## Async Client

```python
from agentlensai import AsyncAgentLensClient

async def main():
    async with AsyncAgentLensClient("http://localhost:3400", api_key="als_xxx") as client:
        events = await client.query_events(agent_id="my-agent")
        health = await client.health()
```

## PII Filtering

Filter sensitive data before it leaves your application.

### Built-in Patterns

```python
import agentlensai
from agentlensai import PII_EMAIL, PII_SSN, PII_CREDIT_CARD, PII_PHONE

agentlensai.init(
    agent_id="my-agent",
    pii_patterns=[PII_EMAIL, PII_SSN, PII_CREDIT_CARD, PII_PHONE],
)
# All email addresses, SSNs, credit cards, and phone numbers
# are replaced with [REDACTED] before sending.
```

### Custom Filter

```python
import re

def my_filter(text: str) -> str:
    return re.sub(r"password=\S+", "password=[REDACTED]", text)

agentlensai.init(
    agent_id="my-agent",
    pii_filter=my_filter,
)
```

### Full Redaction

```python
agentlensai.init(agent_id="my-agent", redact=True)
# All prompt/completion content is stripped entirely.
```

## Provider Examples

### OpenAI

```python
import agentlensai
import openai

agentlensai.init(agent_id="my-agent")

client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Explain quantum computing"}],
)
# Automatically tracked!
```

### Anthropic

```python
import agentlensai
import anthropic

agentlensai.init(agent_id="my-agent")

client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude"}],
)
# Automatically tracked!
```

### Selective Instrumentation

```python
# Only instrument OpenAI
agentlensai.init(agent_id="my-agent", integrations="openai")

# Instrument specific providers
agentlensai.init(agent_id="my-agent", integrations=["openai", "anthropic"])
```

## Error Handling

```python
from agentlensai import (
    AgentLensError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    AgentLensConnectionError,
    RateLimitError,
    QuotaExceededError,
    BackpressureError,
)

try:
    client.get_event("bad-id")
except NotFoundError:
    print("Event not found")
except RateLimitError as e:
    print(f"Rate limited, retry after {e.retry_after}s")
except AgentLensConnectionError:
    print("Server unreachable")
```

## Lessons API (Deprecated)

Lesson methods are deprecated. Use [lore-sdk](https://github.com/amitpaz1/lore) instead.

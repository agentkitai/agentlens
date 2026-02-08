# AgentLens Python SDK

[![PyPI](https://img.shields.io/pypi/v/agentlensai)](https://pypi.org/project/agentlensai/)
[![Python](https://img.shields.io/pypi/pyversions/agentlensai)](https://pypi.org/project/agentlensai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Python SDK for [AgentLens](https://github.com/amitpaz1/agentlens) — observability and audit trail for AI agents.

## Installation

```bash
pip install agentlensai
```

## Quick Start

### Sync Client

```python
from agentlensai import AgentLensClient, LogLlmCallParams, LlmMessage, TokenUsage

client = AgentLensClient("http://localhost:3400", api_key="als_your_key")

# Query events
result = client.query_events()
print(f"Total events: {result.total}")

# Get sessions
sessions = client.get_sessions()
for session in sessions.sessions:
    print(f"Session {session.id}: {session.status}")

# Log an LLM call
result = client.log_llm_call(
    session_id="ses_abc",
    agent_id="my-agent",
    params=LogLlmCallParams(
        provider="anthropic",
        model="claude-sonnet-4-20250514",
        messages=[LlmMessage(role="user", content="Hello!")],
        completion="Hi there! How can I help?",
        finish_reason="stop",
        usage=TokenUsage(input_tokens=10, output_tokens=8, total_tokens=18),
        cost_usd=0.001,
        latency_ms=850,
    ),
)
print(f"Logged LLM call: {result.call_id}")

# Get LLM analytics
analytics = client.get_llm_analytics()
print(f"Total LLM calls: {analytics.summary.total_calls}")
print(f"Total cost: ${analytics.summary.total_cost_usd:.2f}")

client.close()
```

### Async Client

```python
import asyncio
from agentlensai import AsyncAgentLensClient

async def main():
    async with AsyncAgentLensClient("http://localhost:3400", api_key="als_your_key") as client:
        # All the same methods, but async
        result = await client.query_events()
        health = await client.health()
        print(f"Server: {health.version}, Events: {result.total}")

asyncio.run(main())
```

### Privacy-Aware Logging

```python
# Redact sensitive prompts/completions while keeping metadata
result = client.log_llm_call(
    session_id="ses_abc",
    agent_id="my-agent",
    params=LogLlmCallParams(
        provider="openai",
        model="gpt-4o",
        messages=[LlmMessage(role="user", content="My SSN is 123-45-6789")],
        completion="I'll process that...",
        finish_reason="stop",
        usage=TokenUsage(input_tokens=15, output_tokens=10, total_tokens=25),
        cost_usd=0.002,
        latency_ms=1200,
        redact=True,  # Content replaced with [REDACTED], metadata preserved
    ),
)
```

## Features

- **Sync & Async** — Both `AgentLensClient` and `AsyncAgentLensClient`
- **Typed** — Full Pydantic v2 models, PEP 561 `py.typed` marker
- **LLM Call Tracking** — Log prompts, completions, tokens, costs, latency
- **Privacy Redaction** — Strip sensitive content while keeping analytics metadata
- **Error Hierarchy** — `AgentLensError`, `AuthenticationError`, `NotFoundError`, `ValidationError`, `AgentLensConnectionError`
- **Context Managers** — `with` / `async with` for automatic cleanup

## API Reference

| Method | Description |
|--------|-------------|
| `query_events(query?)` | Query events with filters and pagination |
| `get_event(id)` | Get a single event by ID |
| `get_sessions(query?)` | Query sessions |
| `get_session(id)` | Get a single session |
| `get_session_timeline(session_id)` | Get session timeline with hash chain verification |
| `log_llm_call(session_id, agent_id, params)` | Log an LLM call with paired events |
| `get_llm_analytics(params?)` | Get LLM cost/usage analytics |
| `health()` | Check server health |

## Documentation

Full docs: [amitpaz1.github.io/agentlens](https://amitpaz1.github.io/agentlens/)

## Development

```bash
pip install -e ".[dev]"
pytest                    # 107 tests
mypy src/ --strict        # Type checking
ruff check src/ tests/    # Linting
```

## License

MIT

# Changelog

## 0.4.0 (2026-02-08)

### Features — Auto-Instrumentation
- **`agentlensai.init()`** — One-liner setup that auto-instruments installed LLM SDKs
- **OpenAI integration** — Monkey-patches `chat.completions.create` (sync + async)
- **Anthropic integration** — Monkey-patches `messages.create` (sync + async)
- **LangChain callback handler** — `AgentLensCallbackHandler` for LLM + tool tracking
- **Background event sender** — Fail-safe threaded queue, never blocks user code
- **Redaction support** — `init(redact=True)` strips content, preserves metadata
- **Session management** — Auto-generated or user-provided session IDs
- **`agentlensai.shutdown()`** — Flush pending events and restore original methods
- **158 tests** — 107 SDK + 51 instrumentation tests

### Guarantees
- Instrumentation errors never break user code (all wrapped in try/except)
- Server unreachable → user code works normally
- Streaming calls pass through uninstrumented (follow-up feature)

## 0.3.0 (2026-02-08)

Initial release — Python SDK for AgentLens.

### Features
- **Sync client** (`AgentLensClient`) — full REST API coverage using `httpx`
- **Async client** (`AsyncAgentLensClient`) — 1:1 async mirror using `httpx.AsyncClient`
- **20 Pydantic v2 models** — typed events, sessions, queries, LLM payloads
- **LLM call tracking** — `log_llm_call()` with paired event ingest and privacy redaction
- **LLM analytics** — `get_llm_analytics()` for cost/usage aggregation
- **Error hierarchy** — `AgentLensError`, `AuthenticationError`, `NotFoundError`, `ValidationError`, `AgentLensConnectionError`
- **Context managers** — `with` / `async with` support
- **PEP 561** — `py.typed` marker for downstream type checking
- **107 tests** — comprehensive sync + async test suites
- **mypy strict** — zero errors

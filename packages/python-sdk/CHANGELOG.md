# Changelog

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

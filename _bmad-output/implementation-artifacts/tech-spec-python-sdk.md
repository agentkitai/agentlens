# Tech Spec: AgentLens Python SDK (`agentlensai`)

## Overview
Port the TypeScript `@agentlensai/sdk` to an idiomatic Python package, published to PyPI as `agentlensai`. Must be a 1:1 feature match with the TS SDK — same API surface, same error hierarchy, same redaction logic — but Pythonic (type hints, dataclasses, context managers, async/sync).

## Package Details
- **Name:** `agentlensai` (PyPI)
- **Location:** `/home/amit/projects/agentlens/packages/python-sdk/`
- **Python:** ≥ 3.9
- **Dependencies:** `httpx` (HTTP client, async+sync), `pydantic` ≥ 2.0 (validation/models)
- **Dev deps:** `pytest`, `pytest-asyncio`, `pytest-httpx`, `ruff` (lint), `mypy` (type check)
- **Build:** `hatchling` or `setuptools` with `pyproject.toml`

## Epics & Stories

---

### Epic 1: Project Scaffold & Models (4 stories)

**Story 1.1: Project scaffold**
Create `packages/python-sdk/` with:
- `pyproject.toml` (name=agentlensai, version=0.3.0, python≥3.9, deps: httpx>=0.24, pydantic>=2.0)
- `src/agentlensai/__init__.py` (public API exports)
- `src/agentlensai/py.typed` (PEP 561 marker)
- `tests/` directory
- `README.md` (short, points to main docs)
- `.gitignore` (dist/, *.egg-info, __pycache__, .mypy_cache)

**AC:**
- `pip install -e .` works from the package directory
- Package version is 0.3.0
- `from agentlensai import AgentLensClient` importable

**Story 1.2: Pydantic models — Event types & enums**
File: `src/agentlensai/models.py`
- `EventType` — `Literal` union of all 18 event types
- `EventSeverity` — `Literal["debug", "info", "warn", "error", "critical"]`
- `SessionStatus` — `Literal["active", "completed", "error"]`
- `LlmMessage` model (role, content, tool_call_id?, tool_calls?)
- `LlmCallPayload` model (call_id, provider, model, messages, system_prompt?, parameters?, tools?, redacted?)
- `LlmResponsePayload` model (call_id, provider, model, completion, tool_calls?, finish_reason, usage, cost_usd, latency_ms, redacted?)
- `AgentLensEvent` model (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash)
- `Session` model (id, agent_id, agent_name?, started_at, ended_at?, status, event_count, tool_call_count, error_count, total_cost_usd, llm_call_count, total_input_tokens, total_output_tokens, tags)
- All use `model_config = ConfigDict(populate_by_name=True)` with snake_case Python + camelCase aliases for JSON compat

**AC:**
- All models serialize to camelCase JSON matching the TS API
- All models deserialize from camelCase server responses
- `mypy --strict` passes on models.py

**Story 1.3: Pydantic models — Query & response types**
File: `src/agentlensai/models.py` (extend)
- `EventQuery` (session_id?, agent_id?, event_type?, severity?, from_time?, to_time?, limit?, offset?, order?, search?)
- `EventQueryResult` (events, total, has_more)
- `SessionQuery` (agent_id?, status?, from_time?, to_time?, limit?, offset?, tags?)
- `SessionQueryResult` (sessions, total, has_more)
- `TimelineResult` (events, chain_valid)
- `HealthResult` (status, version)
- `LogLlmCallParams` (provider, model, messages, system_prompt?, completion, tool_calls?, finish_reason, usage, cost_usd, latency_ms, parameters?, tools?, redact?)
- `LlmAnalyticsParams` (from_time?, to_time?, agent_id?, model?, provider?, granularity?)
- `LlmAnalyticsResult` (summary, by_model, by_time) with nested Summary/ByModel/ByTime models
- `TokenUsage` (input_tokens, output_tokens, total_tokens, thinking_tokens?, cache_read_tokens?, cache_write_tokens?)

**AC:**
- Query models can be converted to URL query params
- Response models parse from server JSON
- Optional fields default to None

**Story 1.4: Custom exceptions**
File: `src/agentlensai/exceptions.py`
- `AgentLensError(Exception)` — base, with status, code, details attrs
- `AuthenticationError(AgentLensError)` — 401
- `NotFoundError(AgentLensError)` — 404
- `ValidationError(AgentLensError)` — 400, has details
- `ConnectionError(AgentLensError)` — network failures (named `AgentLensConnectionError` to avoid shadowing builtin)

**AC:**
- All exceptions inherit from `AgentLensError`
- `str(error)` returns useful message
- `error.status` returns HTTP status code
- Tests verify exception hierarchy

---

### Epic 2: Sync Client (4 stories)

**Story 2.1: Base HTTP client with auth & error handling**
File: `src/agentlensai/client.py`
- `AgentLensClient(url, api_key=None)` — sync client using `httpx.Client`
- Internal `_request(method, path, params?, json?)` method
- Auth: `Authorization: Bearer {api_key}` header when api_key is set
- Error mapping: 400→ValidationError, 401→AuthenticationError, 404→NotFoundError, 5xx→AgentLensError, network→AgentLensConnectionError
- URL trailing slash stripping
- Context manager support (`with AgentLensClient(...) as client:`)

**AC:**
- Constructor strips trailing slash
- Auth header sent on all requests (except health)
- All error codes correctly mapped
- Context manager closes httpx client
- 10+ tests with mocked httpx

**Story 2.2: Event & session methods**
File: `src/agentlensai/client.py` (extend)
- `query_events(query=None) → EventQueryResult`
- `get_event(event_id) → AgentLensEvent`
- `get_sessions(query=None) → SessionQueryResult`
- `get_session(session_id) → Session`
- `get_session_timeline(session_id) → TimelineResult`
- Query params built from EventQuery/SessionQuery models

**AC:**
- All methods return typed Pydantic models
- Array params (event_type, severity, status) joined with commas
- Optional fields omitted from query string
- Tests for each method with mocked responses

**Story 2.3: LLM call tracking methods**
File: `src/agentlensai/client.py` (extend)
- `log_llm_call(session_id, agent_id, params: LogLlmCallParams) → LogLlmCallResult`
  - Generates UUID4 call_id
  - Builds paired llm_call + llm_response events
  - Sends single batch POST to `/api/events`
  - Supports redaction (redact=True strips content, preserves metadata)
- `get_llm_analytics(params=None) → LlmAnalyticsResult`
  - GET /api/analytics/llm with query params

**AC:**
- Returns callId
- Sends exactly 2 events in one POST
- Both events share same callId
- Redaction strips messages/completion/systemPrompt, sets redacted=True
- Preserves model/provider/usage/cost when redacted
- Tests for normal + redacted flows

**Story 2.4: Health check**
File: `src/agentlensai/client.py` (extend)
- `health() → HealthResult`
- No auth header sent

**AC:**
- Returns HealthResult
- No Authorization header
- Test verifies no auth header

---

### Epic 3: Async Client (2 stories)

**Story 3.1: AsyncAgentLensClient — full parity**
File: `src/agentlensai/async_client.py`
- `AsyncAgentLensClient(url, api_key=None)` — async client using `httpx.AsyncClient`
- All methods from sync client as `async def`
- Async context manager support (`async with AsyncAgentLensClient(...) as client:`)
- Same error mapping as sync client

**AC:**
- 1:1 method parity with sync client
- All methods are `async`
- Uses `httpx.AsyncClient` internally
- Context manager closes async client
- Tests use `pytest-asyncio`

**Story 3.2: Shared logic extraction**
Refactor: Extract shared logic (query param building, error mapping, payload construction) into `src/agentlensai/_utils.py` so sync and async clients don't duplicate code.

**AC:**
- No duplicated business logic between client.py and async_client.py
- Both clients import from _utils.py
- All existing tests still pass

---

### Epic 4: Testing & Quality (3 stories)

**Story 4.1: Comprehensive sync client tests**
File: `tests/test_client.py`
- Test every public method on `AgentLensClient`
- Mock all HTTP calls via `pytest-httpx` or `respx`
- Error handling tests (401, 404, 400, 500, connection error)
- Auth header presence/absence tests
- Query parameter building tests
- LLM call redaction tests
- Context manager tests

**AC:**
- ≥40 tests
- 100% method coverage
- All pass with `pytest`

**Story 4.2: Comprehensive async client tests**
File: `tests/test_async_client.py`
- Mirror of sync tests but async
- Uses `pytest-asyncio`

**AC:**
- ≥40 tests
- Parity with sync tests
- All pass with `pytest`

**Story 4.3: Type checking & linting**
- `mypy src/agentlensai/ --strict` passes
- `ruff check src/ tests/` passes
- Add `[tool.mypy]` and `[tool.ruff]` to `pyproject.toml`

**AC:**
- Zero mypy errors in strict mode
- Zero ruff errors
- Configuration in pyproject.toml

---

### Epic 5: Package & Publish (2 stories)

**Story 5.1: PyPI packaging**
- `pyproject.toml` with full metadata (description, author, license, classifiers, URLs)
- `README.md` with install instructions, quick start, link to docs
- `CHANGELOG.md`
- Build: `python -m build`
- Verify: `twine check dist/*`

**AC:**
- `pip install agentlensai` works from built wheel
- Package metadata correct on test install
- README renders on PyPI

**Story 5.2: Publish to PyPI**
- Build wheel + sdist
- Publish with `twine upload`
- Verify `pip install agentlensai==0.3.0` works from PyPI

**AC:**
- Package live on pypi.org
- Install works in clean venv
- `from agentlensai import AgentLensClient` works

---

## Execution Plan

| Batch | Epics | Stories | Strategy |
|-------|-------|---------|----------|
| 1 | 1 (Scaffold+Models) | 1.1-1.4 | Serial — foundation must be solid |
| 2 | 2-3 (Sync+Async) | 2.1-2.4, 3.1-3.2 | Parallel after Epic 2.1 done |
| 3 | 4 (Tests) | 4.1-4.3 | Parallel (sync tests + async tests + lint) |
| 4 | 5 (Package) | 5.1-5.2 | Serial — package then publish |

**Total: 5 epics, 15 stories**

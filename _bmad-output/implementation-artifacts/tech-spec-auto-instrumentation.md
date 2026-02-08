# Tech Spec: AgentLens Auto-Instrumentation

## Overview
Add deterministic, automatic LLM call capture to the Python SDK. One line of setup = every LLM call logged. No reliance on LLM behavior.

## User Experience

```python
import agentlensai

# One-liner — instruments OpenAI + Anthropic automatically
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_xxx",
    agent_id="my-agent",
)

# Now EVERY OpenAI/Anthropic call is automatically captured
import openai
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
# ^ Automatically logged to AgentLens with model, tokens, cost, latency

# Async works too
async_client = openai.AsyncOpenAI()
response = await async_client.chat.completions.create(...)
# ^ Also captured

# Anthropic too
import anthropic
client = anthropic.Anthropic()
message = client.messages.create(...)
# ^ Captured with full prompt/completion/usage

# LangChain integration
from agentlensai.integrations.langchain import AgentLensCallbackHandler
handler = AgentLensCallbackHandler()
chain.invoke(input, config={"callbacks": [handler]})
# ^ Every LLM call, tool call, chain run captured
```

## Architecture

The instrumentation works by **monkey-patching** the `create()` methods on the provider SDKs. This is the same pattern used by:
- OpenTelemetry's openai instrumentation
- LangFuse's `observe()` decorator  
- Helicone's SDK wrapper
- OpenLLMetry

### Flow:
```
User code calls openai.chat.completions.create()
  → Our wrapper intercepts BEFORE (capture start time, messages, model)
  → Original create() runs normally  
  → Our wrapper intercepts AFTER (capture completion, usage, latency)
  → Sends paired events to AgentLens server via SDK client
  → Returns original response untouched
```

### Key principles:
- **Transparent**: Original API behavior unchanged, original response returned
- **Fail-safe**: If AgentLens logging fails, swallow the error — never break user code
- **Optional deps**: OpenAI/Anthropic are optional — only instrument what's installed
- **Session management**: Auto-generate session ID or let user provide one
- **Thread-safe**: Use threading.local for session context

## Epics & Stories

### Epic 6: Core Instrumentation Framework (3 stories)

**Story 6.1: `init()` entry point and session management**
File: `src/agentlensai/init.py`
- `agentlensai.init(url, api_key, agent_id, session_id=None, auto_session=True, redact=False)`
- Creates internal `AgentLensClient` instance (stored in module-level state)
- Auto-generates session_id if not provided (uuid4)
- Stores config in `_state` module (thread-safe singleton)
- `agentlensai.shutdown()` — flush pending events, close client
- `agentlensai.current_session_id()` — get active session ID
- Auto-detects installed providers and instruments them
- Re-export `init` and `shutdown` from `__init__.py`

**Story 6.2: Instrumentation registry and provider detection**
File: `src/agentlensai/_instrumentation.py`
- `InstrumentationState` dataclass holding client, agent_id, session_id, redact flag
- `get_state() -> InstrumentationState | None` — get current state
- `set_state(state)` / `clear_state()` — manage lifecycle
- `instrument_openai()` — import and patch if openai is installed
- `instrument_anthropic()` — import and patch if anthropic is installed
- Provider detection via `importlib.util.find_spec()`
- Each provider's instrumentation is a separate function for isolation

**Story 6.3: Fail-safe event sending**
File: `src/agentlensai/_sender.py`
- `send_llm_events(state, call_data)` — builds and sends paired events
- Wraps all sending in try/except — NEVER raises
- Background thread for async sending (queue + worker thread)
- `flush()` — wait for pending events to send
- Configurable: `sync_mode=True` for testing (send inline, not background)

### Epic 7: OpenAI Integration (2 stories)

**Story 7.1: Sync OpenAI instrumentation**
File: `src/agentlensai/integrations/openai.py`
- Monkey-patches `openai.resources.chat.completions.Completions.create`
- Before: capture `time.perf_counter()`, messages, model, params
- After: capture completion, usage (from response), compute latency
- Maps OpenAI response format to AgentLens event format:
  - `response.choices[0].message.content` → completion
  - `response.choices[0].message.tool_calls` → toolCalls
  - `response.choices[0].finish_reason` → finishReason
  - `response.usage.prompt_tokens` → inputTokens
  - `response.usage.completion_tokens` → outputTokens
  - `response.usage.total_tokens` → totalTokens
  - `response.model` → model (actual model used, may differ from requested)
- Cost calculation from known pricing (or 0 if unknown)
- `uninstrument_openai()` — restore original method
- Handles streaming responses: if `stream=True`, wrap the iterator to capture chunks

**Story 7.2: Async OpenAI instrumentation**
File: `src/agentlensai/integrations/openai.py` (extend)
- Monkey-patches `openai.resources.chat.completions.AsyncCompletions.create`
- Same capture logic but async
- Handles async streaming

### Epic 8: Anthropic Integration (2 stories)

**Story 8.1: Sync Anthropic instrumentation**
File: `src/agentlensai/integrations/anthropic.py`
- Monkey-patches `anthropic.resources.messages.Messages.create`
- Maps Anthropic response format:
  - `message.content[0].text` → completion (handle content blocks)
  - `message.content` blocks with `type="tool_use"` → toolCalls
  - `message.stop_reason` → finishReason
  - `message.usage.input_tokens` → inputTokens
  - `message.usage.output_tokens` → outputTokens
  - `message.model` → model
- Handles system prompt (separate param in Anthropic)
- Cost calculation from known pricing

**Story 8.2: Async Anthropic instrumentation**
File: `src/agentlensai/integrations/anthropic.py` (extend)
- Monkey-patches `anthropic.resources.messages.AsyncMessages.create`
- Same capture logic but async

### Epic 9: LangChain Integration (1 story)

**Story 9.1: LangChain callback handler**
File: `src/agentlensai/integrations/langchain.py`
- `AgentLensCallbackHandler(BaseCallbackHandler)` implementing:
  - `on_llm_start(serialized, prompts)` — capture prompt, start timer
  - `on_llm_end(response)` — capture completion, usage, send events
  - `on_llm_error(error)` — log error event
  - `on_tool_start(serialized, input_str)` — log tool_call event
  - `on_tool_end(output)` — log tool_response event
  - `on_tool_error(error)` — log tool_error event
  - `on_chain_start` / `on_chain_end` — log session events
- Uses `agentlensai.get_state()` for client access, or accepts client in constructor
- Works standalone (without `init()`) if you pass a client directly

### Epic 10: Tests & Publish (2 stories)

**Story 10.1: Integration tests**
- Test OpenAI instrumentation with mocked openai client
- Test Anthropic instrumentation with mocked anthropic client
- Test `init()` / `shutdown()` lifecycle
- Test fail-safe (logging error doesn't crash user code)
- Test uninstrumentation (restore original methods)
- Test redaction mode
- ≥30 tests

**Story 10.2: Update package and publish**
- Add optional deps to pyproject.toml: `openai`, `anthropic`, `langchain-core`
- Bump version to 0.4.0
- Update README with auto-instrumentation examples
- Build + publish to PyPI

## Execution Plan

| Batch | Epics | Stories | Strategy |
|-------|-------|---------|----------|
| 1 | 6 (Framework) | 6.1-6.3 | Serial — foundation |
| 2 | 7-8 (OpenAI + Anthropic) | 7.1-7.2, 8.1-8.2 | Parallel |
| 3 | 9-10 (LangChain + Tests) | 9.1, 10.1-10.2 | Serial |

**Total: 5 epics, 10 stories**

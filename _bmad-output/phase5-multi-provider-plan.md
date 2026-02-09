# AgentLens v0.10.0 — Multi-Provider Auto-Instrumentation

## Combined Product Brief + PRD + Architecture + Sprint Plan

**Date:** 2026-02-09
**Authors:** Paige (PM) + John (Architect) + Winston (PRD) + Bob (Scrum)
**Version:** 1.0

---

## 1. Problem Statement

AgentLens currently auto-instruments only **OpenAI** and **Anthropic** direct SDK calls. Users of LiteLLM, AWS Bedrock, Google Vertex/Gemini, Azure OpenAI, Mistral, Cohere, and Ollama must manually instrument their code or get zero visibility.

**Why this matters:**
- **LiteLLM alone** would cover 100+ providers with one integration — massive ROI
- **Enterprise customers** predominantly use Bedrock and Azure OpenAI — blocking deals
- **Market coverage:** These 7 integrations + existing 2 = ~95% of production LLM traffic
- **Competitive:** LangSmith/Helicone already support most of these

**Success metric:** ≥5 new provider integrations shipped, all with sync+async+streaming support, zero user-code breakage.

---

## 2. Architecture

### 2.1 Key Architectural Decision: `BaseLLMInstrumentation` Base Class

**Decision: YES — extract a base class.** The current OpenAI and Anthropic implementations share ~70% identical code:

| Shared Code | OpenAI | Anthropic |
|---|---|---|
| Store originals pattern | ✅ identical | ✅ identical |
| Guard against double-instrument | ✅ identical | ✅ identical |
| `functools.wraps` wrapper | ✅ identical | ✅ identical |
| `time.perf_counter()` timing | ✅ identical | ✅ identical |
| Get state, check None, pass-through | ✅ identical | ✅ identical |
| Stream pass-through | ✅ identical | ✅ identical |
| try/except never-break-user-code | ✅ identical | ✅ identical |
| `get_sender().send()` | ✅ identical | ✅ identical |
| Message extraction | Different | Different |
| Token extraction | Different | Different |
| Response parsing | Different | Different |

**New class:** `BaseLLMInstrumentation` in `integrations/base_llm.py`

```python
class BaseLLMInstrumentation(ABC):
    """Base class for LLM provider auto-instrumentation.
    
    Subclasses only implement:
    - provider_name: str
    - _get_sync_target() -> (obj, attr_name)  # what to patch
    - _get_async_target() -> (obj, attr_name) | None
    - _extract_call_data(response, kwargs, latency_ms) -> LlmCallData
    - _is_streaming(kwargs) -> bool
    """
    
    provider_name: str
    _original_sync: Any = None
    _original_async: Any = None
    
    def instrument(self) -> None:
        """Patch sync + async targets. Idempotent."""
        
    def uninstrument(self) -> None:
        """Restore originals. Idempotent."""
    
    def _make_sync_wrapper(self, original):
        """Generic sync wrapper with timing, state check, error handling."""
        
    def _make_async_wrapper(self, original):
        """Generic async wrapper with timing, state check, error handling."""
    
    @abstractmethod
    def _extract_call_data(self, response, kwargs, latency_ms) -> LlmCallData:
        """Provider-specific: parse response into LlmCallData."""
    
    @abstractmethod
    def _get_patch_targets(self) -> list[PatchTarget]:
        """Return list of (module_path, class_name, method_name, is_async)."""
```

**Registry pattern** for `agentlensai.init(integrations=["openai", "bedrock", ...])`:

```python
# integrations/registry.py
REGISTRY: dict[str, type[BaseLLMInstrumentation]] = {}

def register(name: str):
    def decorator(cls):
        REGISTRY[name] = cls
        return cls
    return decorator

def instrument_all(names: list[str] | None = None):
    """Instrument requested providers (or all available)."""
    for name, cls in REGISTRY.items():
        if names and name not in names:
            continue
        try:
            cls().instrument()
        except ImportError:
            pass  # SDK not installed, skip silently
```

### 2.2 Existing `BaseFrameworkPlugin` vs New `BaseLLMInstrumentation`

These are **different abstractions**:
- `BaseFrameworkPlugin` → for **framework** plugins (LangChain, CrewAI) that use callbacks/hooks
- `BaseLLMInstrumentation` → for **LLM provider** monkey-patching (OpenAI, Anthropic, Bedrock...)

They should NOT share a class hierarchy. Different patterns entirely.

### 2.3 Optional Dependencies

```toml
# pyproject.toml extras
[project.optional-dependencies]
litellm = ["litellm>=1.0"]
bedrock = ["boto3>=1.28"]
vertex = ["google-cloud-aiplatform>=1.38"]
gemini = ["google-generativeai>=0.3"]
azure = ["openai>=1.0"]  # same SDK, just metadata
mistral = ["mistralai>=0.1"]
cohere = ["cohere>=5.0"]
ollama = ["ollama>=0.1"]
all-providers = ["litellm", "boto3", "google-cloud-aiplatform", ...]
```

---

## 3. Provider-by-Provider Technical Analysis

### 3.1 LiteLLM (Priority 1 — Highest ROI)

**What to patch:**
- `litellm.completion` (function, not method)
- `litellm.acompletion` (async function)
- `litellm.text_completion` / `litellm.atext_completion` (optional)

**Response format:** OpenAI-compatible `ModelResponse` object
```python
response.choices[0].message.content
response.usage.prompt_tokens      # input
response.usage.completion_tokens  # output
response.usage.total_tokens
response.model                    # "gpt-4" / "claude-3" / etc
response._hidden_params["custom_llm_provider"]  # "openai" / "bedrock" / etc
```

**Patch style:** Module-level function replacement (not class method)
```python
litellm.completion = patched_completion
litellm.acompletion = patched_acompletion
```

**Streaming:** `litellm.completion(stream=True)` returns `CustomStreamWrapper` — iterate chunks, accumulate.

**Token fields:** Same as OpenAI (prompt_tokens, completion_tokens, total_tokens)

**Cost:** LiteLLM has built-in `litellm.completion_cost(response)` — use it!

**Metadata extras:** `custom_llm_provider`, `api_base`, actual model vs requested model

**Tests:** 8 (sync, async, streaming sync, streaming async, error, no-sdk, patch/unpatch, cost extraction)

---

### 3.2 AWS Bedrock (Priority 2 — Enterprise)

**What to patch:**
- `botocore.client.ClientCreator.create_client` → intercept when service = "bedrock-runtime"
- OR simpler: patch the generated client's `invoke_model()` and `invoke_model_with_response_stream()`

**Preferred approach:** Patch at the Bedrock runtime client level:
```python
# After client creation, wrap:
bedrock_client.invoke_model = patched_invoke_model
bedrock_client.invoke_model_with_response_stream = patched_stream
```

**Challenge:** boto3 generates clients dynamically. Best approach: patch `botocore.endpoint.BotocoreEndpoint.make_request` for bedrock-runtime OR use `botocore.hooks` event system:
```python
session.events.register('before-call.bedrock-runtime.*', before_hook)
session.events.register('after-call.bedrock-runtime.*', after_hook)
```

**Response format:** JSON body (varies by model family):
```python
# Anthropic on Bedrock
body = json.loads(response["body"].read())
body["usage"]["input_tokens"]
body["usage"]["output_tokens"]

# Amazon Titan
body["inputTextTokenCount"]
body["results"][0]["tokenCount"]

# Meta Llama on Bedrock
body["generation_token_count"]
body["prompt_token_count"]
```

**Model name:** From `kwargs["modelId"]` e.g. `"anthropic.claude-3-sonnet-20240229-v1:0"`

**Streaming:** `invoke_model_with_response_stream` returns `EventStream` — parse chunks

**Cost:** Model-specific lookup table needed (Bedrock pricing per model family)

**Tests:** 10 (sync invoke, streaming, Anthropic response format, Titan format, Llama format, error, converse API, patch/unpatch, no-boto3, cost calc)

---

### 3.3 Google Vertex AI / Gemini (Priority 3)

**Two SDKs to patch:**

**A) `google-cloud-aiplatform` (Vertex AI):**
```python
# Patch:
GenerativeModel.generate_content       # sync
GenerativeModel.generate_content_async  # async

# Response:
response.usage_metadata.prompt_token_count
response.usage_metadata.candidates_token_count
response.usage_metadata.total_token_count
response.candidates[0].content.parts[0].text
```

**B) `google-generativeai` (Gemini direct):**
```python
# Patch:
GenerativeModel.generate_content  # sync (different module!)
GenerativeModel.generate_content_async

# Response: same structure
response.usage_metadata.prompt_token_count
response.usage_metadata.candidates_token_count
```

**Model name:** `self.model_name` on the GenerativeModel instance or `response.model_version`

**Streaming:** `generate_content(stream=True)` returns iterator of `GenerateContentResponse`

**Cost:** Google has per-character and per-token pricing — use token counts with model-specific rates

**Tests:** 8 per SDK (16 total) — sync, async, streaming, error, multimodal input, token extraction, patch/unpatch, no-sdk

---

### 3.4 Azure OpenAI (Priority 4 — Metadata Enhancement)

**What to patch:** Already patched via OpenAI SDK instrumentation. Need to:
1. Detect Azure endpoint (check `self._client.base_url` or `api_type`)
2. Extract Azure-specific metadata:
   - `deployment_name` (from URL path or kwargs)
   - `api_version` (from client config)
   - `azure_endpoint` / region
3. Set `provider="azure_openai"` instead of `"openai"`

**Implementation:** Enhance existing OpenAI instrumentation's `_build_call_data`:
```python
# Detect Azure
is_azure = hasattr(client, '_azure_deployment') or 'azure' in str(base_url)
if is_azure:
    data.provider = "azure_openai"
    data.metadata = {
        "deployment": deployment_name,
        "api_version": api_version,
        "region": extract_region(base_url)
    }
```

**Tests:** 6 (azure detection, deployment extraction, region extraction, api_version, mixed azure+openai, backward compat)

---

### 3.5 Mistral (Priority 5)

**What to patch:**
```python
# mistralai SDK v1.x
from mistralai import Mistral
Mistral.chat.complete       # sync → returns ChatCompletionResponse  
Mistral.chat.complete_async  # async
Mistral.chat.stream          # sync streaming
Mistral.chat.stream_async    # async streaming
```

**Response format:**
```python
response.choices[0].message.content
response.usage.prompt_tokens
response.usage.completion_tokens
response.usage.total_tokens
response.model
```

**Very OpenAI-like** — straightforward mapping.

**Tests:** 8 (sync, async, stream sync, stream async, error, tool calls, patch/unpatch, no-sdk)

---

### 3.6 Cohere (Priority 6)

**What to patch:**
```python
# cohere SDK v5.x
cohere.ClientV2.chat         # sync → returns ChatResponse (v2 API)
cohere.AsyncClientV2.chat    # async
# Legacy v1:
cohere.Client.chat           # returns NonStreamedChatResponse
cohere.Client.generate       # returns Generations (completion API)
```

**Response format (v2 — Chat):**
```python
response.message.content[0].text
response.usage.tokens.input_tokens
response.usage.tokens.output_tokens
response.finish_reason
response.model  # not always present, use kwarg
```

**Response format (v1 — Chat):**
```python
response.text
response.meta.tokens.input_tokens
response.meta.tokens.output_tokens
```

**Streaming:** `client.chat_stream()` yields events with `stream_end` containing usage

**Tests:** 8 (v2 chat, v1 chat, generate, streaming, async, error, patch/unpatch, no-sdk)

---

### 3.7 Ollama (Priority 7)

**What to patch:**
```python
# ollama SDK
ollama.chat           # function-level (like litellm)
ollama.Client.chat    # class method
ollama.AsyncClient.chat
```

**Response format:**
```python
response["message"]["content"]
response["model"]
response["eval_count"]          # output tokens
response["prompt_eval_count"]   # input tokens
response["eval_duration"]       # nanoseconds
response["total_duration"]      # nanoseconds
```

**Cost:** $0 (local) — but still track token counts for usage analytics

**Streaming:** `ollama.chat(stream=True)` yields dicts; last chunk has totals

**Tests:** 8 (function call, Client.chat, AsyncClient.chat, streaming, error, token extraction, patch/unpatch, no-sdk)

---

## 4. Sprint Plan

### Overview

| Batch | Stories | Duration | Parallelism |
|-------|---------|----------|-------------|
| B0 | Base class + registry + refactor existing | 2-3 days | Sequential (foundation) |
| B1 | LiteLLM + Azure enhancement | 2 days | Parallel (2 agents) |
| B2 | Bedrock + Mistral | 2-3 days | Parallel (2 agents) |
| B3 | Vertex/Gemini + Cohere | 2-3 days | Parallel (2 agents) |
| B4 | Ollama + streaming for all + integration tests | 2 days | Parallel |
| B5 | Docs + pyproject extras + final QA | 1 day | Sequential |

**Total estimated: 10-14 working days (2-3 weeks)**

---

### Batch 0 — Foundation (BLOCKING — must complete first)

#### S0.1: Create `BaseLLMInstrumentation` base class
**File:** `integrations/base_llm.py`

Extract from OpenAI/Anthropic:
- `instrument()` / `uninstrument()` lifecycle
- Sync/async wrapper generation with timing + state check + error handling
- Stream pass-through logic
- Double-instrumentation guard

Abstract methods for subclasses:
- `_get_patch_targets() -> list[PatchTarget]`
- `_extract_call_data(response, kwargs, latency_ms) -> LlmCallData`
- `_is_streaming(kwargs) -> bool`
- `_extract_model(kwargs) -> str`

**Tests:** 6 (base class contract, mock subclass, instrument/uninstrument lifecycle, idempotency, error isolation, state-none passthrough)

**AC:** Base class exists; a trivial mock subclass can instrument/uninstrument correctly.

---

#### S0.2: Create provider registry
**File:** `integrations/registry.py`

- `REGISTRY` dict mapping name → class
- `@register("name")` decorator
- `instrument_providers(names=None)` / `uninstrument_providers(names=None)`
- Auto-discovery: skip providers whose SDK isn't installed (ImportError → skip)

**Tests:** 4 (register, instrument_all, selective instrument, missing SDK skip)

---

#### S0.3: Refactor OpenAI to use `BaseLLMInstrumentation`
**File:** `integrations/openai.py`

Rewrite as `OpenAIInstrumentation(BaseLLMInstrumentation)`. Keep `instrument_openai()` / `uninstrument_openai()` as thin wrappers for backward compat.

**Tests:** Existing tests must still pass + 2 new (verify inherits base, verify registry registration)

---

#### S0.4: Refactor Anthropic to use `BaseLLMInstrumentation`
**File:** `integrations/anthropic.py`

Same pattern as S0.3.

**Tests:** Existing tests must still pass + 2 new

---

#### S0.5: Update `agentlensai.init()` to use registry
**File:** `__init__.py`

Add `integrations` parameter:
```python
agentlensai.init(
    api_key="...",
    integrations=["openai", "anthropic", "litellm"],  # explicit list
    # OR integrations="auto"  → instrument all available
)
```

**Tests:** 4 (explicit list, "auto" mode, empty list, invalid name warning)

---

### Batch 1 — LiteLLM + Azure (parallel, 2 agents)

#### S1.1: LiteLLM integration
**File:** `integrations/litellm.py`

Subclass `BaseLLMInstrumentation`. Patch module-level functions.
Use `litellm.completion_cost()` for cost calculation.
Extract `custom_llm_provider` into metadata.

**Tests:** 8
**Depends on:** B0

---

#### S1.2: LiteLLM streaming support
**File:** `integrations/litellm.py` (extend)

Wrap `CustomStreamWrapper` to accumulate chunks and emit event on completion.
Must handle both sync and async iteration.

**Tests:** 4 (sync stream, async stream, stream error mid-way, empty stream)
**Depends on:** S1.1

---

#### S1.3: Azure OpenAI metadata enhancement
**File:** `integrations/openai.py` (extend)

Detect Azure client, extract deployment/region/api_version, set provider to `"azure_openai"`.

**Tests:** 6
**Depends on:** S0.3

---

### Batch 2 — Bedrock + Mistral (parallel, 2 agents)

#### S2.1: AWS Bedrock integration — core
**File:** `integrations/bedrock.py`

Subclass `BaseLLMInstrumentation`. Use botocore event hooks.
Handle multi-format responses (Anthropic, Titan, Llama on Bedrock).
Model-family detection from modelId string.

**Tests:** 10
**Depends on:** B0

---

#### S2.2: AWS Bedrock — Converse API
**File:** `integrations/bedrock.py` (extend)

Also patch `bedrock-runtime.converse()` and `converse_stream()` — the newer unified API.

Response format:
```python
response["usage"]["inputTokens"]
response["usage"]["outputTokens"]
response["output"]["message"]["content"][0]["text"]
```

**Tests:** 4 (converse sync, converse stream, token extraction, model mapping)
**Depends on:** S2.1

---

#### S2.3: Mistral integration
**File:** `integrations/mistral.py`

Subclass `BaseLLMInstrumentation`. Patch `Mistral.chat.complete` + async + stream variants.
OpenAI-like response format makes this straightforward.

**Tests:** 8
**Depends on:** B0

---

### Batch 3 — Vertex/Gemini + Cohere (parallel, 2 agents)

#### S3.1: Google Vertex AI integration
**File:** `integrations/vertex.py`

Patch `google.cloud.aiplatform` GenerativeModel. Handle Vertex-specific auth context.

**Tests:** 8
**Depends on:** B0

---

#### S3.2: Google Gemini (direct SDK) integration
**File:** `integrations/gemini.py`

Patch `google.generativeai` GenerativeModel. Similar structure to Vertex but different import paths.

**Tests:** 8
**Depends on:** B0 (can parallel with S3.1)

---

#### S3.3: Cohere integration
**File:** `integrations/cohere.py`

Support both v1 (`Client.chat`) and v2 (`ClientV2.chat`) APIs.
Handle `chat_stream()` for streaming.

**Tests:** 8
**Depends on:** B0

---

### Batch 4 — Ollama + Streaming Polish

#### S4.1: Ollama integration
**File:** `integrations/ollama.py`

Patch both function-level (`ollama.chat`) and class-level (`Client.chat`, `AsyncClient.chat`).
Cost = $0, still track tokens. Extract duration from nanosecond fields.

**Tests:** 8
**Depends on:** B0

---

#### S4.2: Streaming support for Bedrock + Vertex + Cohere
**File:** Extend respective integration files

Add stream wrapper that accumulates chunks and emits final event.
Provider-specific stream parsing.

**Tests:** 6 (2 per provider)
**Depends on:** S2.1, S3.1, S3.3

---

#### S4.3: Cross-provider integration test suite
**File:** `tests/test_integration_matrix.py`

Parametrized test matrix: for each provider, verify:
- Instrument → call → event captured → uninstrument → call → no event
- Error in capture doesn't break user code
- Multiple providers instrumented simultaneously

**Tests:** 14 (2 per provider)
**Depends on:** All provider stories

---

### Batch 5 — Docs + Packaging + QA

#### S5.1: Update `pyproject.toml` with optional extras
Add all provider extras. Add `all-providers` meta-extra.

**Tests:** 2 (install with extra, import without extra)
**Depends on:** All provider stories

---

#### S5.2: Documentation
- README section per provider
- Migration guide (old `instrument_openai()` still works)
- `integrations="auto"` usage example

**Tests:** 0 (docs only)

---

#### S5.3: Cost calculation module
**File:** `integrations/pricing.py`

Centralized model→pricing lookup table for providers that don't have built-in cost calculation (Bedrock, Vertex, Mistral, Cohere).
LiteLLM and Ollama don't need this (built-in / free).

**Tests:** 6 (known model lookup, unknown model fallback, price-per-token calculation, Bedrock models, Vertex models, staleness warning)

---

## 5. Dependency Graph

```
B0: Foundation
├── S0.1: BaseLLMInstrumentation ──────────────────────────┐
├── S0.2: Registry ─────────────────────────────────────────┤
├── S0.3: Refactor OpenAI (depends S0.1) ──► S1.3 Azure   │
├── S0.4: Refactor Anthropic (depends S0.1)                │
└── S0.5: Update init() (depends S0.2)                     │
                                                            │
B1: (parallel after B0) ◄──────────────────────────────────┘
├── S1.1 → S1.2: LiteLLM + streaming
└── S1.3: Azure metadata (needs S0.3)

B2: (parallel after B0)
├── S2.1 → S2.2: Bedrock core + Converse
└── S2.3: Mistral

B3: (parallel after B0)
├── S3.1: Vertex AI
├── S3.2: Gemini
└── S3.3: Cohere

B4: (after B1-B3)
├── S4.1: Ollama
├── S4.2: Streaming polish (needs S2.1, S3.1, S3.3)
└── S4.3: Integration matrix (needs all)

B5: (after B4)
├── S5.1: pyproject.toml
├── S5.2: Docs
└── S5.3: Pricing module (can start in B3)
```

---

## 6. Test Summary

| Story | Tests | Cumulative |
|-------|-------|------------|
| S0.1 Base class | 6 | 6 |
| S0.2 Registry | 4 | 10 |
| S0.3 Refactor OpenAI | 2 (+existing) | 12 |
| S0.4 Refactor Anthropic | 2 (+existing) | 14 |
| S0.5 Update init() | 4 | 18 |
| S1.1 LiteLLM | 8 | 26 |
| S1.2 LiteLLM streaming | 4 | 30 |
| S1.3 Azure metadata | 6 | 36 |
| S2.1 Bedrock core | 10 | 46 |
| S2.2 Bedrock Converse | 4 | 50 |
| S2.3 Mistral | 8 | 58 |
| S3.1 Vertex AI | 8 | 66 |
| S3.2 Gemini | 8 | 74 |
| S3.3 Cohere | 8 | 82 |
| S4.1 Ollama | 8 | 90 |
| S4.2 Streaming polish | 6 | 96 |
| S4.3 Integration matrix | 14 | 110 |
| S5.1 Packaging | 2 | 112 |
| S5.3 Pricing | 6 | 118 |
| **Total** | **118 new tests** | |

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bedrock dynamic client generation makes patching fragile | High | Use botocore event hooks instead of direct monkey-patching |
| Provider SDK breaking changes | Medium | Pin minimum versions in extras; CI test matrix |
| LiteLLM version churn (frequent releases) | Medium | Target stable response format, not internals |
| Streaming accumulation memory for long responses | Low | Cap accumulated content at configurable limit |
| Cost data goes stale as providers change pricing | Medium | Log warning if model not in pricing table; make pricing table updatable |

---

## 8. Agent Assignment Guide (for Brad)

**B0:** Single agent, sequential. Must be thorough — everything depends on it.

**B1-B3:** Spawn 2 agents per batch (one per story track). Each agent gets:
1. The base class code from B0
2. The provider's SDK docs (link or paste key response types)
3. An existing integration (post-refactor OpenAI) as reference

**B4-B5:** Can be 1-2 agents. Integration tests need all providers done first.

**Estimated total agent-days:** 12-15 (with parallelism, wall-clock 10-14 days)

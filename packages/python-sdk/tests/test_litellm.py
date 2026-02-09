"""Tests for LiteLLM auto-instrumentation (S1.1 + S1.2).

All tests mock the litellm SDK — no actual litellm installation required.
"""
from __future__ import annotations

import contextlib
import json
import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx

from agentlensai import init, shutdown
from agentlensai._sender import reset_sender
from agentlensai._state import clear_state


# ---------------------------------------------------------------------------
# Mock litellm module — injected before importing the integration
# ---------------------------------------------------------------------------

def _make_mock_litellm() -> types.ModuleType:
    """Create a fake ``litellm`` top-level module."""
    mod = types.ModuleType("litellm")

    def completion(*args: Any, **kwargs: Any) -> Any:  # noqa: ARG001
        raise NotImplementedError("should be patched in test")

    async def acompletion(*args: Any, **kwargs: Any) -> Any:  # noqa: ARG001
        raise NotImplementedError("should be patched in test")

    def completion_cost(completion_response: Any = None, **kw: Any) -> float:  # noqa: ARG001
        return 0.0042

    mod.completion = completion  # type: ignore[attr-defined]
    mod.acompletion = acompletion  # type: ignore[attr-defined]
    mod.completion_cost = completion_cost  # type: ignore[attr-defined]
    return mod


@pytest.fixture(autouse=True)
def _setup_litellm():
    """Inject mock litellm into sys.modules for every test."""
    mock_mod = _make_mock_litellm()
    old = sys.modules.get("litellm")
    sys.modules["litellm"] = mock_mod
    yield mock_mod
    if old is not None:
        sys.modules["litellm"] = old
    else:
        sys.modules.pop("litellm", None)


@pytest.fixture(autouse=True)
def _clean_state():
    yield
    with contextlib.suppress(Exception):
        shutdown()
    clear_state()
    reset_sender()
    # Uninstrument if needed
    try:
        from agentlensai.integrations.litellm import LiteLLMInstrumentation
        # Reset any active instance
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_litellm_response(
    content: str = "Hello!",
    model: str = "gpt-4o",
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
    total_tokens: int = 15,
    finish_reason: str = "stop",
    custom_llm_provider: str | None = "openai",
) -> MagicMock:
    resp = MagicMock()
    choice = MagicMock()
    choice.message.content = content
    choice.message.tool_calls = None
    choice.finish_reason = finish_reason
    choice.delta = None
    resp.choices = [choice]
    resp.usage.prompt_tokens = prompt_tokens
    resp.usage.completion_tokens = completion_tokens
    resp.usage.total_tokens = total_tokens
    resp.model = model
    resp._hidden_params = {"custom_llm_provider": custom_llm_provider}
    return resp


def _mock_stream_chunks(texts: list[str], usage: dict[str, int] | None = None) -> list[MagicMock]:
    """Create mock streaming chunks."""
    chunks = []
    for i, text in enumerate(texts):
        chunk = MagicMock()
        delta = MagicMock()
        delta.content = text
        choice = MagicMock()
        choice.delta = delta
        chunk.choices = [choice]
        # Only last chunk has usage
        if i == len(texts) - 1 and usage:
            chunk.usage.prompt_tokens = usage.get("prompt_tokens", 0)
            chunk.usage.completion_tokens = usage.get("completion_tokens", 0)
            chunk.usage.total_tokens = usage.get("total_tokens", 0)
        else:
            chunk.usage = None
        chunks.append(chunk)
    return chunks


# ===================================================================
# S1.1 — LiteLLM core integration tests
# ===================================================================


class TestLiteLLMInstrumentation:
    """Core LiteLLM instrumentation tests."""

    def test_instrument_and_uninstrument(self, _setup_litellm: Any) -> None:
        """Instrument patches litellm.completion; uninstrument restores it."""
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        original = litellm.completion
        inst = LiteLLMInstrumentation()
        inst.instrument()
        assert litellm.completion is not original
        inst.uninstrument()
        assert litellm.completion is original

    def test_double_instrument_is_noop(self, _setup_litellm: Any) -> None:
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        inst = LiteLLMInstrumentation()
        inst.instrument()
        patched = litellm.completion
        inst.instrument()  # second call
        assert litellm.completion is patched
        inst.uninstrument()

    def test_passthrough_when_no_state(self, _setup_litellm: Any) -> None:
        """Without init(), original called directly."""
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response()
        litellm.completion = MagicMock(return_value=mock_resp)

        inst = LiteLLMInstrumentation()
        inst.instrument()

        result = litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
        assert result is mock_resp
        inst.uninstrument()

    @respx.mock
    def test_captures_completion(self, _setup_litellm: Any) -> None:
        """Full integration: litellm.completion → events sent."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response(content="Hi there!", model="gpt-4o-2024")
        original_fn = MagicMock(return_value=mock_resp)
        litellm.completion = original_fn

        inst = LiteLLMInstrumentation()
        inst.instrument()

        init("http://localhost:3400", agent_id="test", session_id="ll1", sync_mode=True)

        result = litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "Hello"}])
        assert result is mock_resp

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["eventType"] == "llm_call"
        assert body["events"][0]["payload"]["provider"] == "litellm"
        assert body["events"][1]["eventType"] == "llm_response"
        assert body["events"][1]["payload"]["completion"] == "Hi there!"

        inst.uninstrument()

    @respx.mock
    def test_captures_tokens(self, _setup_litellm: Any) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        litellm.completion = MagicMock(return_value=mock_resp)

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="ll2", sync_mode=True)

        litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}])

        body = json.loads(respx.calls[0].request.content)
        usage = body["events"][1]["payload"]["usage"]
        assert usage["inputTokens"] == 100
        assert usage["outputTokens"] == 50
        assert usage["totalTokens"] == 150

        inst.uninstrument()

    @respx.mock
    def test_captures_cost(self, _setup_litellm: Any) -> None:
        """Cost extracted via litellm.completion_cost."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response()
        litellm.completion = MagicMock(return_value=mock_resp)
        litellm.completion_cost = MagicMock(return_value=0.0042)

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="ll3", sync_mode=True)

        litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}])

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["costUsd"] == 0.0042

        inst.uninstrument()

    @respx.mock
    def test_captures_custom_llm_provider(self, _setup_litellm: Any) -> None:
        """custom_llm_provider extracted from _hidden_params."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response(custom_llm_provider="bedrock")
        litellm.completion = MagicMock(return_value=mock_resp)

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="ll4", sync_mode=True)

        litellm.completion(model="anthropic.claude-3", messages=[{"role": "user", "content": "Hi"}])

        body = json.loads(respx.calls[0].request.content)
        params = body["events"][0]["payload"].get("parameters", {})
        assert params.get("metadata", {}).get("custom_llm_provider") == "bedrock"

        inst.uninstrument()

    def test_error_propagates(self, _setup_litellm: Any) -> None:
        """If litellm raises, the error must propagate."""
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        litellm.completion = MagicMock(side_effect=ValueError("rate limit!"))

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", sync_mode=True)

        with pytest.raises(ValueError, match="rate limit!"):
            litellm.completion(model="gpt-4o", messages=[])

        inst.uninstrument()

    @respx.mock
    async def test_async_captures_completion(self, _setup_litellm: Any) -> None:
        """Async litellm.acompletion sends events."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        mock_resp = _mock_litellm_response(content="Async hello!")

        async def _fake_acompletion(*args: Any, **kwargs: Any) -> Any:
            return mock_resp

        litellm.acompletion = _fake_acompletion

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="ll5", sync_mode=True)

        result = await litellm.acompletion(model="gpt-4o", messages=[{"role": "user", "content": "Hello"}])
        assert result is mock_resp

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["completion"] == "Async hello!"

        inst.uninstrument()

    def test_registry_registration(self) -> None:
        """LiteLLM is registered in the provider registry."""
        from agentlensai.integrations.registry import REGISTRY
        # Force import to trigger registration
        import agentlensai.integrations.litellm  # noqa: F401
        assert "litellm" in REGISTRY


# ===================================================================
# S1.2 — LiteLLM streaming tests
# ===================================================================


class TestLiteLLMStreaming:
    """LiteLLM streaming instrumentation tests."""

    @respx.mock
    def test_sync_stream_accumulates_and_emits(self, _setup_litellm: Any) -> None:
        """Sync streaming wraps iterator, emits event on completion."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        chunks = _mock_stream_chunks(
            ["Hello", " ", "world!"],
            usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        )
        litellm.completion = MagicMock(return_value=iter(chunks))

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="lls1", sync_mode=True)

        stream = litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}], stream=True)

        collected = []
        for chunk in stream:
            collected.append(chunk)

        assert len(collected) == 3

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["completion"] == "Hello world!"
        assert body["events"][1]["payload"]["usage"]["inputTokens"] == 5
        assert body["events"][1]["payload"]["usage"]["outputTokens"] == 3

        inst.uninstrument()

    @respx.mock
    async def test_async_stream_accumulates_and_emits(self, _setup_litellm: Any) -> None:
        """Async streaming wraps async iterator, emits event on completion."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        chunks = _mock_stream_chunks(
            ["Async", " ", "stream!"],
            usage={"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12},
        )

        class MockAsyncIter:
            def __init__(self, items: list[Any]) -> None:
                self._items = iter(items)

            def __aiter__(self) -> MockAsyncIter:
                return self

            async def __anext__(self) -> Any:
                try:
                    return next(self._items)
                except StopIteration:
                    raise StopAsyncIteration

        async def _fake_acompletion(*args: Any, **kwargs: Any) -> Any:
            return MockAsyncIter(chunks)

        litellm.acompletion = _fake_acompletion

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="lls2", sync_mode=True)

        stream = await litellm.acompletion(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}], stream=True)

        collected = []
        async for chunk in stream:
            collected.append(chunk)

        assert len(collected) == 3

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["completion"] == "Async stream!"

        inst.uninstrument()

    @respx.mock
    def test_stream_no_state_passthrough(self, _setup_litellm: Any) -> None:
        """Without init(), streaming passes through without wrapping."""
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        sentinel = MagicMock()
        litellm.completion = MagicMock(return_value=sentinel)

        inst = LiteLLMInstrumentation()
        inst.instrument()
        # No init() — no state

        result = litellm.completion(model="gpt-4o", messages=[], stream=True)
        assert result is sentinel

        inst.uninstrument()

    @respx.mock
    def test_empty_stream(self, _setup_litellm: Any) -> None:
        """Empty stream still emits event."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        import litellm
        from agentlensai.integrations.litellm import LiteLLMInstrumentation

        litellm.completion = MagicMock(return_value=iter([]))

        inst = LiteLLMInstrumentation()
        inst.instrument()
        init("http://localhost:3400", session_id="lls3", sync_mode=True)

        stream = litellm.completion(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}], stream=True)
        collected = list(stream)
        assert len(collected) == 0

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["completion"] == ""

        inst.uninstrument()

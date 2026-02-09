"""Tests for Mistral AI instrumentation (S2.3).

All mistralai dependencies are mocked — no API key needed.
"""
from __future__ import annotations

import asyncio
import sys
import types
from typing import Any
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from agentlensai._sender import LlmCallData


# ---------------------------------------------------------------------------
# Mock mistralai module hierarchy
# ---------------------------------------------------------------------------

def _setup_mistral_mocks():
    """Create mock mistralai modules in sys.modules."""
    mistralai_mod = types.ModuleType("mistralai")
    mistralai_chat_mod = types.ModuleType("mistralai.chat")

    class Chat:
        def complete(self, *args, **kwargs):
            pass

        async def complete_async(self, *args, **kwargs):
            pass

        def stream(self, *args, **kwargs):
            pass

        async def stream_async(self, *args, **kwargs):
            pass

    mistralai_chat_mod.Chat = Chat  # type: ignore
    mistralai_mod.chat = mistralai_chat_mod  # type: ignore
    mistralai_mod.Mistral = MagicMock  # type: ignore

    sys.modules["mistralai"] = mistralai_mod
    sys.modules["mistralai.chat"] = mistralai_chat_mod

    return Chat


_MockChat = _setup_mistral_mocks()

from agentlensai.integrations.mistral import (
    MistralInstrumentation,
    _build_call_data,
    _extract_messages,
)


# ---------------------------------------------------------------------------
# Helpers to build mock responses
# ---------------------------------------------------------------------------

def _make_response(
    content: str = "Hello!",
    model: str = "mistral-large-latest",
    prompt_tokens: int = 10,
    completion_tokens: int = 20,
    total_tokens: int = 30,
    finish_reason: str = "stop",
    tool_calls: Any = None,
):
    """Build a mock ChatCompletionResponse."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls

    choice = MagicMock()
    choice.message = message
    choice.finish_reason = finish_reason

    usage = MagicMock()
    usage.prompt_tokens = prompt_tokens
    usage.completion_tokens = completion_tokens
    usage.total_tokens = total_tokens

    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    response.model = model

    return response


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset():
    yield
    try:
        inst = MistralInstrumentation()
        inst.uninstrument()
    except Exception:
        pass


@pytest.fixture
def mock_state():
    state = MagicMock()
    state.session_id = "test-session"
    return state


@pytest.fixture
def mock_sender():
    return MagicMock()


# ---------------------------------------------------------------------------
# S2.3: Message extraction
# ---------------------------------------------------------------------------

class TestMessageExtraction:
    def test_extract_with_system(self):
        messages = [
            {"role": "system", "content": "Be helpful"},
            {"role": "user", "content": "Hello"},
        ]
        system, msgs = _extract_messages(messages)
        assert system == "Be helpful"
        assert len(msgs) == 2

    def test_extract_empty(self):
        system, msgs = _extract_messages([])
        assert system is None
        assert msgs == []


# ---------------------------------------------------------------------------
# S2.3: Call data building
# ---------------------------------------------------------------------------

class TestBuildCallData:
    def test_basic_response(self):
        response = _make_response(content="Hi there", prompt_tokens=5, completion_tokens=10)
        data = _build_call_data(
            response,
            {"model": "mistral-large-latest", "messages": [{"role": "user", "content": "Hello"}]},
            100.0,
        )
        assert data.provider == "mistral"
        assert data.model == "mistral-large-latest"
        assert data.completion == "Hi there"
        assert data.input_tokens == 5
        assert data.output_tokens == 10
        assert data.latency_ms == 100.0

    def test_tool_calls(self):
        tc = MagicMock()
        tc.id = "call_1"
        tc.function.name = "get_weather"
        tc.function.arguments = '{"city": "Paris"}'

        response = _make_response(tool_calls=[tc])
        data = _build_call_data(response, {"model": "mistral-large"}, 50.0)
        assert data.tool_calls is not None
        assert len(data.tool_calls) == 1
        assert data.tool_calls[0]["name"] == "get_weather"


# ---------------------------------------------------------------------------
# S2.3: Instrument / uninstrument lifecycle
# ---------------------------------------------------------------------------

class TestMistralInstrumentation:
    def test_instrument_uninstrument(self):
        inst = MistralInstrumentation()
        inst.instrument()
        assert inst.is_instrumented
        inst.uninstrument()
        assert not inst.is_instrumented

    def test_double_instrument_is_noop(self):
        inst = MistralInstrumentation()
        inst.instrument()
        inst.instrument()
        assert inst.is_instrumented
        inst.uninstrument()

    def test_sync_complete_captures(self, mock_state, mock_sender):
        inst = MistralInstrumentation()
        inst.instrument()

        response = _make_response()
        chat_instance = _MockChat()

        with patch("agentlensai._state.get_state", return_value=mock_state), \
             patch("agentlensai._sender.get_sender", return_value=mock_sender):
            # The patched complete expects (self, ...) so we call via the class
            # but we need to mock the original to return our response
            orig = inst._original_complete
            # Patch the original to return our mock response
            with patch.object(type(chat_instance), "complete", return_value=response) as _:
                # Actually call via the patched method on the class
                pass

        # Simpler approach: directly test the patched method
        inst.uninstrument()
        inst2 = MistralInstrumentation()

        # Save original, patch it, call the patched version
        original_complete = _MockChat.complete
        inst2.instrument()

        # Now _MockChat.complete is patched
        # We need to make the original return our response
        def fake_original(self_arg, *args, **kwargs):
            return response

        # Replace the saved original
        inst2._original_complete = fake_original

        # Re-instrument with our fake original
        inst2.uninstrument()
        _MockChat.complete = fake_original
        inst2._original_complete = None
        inst2._instrumented = False
        inst2.instrument()

        with patch("agentlensai._state.get_state", return_value=mock_state), \
             patch("agentlensai._sender.get_sender", return_value=mock_sender):
            result = _MockChat.complete(chat_instance, model="mistral-large", messages=[{"role": "user", "content": "Hi"}])

        assert result == response
        assert mock_sender.send.called
        call_data = mock_sender.send.call_args[0][1]
        assert isinstance(call_data, LlmCallData)
        assert call_data.provider == "mistral"
        assert call_data.completion == "Hello!"

        inst2.uninstrument()

    def test_sync_complete_passthrough_no_state(self, mock_sender):
        response = _make_response()

        def fake_original(self_arg, *args, **kwargs):
            return response

        _MockChat.complete = fake_original

        inst = MistralInstrumentation()
        inst.instrument()

        chat_instance = _MockChat()
        with patch("agentlensai._state.get_state", return_value=None):
            result = _MockChat.complete(chat_instance, model="mistral-large")

        assert result == response
        assert not mock_sender.send.called
        inst.uninstrument()

    def test_async_complete_captures(self, mock_state, mock_sender):
        response = _make_response()

        async def fake_original(self_arg, *args, **kwargs):
            return response

        _MockChat.complete_async = fake_original

        inst = MistralInstrumentation()
        inst.instrument()

        chat_instance = _MockChat()

        async def run():
            with patch("agentlensai._state.get_state", return_value=mock_state), \
                 patch("agentlensai._sender.get_sender", return_value=mock_sender):
                return await _MockChat.complete_async(chat_instance, model="mistral-large", messages=[])

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result == response
        assert mock_sender.send.called
        call_data = mock_sender.send.call_args[0][1]
        assert call_data.provider == "mistral"

        inst.uninstrument()


# ---------------------------------------------------------------------------
# S2.3: Registry
# ---------------------------------------------------------------------------

class TestMistralRegistry:
    def test_registered(self):
        from agentlensai.integrations.registry import REGISTRY
        assert "mistral" in REGISTRY
        assert REGISTRY["mistral"] is MistralInstrumentation

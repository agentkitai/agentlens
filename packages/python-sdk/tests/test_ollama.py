"""Tests for Ollama instrumentation (S4.1)."""

from __future__ import annotations

import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from agentlensai._sender import LlmCallData

# ---------------------------------------------------------------------------
# Mock ollama module before importing
# ---------------------------------------------------------------------------


def _setup_ollama_mocks():
    """Create mock ollama module in sys.modules."""
    ollama_mod = types.ModuleType("ollama")

    def mock_chat(*args: Any, **kwargs: Any) -> dict:
        return {
            "model": kwargs.get("model", "llama3"),
            "message": {"role": "assistant", "content": "Hello from Ollama!"},
            "eval_count": 15,
            "prompt_eval_count": 10,
            "eval_duration": 500_000_000,  # 500ms in nanoseconds
        }

    ollama_mod.chat = mock_chat  # type: ignore

    class MockClient:
        def chat(self, *args: Any, **kwargs: Any) -> dict:
            return mock_chat(*args, **kwargs)

    class MockAsyncClient:
        async def chat(self, *args: Any, **kwargs: Any) -> dict:
            return mock_chat(*args, **kwargs)

    ollama_mod.Client = MockClient  # type: ignore
    ollama_mod.AsyncClient = MockAsyncClient  # type: ignore

    sys.modules["ollama"] = ollama_mod
    return ollama_mod, MockClient, MockAsyncClient


_ollama_mod, _MockClient, _MockAsyncClient = _setup_ollama_mocks()

from agentlensai.integrations.ollama import OllamaInstrumentation, _extract_call_data  # noqa: E402

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset():
    """Reset instrumentation between tests."""
    inst = OllamaInstrumentation()
    yield
    inst.uninstrument()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestOllamaExtraction:
    """Test response data extraction."""

    def test_extract_basic_response(self):
        response = {
            "model": "llama3",
            "message": {"role": "assistant", "content": "Hi there"},
            "eval_count": 20,
            "prompt_eval_count": 5,
            "eval_duration": 100_000_000,
        }
        kwargs = {"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}
        data = _extract_call_data(response, kwargs, latency_ms=150.0)

        assert data.provider == "ollama"
        assert data.model == "llama3"
        assert data.completion == "Hi there"
        assert data.input_tokens == 5
        assert data.output_tokens == 20
        assert data.total_tokens == 25
        assert data.cost_usd == 0.0
        assert data.latency_ms == 150.0

    def test_extract_messages(self):
        response = {"model": "llama3", "message": {"content": "ok"}}
        kwargs = {
            "model": "llama3",
            "messages": [
                {"role": "system", "content": "Be helpful"},
                {"role": "user", "content": "Hi"},
            ],
        }
        data = _extract_call_data(response, kwargs, latency_ms=50.0)
        assert data.system_prompt == "Be helpful"
        assert len(data.messages) == 2

    def test_extract_missing_tokens(self):
        response = {"model": "llama3", "message": {"content": "test"}}
        kwargs = {"model": "llama3", "messages": []}
        data = _extract_call_data(response, kwargs, latency_ms=10.0)
        assert data.input_tokens == 0
        assert data.output_tokens == 0


class TestOllamaInstrumentation:
    """Test instrument/uninstrument lifecycle."""

    def test_instrument_patches_module_chat(self):
        inst = OllamaInstrumentation()
        original = _ollama_mod.chat
        inst.instrument()
        assert _ollama_mod.chat is not original
        inst.uninstrument()
        assert _ollama_mod.chat is original

    def test_instrument_patches_client_chat(self):
        inst = OllamaInstrumentation()
        original = _MockClient.chat
        inst.instrument()
        assert _MockClient.chat is not original
        inst.uninstrument()
        assert _MockClient.chat is original

    def test_idempotent_instrument(self):
        inst = OllamaInstrumentation()
        inst.instrument()
        inst.instrument()  # no-op
        assert inst.is_instrumented
        inst.uninstrument()

    def test_sync_call_captured(self):
        inst = OllamaInstrumentation()
        inst.instrument()

        with (
            patch("agentlensai._state.get_state") as mock_state,
            patch("agentlensai._sender.get_sender") as mock_sender,
        ):
            mock_state.return_value = MagicMock()
            sender = MagicMock()
            mock_sender.return_value = sender

            result = _ollama_mod.chat(model="llama3", messages=[{"role": "user", "content": "hi"}])

            assert result["message"]["content"] == "Hello from Ollama!"
            sender.send.assert_called_once()
            call_data = sender.send.call_args[0][1]
            assert isinstance(call_data, LlmCallData)
            assert call_data.provider == "ollama"
            assert call_data.cost_usd == 0.0

        inst.uninstrument()

    @pytest.mark.asyncio
    async def test_async_call_captured(self):
        inst = OllamaInstrumentation()
        inst.instrument()

        with (
            patch("agentlensai._state.get_state") as mock_state,
            patch("agentlensai._sender.get_sender") as mock_sender,
        ):
            mock_state.return_value = MagicMock()
            sender = MagicMock()
            mock_sender.return_value = sender

            client = _MockAsyncClient()
            result = await client.chat(model="llama3", messages=[{"role": "user", "content": "hi"}])

            assert result["message"]["content"] == "Hello from Ollama!"
            sender.send.assert_called_once()

        inst.uninstrument()

    def test_streaming_passthrough(self):
        inst = OllamaInstrumentation()
        inst.instrument()

        with (
            patch("agentlensai._state.get_state") as mock_state,
            patch("agentlensai._sender.get_sender") as mock_sender,
        ):
            mock_state.return_value = MagicMock()
            sender = MagicMock()
            mock_sender.return_value = sender

            # stream=True should pass through without capture
            _ollama_mod.chat(model="llama3", messages=[], stream=True)
            sender.send.assert_not_called()

        inst.uninstrument()

    def test_no_state_passthrough(self):
        inst = OllamaInstrumentation()
        inst.instrument()

        with patch("agentlensai._state.get_state") as mock_state:
            mock_state.return_value = None
            result = _ollama_mod.chat(model="llama3", messages=[])
            assert result["message"]["content"] == "Hello from Ollama!"

        inst.uninstrument()

    def test_capture_error_doesnt_break(self):
        inst = OllamaInstrumentation()
        inst.instrument()

        with (
            patch("agentlensai._state.get_state") as mock_state,
            patch("agentlensai._sender.get_sender") as mock_sender,
        ):
            mock_state.return_value = MagicMock()
            mock_sender.side_effect = RuntimeError("boom")

            # Should still return result despite capture error
            result = _ollama_mod.chat(model="llama3", messages=[])
            assert result["message"]["content"] == "Hello from Ollama!"

        inst.uninstrument()

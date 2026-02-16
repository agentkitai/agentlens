"""Comprehensive tests for AgentLens auto-instrumentation.

Covers: init/shutdown lifecycle, EventSender, OpenAI monkey-patching,
Anthropic monkey-patching, and fail-safe behaviour.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx

from agentlensai import current_session_id, init, shutdown
from agentlensai._sender import EventSender, LlmCallData, reset_sender
from agentlensai._state import InstrumentationState, clear_state, get_state
from agentlensai.client import AgentLensClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_state() -> Any:
    """Ensure every test starts and ends with a clean slate."""
    import contextlib

    yield
    with contextlib.suppress(Exception):
        shutdown()
    clear_state()
    reset_sender()
    # Also reset OpenAI / Anthropic module-level originals
    _reset_openai_originals()
    _reset_anthropic_originals()


def _reset_openai_originals() -> None:
    try:
        from agentlensai.integrations.openai import uninstrument_openai

        uninstrument_openai()
    except Exception:
        pass


def _reset_anthropic_originals() -> None:
    try:
        from agentlensai.integrations.anthropic import uninstrument_anthropic

        uninstrument_anthropic()
    except Exception:
        pass


def _make_call_data(**overrides: Any) -> LlmCallData:
    defaults: dict[str, Any] = {
        "provider": "openai",
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Hello"}],
        "system_prompt": None,
        "completion": "Hi there!",
        "tool_calls": None,
        "finish_reason": "stop",
        "input_tokens": 10,
        "output_tokens": 5,
        "total_tokens": 15,
        "cost_usd": 0.001,
        "latency_ms": 500.0,
    }
    defaults.update(overrides)
    return LlmCallData(**defaults)


def _mock_openai_response(
    content: str = "Hello back!",
    model: str = "gpt-4o-2024-08-06",
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
    total_tokens: int = 15,
    finish_reason: str = "stop",
    tool_calls: Any = None,
) -> MagicMock:
    resp = MagicMock()
    choice = MagicMock()
    choice.message.content = content
    choice.message.tool_calls = tool_calls
    choice.finish_reason = finish_reason
    resp.choices = [choice]
    resp.usage.prompt_tokens = prompt_tokens
    resp.usage.completion_tokens = completion_tokens
    resp.usage.total_tokens = total_tokens
    resp.model = model
    return resp


def _mock_anthropic_response(
    text: str = "Hello from Claude!",
    model: str = "claude-sonnet-4-20250514",
    input_tokens: int = 12,
    output_tokens: int = 8,
    stop_reason: str = "end_turn",
    tool_blocks: list[Any] | None = None,
) -> MagicMock:
    resp = MagicMock()
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = text
    resp.content = [text_block] + (tool_blocks or [])
    resp.model = model
    resp.stop_reason = stop_reason
    resp.usage.input_tokens = input_tokens
    resp.usage.output_tokens = output_tokens
    return resp


# ===================================================================
# 1. init / shutdown lifecycle
# ===================================================================


class TestInitShutdownLifecycle:
    """Tests for the init() → shutdown() lifecycle."""

    def test_init_returns_session_id(self) -> None:
        sid = init("http://localhost:3400", agent_id="test", sync_mode=True)
        assert isinstance(sid, str)
        assert len(sid) > 0

    def test_init_auto_generates_uuid_session_id(self) -> None:
        import uuid

        sid = init("http://localhost:3400", sync_mode=True)
        uuid.UUID(sid)  # Should not raise

    def test_init_uses_provided_session_id(self) -> None:
        sid = init("http://localhost:3400", session_id="my-session", sync_mode=True)
        assert sid == "my-session"

    def test_current_session_id_after_init(self) -> None:
        init("http://localhost:3400", session_id="ses123", sync_mode=True)
        assert current_session_id() == "ses123"

    def test_current_session_id_none_before_init(self) -> None:
        assert current_session_id() is None

    def test_shutdown_clears_state(self) -> None:
        init("http://localhost:3400", sync_mode=True)
        shutdown()
        assert get_state() is None
        assert current_session_id() is None

    def test_double_init_returns_existing(self) -> None:
        init("http://localhost:3400", session_id="first", sync_mode=True)
        sid = init("http://localhost:3400", session_id="second", sync_mode=True)
        assert sid == "first"

    def test_double_init_warns(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.WARNING, logger="agentlensai"):
            init("http://localhost:3400", session_id="first", sync_mode=True)
            init("http://localhost:3400", session_id="second", sync_mode=True)
        assert "already initialized" in caplog.text.lower()

    def test_shutdown_is_idempotent(self) -> None:
        init("http://localhost:3400", sync_mode=True)
        shutdown()
        shutdown()  # second call should not raise
        assert get_state() is None

    def test_init_sets_agent_id(self) -> None:
        init("http://localhost:3400", agent_id="my-agent", sync_mode=True)
        state = get_state()
        assert state is not None
        assert state.agent_id == "my-agent"

    def test_init_sets_redact_flag(self) -> None:
        init("http://localhost:3400", redact=True, sync_mode=True)
        state = get_state()
        assert state is not None
        assert state.redact is True


# ===================================================================
# 2. EventSender tests
# ===================================================================


class TestEventSender:
    """Tests for EventSender sync-mode behaviour."""

    @respx.mock
    def test_sync_mode_sends_two_events(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="test", session_id="ses1")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        assert len(respx.calls) == 1
        body = json.loads(respx.calls[0].request.content)
        assert len(body["events"]) == 2
        assert body["events"][0]["eventType"] == "llm_call"
        assert body["events"][1]["eventType"] == "llm_response"

    @respx.mock
    def test_events_contain_session_and_agent(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="agent-x", session_id="ses-42")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        body = json.loads(respx.calls[0].request.content)
        for evt in body["events"]:
            assert evt["sessionId"] == "ses-42"
            assert evt["agentId"] == "agent-x"

    @respx.mock
    def test_metadata_has_auto_instrumentation_source(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        body = json.loads(respx.calls[0].request.content)
        for evt in body["events"]:
            assert evt["metadata"]["source"] == "auto-instrumentation"

    @respx.mock
    def test_call_payload_fields(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data(system_prompt="Be nice"))

        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        assert call_payload["provider"] == "openai"
        assert call_payload["model"] == "gpt-4o"
        assert call_payload["messages"] == [{"role": "user", "content": "Hello"}]
        assert call_payload["systemPrompt"] == "Be nice"

    @respx.mock
    def test_response_payload_fields(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        body = json.loads(respx.calls[0].request.content)
        resp_payload = body["events"][1]["payload"]
        assert resp_payload["completion"] == "Hi there!"
        assert resp_payload["finishReason"] == "stop"
        assert resp_payload["usage"]["inputTokens"] == 10
        assert resp_payload["usage"]["outputTokens"] == 5
        assert resp_payload["usage"]["totalTokens"] == 15
        assert resp_payload["costUsd"] == 0.001
        assert resp_payload["latencyMs"] == 500.0

    @respx.mock
    def test_matched_call_ids(self) -> None:
        """Both events should share the same callId."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        body = json.loads(respx.calls[0].request.content)
        call_id = body["events"][0]["payload"]["callId"]
        assert call_id == body["events"][1]["payload"]["callId"]
        assert len(call_id) > 0

    def test_sender_never_raises_on_network_error(self) -> None:
        """Sender must swallow exceptions — never crash user code."""
        client = MagicMock()
        client._request.side_effect = Exception("Server down")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        # Should NOT raise
        sender.send(state, _make_call_data())

    @respx.mock
    def test_redaction_masks_content(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s", redact=True)

        sender = EventSender(sync_mode=True)
        data = _make_call_data(system_prompt="Top secret instructions")
        sender.send(state, data)

        body = json.loads(respx.calls[0].request.content)
        call_p = body["events"][0]["payload"]
        resp_p = body["events"][1]["payload"]

        assert call_p["messages"][0]["content"] == "[REDACTED]"
        assert call_p["systemPrompt"] == "[REDACTED]"
        assert call_p["redacted"] is True
        assert resp_p["completion"] == "[REDACTED]"
        assert resp_p["redacted"] is True

    @respx.mock
    def test_no_redact_flag_when_not_redacting(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s", redact=False)

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data())

        body = json.loads(respx.calls[0].request.content)
        assert "redacted" not in body["events"][0]["payload"]
        assert "redacted" not in body["events"][1]["payload"]

    @respx.mock
    def test_tool_calls_in_response_payload(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        tc = [{"id": "call_1", "name": "get_weather", "arguments": '{"city":"TLV"}'}]
        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data(tool_calls=tc))

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["toolCalls"] == tc

    @respx.mock
    def test_thinking_tokens_included(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        client = AgentLensClient("http://localhost:3400")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        sender.send(state, _make_call_data(thinking_tokens=42))

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["usage"]["thinkingTokens"] == 42


# ===================================================================
# 3. OpenAI instrumentation
# ===================================================================


class TestOpenAIInstrumentation:
    """Tests for OpenAI SDK monkey-patching."""

    def test_instrument_and_uninstrument_cycle(self) -> None:
        import openai.resources.chat.completions as mod

        from agentlensai.integrations.openai import instrument_openai, uninstrument_openai

        original = mod.Completions.create
        instrument_openai()
        assert mod.Completions.create is not original
        uninstrument_openai()
        assert mod.Completions.create is original

    def test_async_instrument_and_uninstrument_cycle(self) -> None:
        import openai.resources.chat.completions as mod

        from agentlensai.integrations.openai import instrument_openai, uninstrument_openai

        original_async = mod.AsyncCompletions.create
        instrument_openai()
        assert mod.AsyncCompletions.create is not original_async
        uninstrument_openai()
        assert mod.AsyncCompletions.create is original_async

    def test_double_instrument_is_noop(self) -> None:
        from agentlensai.integrations.openai import instrument_openai, uninstrument_openai

        instrument_openai()

        import openai.resources.chat.completions as mod

        patched = mod.Completions.create
        instrument_openai()  # second call — should not rewrap
        assert mod.Completions.create is patched
        uninstrument_openai()

    @respx.mock
    def test_captures_chat_completion(self) -> None:
        """Full integration: OpenAI call → events sent to AgentLens."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="test", session_id="oai1", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert result is mock_resp

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["eventType"] == "llm_call"
        assert body["events"][0]["payload"]["provider"] == "openai"
        assert body["events"][0]["payload"]["model"] == "gpt-4o-2024-08-06"
        assert body["events"][1]["eventType"] == "llm_response"
        assert body["events"][1]["payload"]["completion"] == "Hello back!"

    @respx.mock
    def test_captures_tool_calls(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="oai2", sync_mode=True)

        tc = MagicMock()
        tc.id = "call_abc"
        tc.function.name = "get_weather"
        tc.function.arguments = '{"city":"TLV"}'
        mock_resp = _mock_openai_response(tool_calls=[tc])

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[{"role": "user", "content": "weather?"}],
            )

        body = json.loads(respx.calls[0].request.content)
        tool_calls_sent = body["events"][1]["payload"]["toolCalls"]
        assert tool_calls_sent[0]["id"] == "call_abc"
        assert tool_calls_sent[0]["name"] == "get_weather"

    def test_passthrough_when_no_state(self) -> None:
        """Without init(), original method called directly."""
        from agentlensai.integrations.openai import instrument_openai, uninstrument_openai

        instrument_openai()

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])
        assert result is mock_resp
        uninstrument_openai()

    def test_streaming_passthrough(self) -> None:
        """Streaming calls should pass-through without instrumentation."""
        init("http://localhost:3400", sync_mode=True)

        mock_stream = MagicMock()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_stream):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[], stream=True)

        assert result is mock_stream

    def test_openai_error_propagates(self) -> None:
        """If OpenAI SDK raises, the error must propagate to user code."""
        init("http://localhost:3400", sync_mode=True)

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", side_effect=ValueError("rate limit!")):
            import openai.resources.chat.completions as cmod

            with pytest.raises(ValueError, match="rate limit!"):
                cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])

    @respx.mock
    def test_instrumentation_error_swallowed(self) -> None:
        """If post-call capture fails, user still gets their response."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(500, json={"error": "boom"})
        )
        init("http://localhost:3400", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with (
            patch.object(oai_mod, "_original_create", return_value=mock_resp),
            patch.object(oai_mod, "_build_call_data", side_effect=RuntimeError("capture fail")),
        ):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])

        assert result is mock_resp

    @respx.mock
    def test_captures_generation_params(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="oai3", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hi"}],
                temperature=0.7,
                max_tokens=100,
            )

        body = json.loads(respx.calls[0].request.content)
        params = body["events"][0]["payload"].get("parameters")
        assert params is not None
        assert params["temperature"] == 0.7
        assert params["max_tokens"] == 100

    @respx.mock
    def test_captures_system_message(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="oai4", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are helpful"},
                    {"role": "user", "content": "Hi"},
                ],
            )

        body = json.loads(respx.calls[0].request.content)
        call_p = body["events"][0]["payload"]
        assert call_p["systemPrompt"] == "You are helpful"

    @respx.mock
    async def test_async_captures_chat_completion(self) -> None:
        """Async OpenAI wrapper sends events."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="oai5", sync_mode=True)

        mock_resp = _mock_openai_response(content="Async hello!")

        async def _fake_async_create(*args: Any, **kwargs: Any) -> Any:
            return mock_resp

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_async_create", new=_fake_async_create):
            import openai.resources.chat.completions as cmod

            result = await cmod.AsyncCompletions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert result is mock_resp

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][1]["payload"]["completion"] == "Async hello!"

    @respx.mock
    def test_usage_tokens_captured(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", session_id="oai6", sync_mode=True)

        mock_resp = _mock_openai_response(prompt_tokens=100, completion_tokens=50, total_tokens=150)

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                MagicMock(),
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hi"}],
            )

        body = json.loads(respx.calls[0].request.content)
        usage = body["events"][1]["payload"]["usage"]
        assert usage["inputTokens"] == 100
        assert usage["outputTokens"] == 50
        assert usage["totalTokens"] == 150


# ===================================================================
# 4. Anthropic instrumentation
# ===================================================================


class TestAnthropicInstrumentation:
    """Tests for Anthropic SDK monkey-patching."""

    def test_instrument_and_uninstrument_cycle(self) -> None:
        from anthropic.resources.messages import Messages

        from agentlensai.integrations.anthropic import (
            instrument_anthropic,
            uninstrument_anthropic,
        )

        original = Messages.create
        instrument_anthropic()
        assert Messages.create is not original
        uninstrument_anthropic()
        assert Messages.create is original

    def test_async_instrument_and_uninstrument(self) -> None:
        from anthropic.resources.messages import AsyncMessages

        from agentlensai.integrations.anthropic import (
            instrument_anthropic,
            uninstrument_anthropic,
        )

        original = AsyncMessages.create
        instrument_anthropic()
        assert AsyncMessages.create is not original
        uninstrument_anthropic()
        assert AsyncMessages.create is original

    @respx.mock
    def test_captures_messages_create(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="ant1", sync_mode=True)

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            result = Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": "Hello Claude"}],
                max_tokens=1024,
            )

        assert result is mock_resp

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["payload"]["provider"] == "anthropic"
        assert body["events"][0]["payload"]["model"] == "claude-sonnet-4-20250514"
        assert body["events"][1]["payload"]["completion"] == "Hello from Claude!"

    @respx.mock
    def test_captures_system_prompt(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="ant2", sync_mode=True)

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": "Hello"}],
                system="You are a pirate",
                max_tokens=256,
            )

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["payload"]["systemPrompt"] == "You are a pirate"

    @respx.mock
    def test_captures_tool_use_blocks(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="ant3", sync_mode=True)

        tool_block = MagicMock()
        tool_block.type = "tool_use"
        tool_block.id = "toolu_123"
        tool_block.name = "calculator"
        tool_block.input = {"expr": "2+2"}
        mock_resp = _mock_anthropic_response(tool_blocks=[tool_block])

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": "calc"}],
                max_tokens=256,
            )

        body = json.loads(respx.calls[0].request.content)
        tc = body["events"][1]["payload"]["toolCalls"]
        assert tc[0]["id"] == "toolu_123"
        assert tc[0]["name"] == "calculator"
        assert tc[0]["arguments"] == {"expr": "2+2"}

    def test_streaming_passthrough(self) -> None:
        init("http://localhost:3400", sync_mode=True)

        mock_stream = MagicMock()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_stream):
            from anthropic.resources.messages import Messages

            result = Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[],
                stream=True,
                max_tokens=1024,
            )

        assert result is mock_stream

    def test_error_propagates(self) -> None:
        init("http://localhost:3400", sync_mode=True)

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", side_effect=ValueError("overloaded!")):
            from anthropic.resources.messages import Messages

            with pytest.raises(ValueError, match="overloaded!"):
                Messages.create(
                    MagicMock(),
                    model="claude-sonnet-4-20250514",
                    messages=[],
                    max_tokens=256,
                )

    @respx.mock
    def test_capture_error_swallowed(self) -> None:
        """If telemetry capture fails, user still gets their response."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", sync_mode=True)

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with (
            patch.object(ant_mod, "_original_create", return_value=mock_resp),
            patch.object(ant_mod, "_build_call_data", side_effect=RuntimeError("boom")),
        ):
            from anthropic.resources.messages import Messages

            result = Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[],
                max_tokens=256,
            )

        assert result is mock_resp

    @respx.mock
    def test_captures_generation_params(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", agent_id="t", session_id="ant4", sync_mode=True)

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": "Hi"}],
                temperature=0.5,
                max_tokens=512,
                top_k=40,
            )

        body = json.loads(respx.calls[0].request.content)
        params = body["events"][0]["payload"].get("parameters")
        assert params is not None
        assert params["temperature"] == 0.5
        assert params["max_tokens"] == 512
        assert params["top_k"] == 40

    @respx.mock
    def test_usage_tokens_captured(self) -> None:
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", session_id="ant5", sync_mode=True)

        mock_resp = _mock_anthropic_response(input_tokens=50, output_tokens=30)

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=256,
            )

        body = json.loads(respx.calls[0].request.content)
        usage = body["events"][1]["payload"]["usage"]
        assert usage["inputTokens"] == 50
        assert usage["outputTokens"] == 30
        assert usage["totalTokens"] == 80

    def test_passthrough_when_no_state(self) -> None:
        """Without init(), original called directly."""
        from agentlensai.integrations.anthropic import (
            instrument_anthropic,
            uninstrument_anthropic,
        )

        instrument_anthropic()

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            result = Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[],
                max_tokens=256,
            )

        assert result is mock_resp
        uninstrument_anthropic()


# ===================================================================
# 5. Fail-safe tests
# ===================================================================


class TestFailSafe:
    """Verify instrumentation never breaks user code."""

    @respx.mock
    def test_server_500_user_code_works(self) -> None:
        """Server error → user still gets their LLM response."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )
        init("http://localhost:3400", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])

        assert result is mock_resp

    @respx.mock
    def test_server_unreachable_user_code_works(self) -> None:
        """Connection refused → user still gets their LLM response."""
        respx.post("http://localhost:3400/api/events").mock(
            side_effect=httpx.ConnectError("refused")
        )
        init("http://localhost:3400", sync_mode=True)

        mock_resp = _mock_openai_response()

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])

        assert result is mock_resp

    def test_malformed_response_user_code_works(self) -> None:
        """If LLM response object is weird, user still gets it back."""
        init("http://localhost:3400", sync_mode=True)

        malformed = MagicMock()
        malformed.choices = []  # no choices
        malformed.usage = None

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=malformed):
            import openai.resources.chat.completions as cmod

            result = cmod.Completions.create(MagicMock(), model="gpt-4o", messages=[])

        assert result is malformed

    def test_sender_swallows_all_exceptions(self) -> None:
        """EventSender.send() must never propagate."""
        client = MagicMock()
        client._request.side_effect = RuntimeError("total failure")
        state = InstrumentationState(client=client, agent_id="t", session_id="s")

        sender = EventSender(sync_mode=True)
        for _ in range(5):
            sender.send(state, _make_call_data())

    @respx.mock
    def test_anthropic_server_error_user_code_works(self) -> None:
        """Server error during Anthropic capture → user still gets response."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(503, text="Service Unavailable")
        )
        init("http://localhost:3400", sync_mode=True)

        mock_resp = _mock_anthropic_response()

        from agentlensai.integrations import anthropic as ant_mod

        with patch.object(ant_mod, "_original_create", return_value=mock_resp):
            from anthropic.resources.messages import Messages

            result = Messages.create(
                MagicMock(),
                model="claude-sonnet-4-20250514",
                messages=[],
                max_tokens=256,
            )

        assert result is mock_resp

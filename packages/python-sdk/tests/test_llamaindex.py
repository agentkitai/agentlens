"""LlamaIndex integration (#152) — LLM events become traced AgentLens calls.

llama-index-core is not a CI dev dependency, so its module hierarchy is mocked in
sys.modules before importing the integration (the established bedrock pattern).
"""

import sys
import types
from enum import Enum
from unittest.mock import MagicMock


def _setup_llamaindex_mocks() -> tuple[type[Enum], type[Enum]]:
    li = types.ModuleType("llama_index")
    li_core = types.ModuleType("llama_index.core")
    li_cb = types.ModuleType("llama_index.core.callbacks")
    li_base = types.ModuleType("llama_index.core.callbacks.base_handler")
    li_schema = types.ModuleType("llama_index.core.callbacks.schema")

    class BaseCallbackHandler:
        def __init__(self, event_starts_to_ignore=None, event_ends_to_ignore=None):  # type: ignore[no-untyped-def]
            self.event_starts_to_ignore = event_starts_to_ignore or []
            self.event_ends_to_ignore = event_ends_to_ignore or []

    class CBEventType(Enum):
        LLM = "llm"
        FUNCTION_CALL = "function_call"
        EMBEDDING = "embedding"

    class EventPayload(Enum):
        MESSAGES = "messages"
        PROMPT = "formatted_prompt"
        SERIALIZED = "serialized"
        RESPONSE = "response"

    li_base.BaseCallbackHandler = BaseCallbackHandler  # type: ignore[attr-defined]
    li_schema.CBEventType = CBEventType  # type: ignore[attr-defined]
    li_schema.EventPayload = EventPayload  # type: ignore[attr-defined]

    sys.modules["llama_index"] = li
    sys.modules["llama_index.core"] = li_core
    sys.modules["llama_index.core.callbacks"] = li_cb
    sys.modules["llama_index.core.callbacks.base_handler"] = li_base
    sys.modules["llama_index.core.callbacks.schema"] = li_schema
    return CBEventType, EventPayload


_CBEventType, _EventPayload = _setup_llamaindex_mocks()

from agentlensai.integrations.llamaindex import AgentLensLlamaIndexHandler  # noqa: E402


class _Msg:
    def __init__(self, role: str, content: str) -> None:
        self.role = role
        self.content = content


class _Resp:
    def __init__(self, content: str, usage: dict) -> None:  # type: ignore[type-arg]
        self.message = _Msg("assistant", content)
        self.raw = {"usage": usage}


def test_llm_event_logs_a_traced_call() -> None:
    client = MagicMock()
    handler = AgentLensLlamaIndexHandler(client=client, agent_id="agent-1", session_id="sess-1")

    handler.on_event_start(
        _CBEventType.LLM,
        payload={
            _EventPayload.MESSAGES: [_Msg("system", "be concise"), _Msg("user", "hi")],
            _EventPayload.SERIALIZED: {"model": "gpt-4o"},
        },
        event_id="e1",
    )
    handler.on_event_end(
        _CBEventType.LLM,
        payload={
            _EventPayload.RESPONSE: _Resp(
                "hello!", {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
            )
        },
        event_id="e1",
    )

    client.log_llm_call.assert_called_once()
    session_id, agent_id, params = client.log_llm_call.call_args[0]
    assert session_id == "sess-1"
    assert agent_id == "agent-1"
    assert params.provider == "openai"
    assert params.model == "gpt-4o"
    assert [m.role for m in params.messages] == ["system", "user"]
    assert params.completion == "hello!"
    assert params.usage.input_tokens == 10
    assert params.usage.output_tokens == 4
    assert params.usage.total_tokens == 14
    assert params.latency_ms >= 0


def test_non_llm_events_are_ignored() -> None:
    client = MagicMock()
    handler = AgentLensLlamaIndexHandler(client=client)
    handler.on_event_start(_CBEventType.EMBEDDING, payload={}, event_id="x")
    handler.on_event_end(_CBEventType.EMBEDDING, payload={}, event_id="x")
    client.log_llm_call.assert_not_called()


def test_unmatched_end_is_safe() -> None:
    client = MagicMock()
    handler = AgentLensLlamaIndexHandler(client=client)
    handler.on_event_end(
        _CBEventType.LLM, payload={_EventPayload.RESPONSE: _Resp("x", {})}, event_id="never-started"
    )
    client.log_llm_call.assert_not_called()

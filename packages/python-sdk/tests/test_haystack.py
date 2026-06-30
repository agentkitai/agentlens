"""Haystack v2 integration (#211) — Generator component runs become traced calls.

haystack-ai is not a CI dev dependency, so its module hierarchy is mocked in
sys.modules before importing the integration (the established bedrock pattern).
"""

import sys
import types
from unittest.mock import MagicMock


def _setup_haystack_mocks() -> None:
    haystack = types.ModuleType("haystack")
    tracing = types.ModuleType("haystack.tracing")

    class Span:
        def set_tag(self, key, value):  # type: ignore[no-untyped-def]
            raise NotImplementedError

        def set_tags(self, tags):  # type: ignore[no-untyped-def]
            for k, v in (tags or {}).items():
                self.set_tag(k, v)

        def raw_span(self):  # type: ignore[no-untyped-def]
            return self

        def get_correlation_data_for_logs(self):  # type: ignore[no-untyped-def]
            return {}

    class Tracer:
        def trace(self, operation_name, tags=None, parent_span=None):  # type: ignore[no-untyped-def]
            raise NotImplementedError

        def current_span(self):  # type: ignore[no-untyped-def]
            return None

    tracing.Span = Span  # type: ignore[attr-defined]
    tracing.Tracer = Tracer  # type: ignore[attr-defined]
    haystack.tracing = tracing  # type: ignore[attr-defined]
    sys.modules["haystack"] = haystack
    sys.modules["haystack.tracing"] = tracing


_setup_haystack_mocks()

from agentlensai.integrations.haystack import AgentLensTracer  # noqa: E402


class _Msg:
    def __init__(self, role: str, text: str) -> None:
        self.role = role
        self.text = text


class _Reply:
    def __init__(self, text: str, meta: dict) -> None:  # type: ignore[type-arg]
        self.text = text
        self.meta = meta


def test_generator_run_logs_a_traced_call() -> None:
    client = MagicMock()
    tracer = AgentLensTracer(client=client, agent_id="a1", session_id="s1")

    usage = {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
    reply = _Reply("hello!", {"model": "gpt-4o", "usage": usage})
    with tracer.trace(
        "haystack.component.run",
        tags={
            "haystack.component.type": "OpenAIChatGenerator",
            "haystack.component.input": {
                "messages": [_Msg("system", "be nice"), _Msg("user", "hi")],
            },
        },
    ) as span:
        span.set_tag("haystack.component.output", {"replies": [reply]})

    client.log_llm_call.assert_called_once()
    session_id, agent_id, params = client.log_llm_call.call_args[0]
    assert session_id == "s1"
    assert agent_id == "a1"
    assert params.provider == "openai"
    assert params.model == "gpt-4o"
    assert [m.role for m in params.messages] == ["system", "user"]
    assert params.completion == "hello!"
    assert params.usage.input_tokens == 10
    assert params.usage.output_tokens == 4


def test_non_generator_components_are_ignored() -> None:
    client = MagicMock()
    tracer = AgentLensTracer(client=client)
    with tracer.trace(
        "haystack.component.run", tags={"haystack.component.type": "InMemoryRetriever"}
    ) as span:
        span.set_tag("haystack.component.output", {"documents": []})
    client.log_llm_call.assert_not_called()

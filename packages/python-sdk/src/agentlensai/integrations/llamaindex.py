"""LlamaIndex integration for AgentLens (#152).

A LlamaIndex ``CallbackHandler`` that emits a traced LLM call per LLM event, so a
LlamaIndex app reports to AgentLens with verified identity + cost.

Usage::

    from agentlensai import init
    from agentlensai.integrations.llamaindex import AgentLensLlamaIndexHandler
    from llama_index.core import Settings
    from llama_index.core.callbacks import CallbackManager

    init(server_url=..., api_key=..., agent_id="my-agent")
    Settings.callback_manager = CallbackManager([AgentLensLlamaIndexHandler()])

``llama-index-core`` is an optional dependency (install ``agentlensai[llamaindex]``).
"""

from __future__ import annotations

import time
import uuid
from typing import Any, cast

from llama_index.core.callbacks.base_handler import BaseCallbackHandler
from llama_index.core.callbacks.schema import CBEventType, EventPayload


def _provider_from_model(model: str) -> str:
    m = model.lower()
    if "gpt" in m or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return "openai"
    if "claude" in m:
        return "anthropic"
    if "gemini" in m:
        return "google"
    if "llama" in m or "mixtral" in m or "mistral" in m:
        return "meta"
    return "unknown"


def _norm_role(role: str) -> str:
    r = role.lower()
    if r in ("user", "human"):
        return "user"
    if r in ("assistant", "ai", "chatbot"):
        return "assistant"
    if r == "system":
        return "system"
    if r in ("tool", "function"):
        return "tool"
    return "user"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _extract_messages(payload: dict[str, Any] | None) -> list[dict[str, str]]:
    if not payload:
        return []
    messages = payload.get(EventPayload.MESSAGES)
    if messages:
        out: list[dict[str, str]] = []
        for msg in messages:
            role = _get(msg, "role", "user")
            role = getattr(role, "value", role)  # MessageRole enum -> str
            content = str(_get(msg, "content", "") or "")
            out.append({"role": _norm_role(str(role)), "content": content})
        return out
    prompt = payload.get(EventPayload.PROMPT)
    if prompt is not None:
        return [{"role": "user", "content": str(prompt)}]
    return []


def _extract_model(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "unknown"
    serialized = payload.get(EventPayload.SERIALIZED) or {}
    model = _get(serialized, "model") or _get(serialized, "model_name")
    return str(model) if model else "unknown"


def _extract_response(payload: dict[str, Any] | None) -> tuple[str | None, tuple[int, int, int]]:
    if not payload:
        return None, (0, 0, 0)
    response = payload.get(EventPayload.RESPONSE)
    completion: Any = None
    if response is not None:
        message = _get(response, "message")
        completion = _get(message, "content") if message is not None else None
        if completion is None:
            completion = _get(response, "text")
    completion_str = str(completion) if completion is not None else None

    raw = _get(response, "raw") or {}
    usage = _get(raw, "usage") or _get(response, "additional_kwargs") or {}
    inp = int(_get(usage, "prompt_tokens", 0) or _get(usage, "input_tokens", 0) or 0)
    out = int(_get(usage, "completion_tokens", 0) or _get(usage, "output_tokens", 0) or 0)
    total = int(_get(usage, "total_tokens", 0) or (inp + out))
    return completion_str, (inp, out, total)


class AgentLensLlamaIndexHandler(BaseCallbackHandler):
    """LlamaIndex callback handler that logs LLM calls to AgentLens."""

    def __init__(
        self,
        client: Any | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        redact: bool = False,
    ) -> None:
        super().__init__(event_starts_to_ignore=[], event_ends_to_ignore=[])
        self._client = client
        self._agent_id = agent_id
        self._session_id = session_id or str(uuid.uuid4())
        self._redact = redact
        self._starts: dict[str, dict[str, Any]] = {}

    def _config(self) -> tuple[Any, str, str, bool] | None:
        if self._client is not None:
            return (self._client, self._agent_id or "default", self._session_id, self._redact)
        try:
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return None
            return (
                state.client,
                self._agent_id or state.agent_id,
                self._session_id,
                state.redact or self._redact,
            )
        except Exception:
            return None

    def on_event_start(
        self,
        event_type: CBEventType,
        payload: dict[str, Any] | None = None,
        event_id: str = "",
        parent_id: str = "",
        **kwargs: Any,
    ) -> str:
        if event_type == CBEventType.LLM:
            self._starts[event_id] = {
                "t": time.time(),
                "messages": _extract_messages(payload),
                "model": _extract_model(payload),
            }
        return event_id

    def on_event_end(
        self,
        event_type: CBEventType,
        payload: dict[str, Any] | None = None,
        event_id: str = "",
        **kwargs: Any,
    ) -> None:
        if event_type != CBEventType.LLM:
            return
        start = self._starts.pop(event_id, None)
        if start is None:
            return
        config = self._config()
        if config is None:
            return
        client, agent_id, session_id, redact = config

        completion, (inp, out, total) = _extract_response(payload)
        model = start["model"]
        if model == "unknown":
            model = _extract_model(payload)

        from agentlensai.models import LlmMessage, LogLlmCallParams, TokenUsage

        params = LogLlmCallParams(
            provider=_provider_from_model(model),
            model=model,
            messages=[
                LlmMessage(role=cast(Any, m["role"]), content=m["content"])
                for m in start["messages"]
            ],
            completion=completion,
            finish_reason="stop",
            usage=TokenUsage(input_tokens=inp, output_tokens=out, total_tokens=total),
            cost_usd=0.0,
            latency_ms=(time.time() - start["t"]) * 1000.0,
            redact=redact or None,
        )
        client.log_llm_call(session_id, agent_id, params)

    def start_trace(self, trace_id: str | None = None) -> None:
        return None

    def end_trace(
        self,
        trace_id: str | None = None,
        trace_map: dict[str, list[str]] | None = None,
    ) -> None:
        return None

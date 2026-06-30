"""Haystack v2 integration for AgentLens (#211).

A Haystack ``Tracer`` that captures Generator/ChatGenerator (LLM) component runs
and logs them as traced AgentLens LLM calls.

Usage::

    from agentlensai import init
    from agentlensai.integrations.haystack import AgentLensTracer
    from haystack.tracing import enable_tracing

    init(server_url=..., api_key=..., agent_id="my-agent")
    enable_tracing(AgentLensTracer())

``haystack-ai`` is an optional dependency (install ``agentlensai[haystack]``).
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from typing import Any, cast

from haystack.tracing import Span, Tracer


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
    if r in ("assistant", "ai"):
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


def _messages_from_input(inp: Any) -> list[dict[str, str]]:
    messages = _get(inp, "messages")
    if isinstance(messages, list) and messages:
        out: list[dict[str, str]] = []
        for m in messages:
            role = _get(m, "role", "user")
            role = getattr(role, "value", role)
            content = _get(m, "text", None)
            if content is None:
                content = _get(m, "content", "")
            out.append({"role": _norm_role(str(role)), "content": str(content or "")})
        return out
    prompt = _get(inp, "prompt")
    if prompt is not None:
        return [{"role": "user", "content": str(prompt)}]
    return []


def _completion_from_reply(reply: Any) -> str | None:
    if reply is None:
        return None
    text = _get(reply, "text", None)
    if text is None:
        text = _get(reply, "content", None)
    return str(text) if text is not None else str(reply)


def _usage(meta: Any) -> tuple[int, int, int]:
    usage = _get(meta, "usage") or {}
    inp = int(_get(usage, "prompt_tokens", 0) or _get(usage, "input_tokens", 0) or 0)
    out = int(_get(usage, "completion_tokens", 0) or _get(usage, "output_tokens", 0) or 0)
    total = int(_get(usage, "total_tokens", 0) or (inp + out))
    return inp, out, total


class AgentLensSpan(Span):
    """A minimal Haystack span that just accumulates tags for the tracer to read."""

    def __init__(self) -> None:
        self.tags: dict[str, Any] = {}
        self.started_at = time.time()

    def set_tag(self, key: str, value: Any) -> None:
        self.tags[key] = value

    def raw_span(self) -> Any:
        return self

    def get_correlation_data_for_logs(self) -> dict[str, Any]:
        return {}


class AgentLensTracer(Tracer):
    """Logs Haystack Generator/ChatGenerator component runs to AgentLens."""

    def __init__(
        self,
        client: Any | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        redact: bool = False,
    ) -> None:
        self._client = client
        self._agent_id = agent_id
        self._session_id = session_id or str(uuid.uuid4())
        self._redact = redact
        self._current: AgentLensSpan | None = None

    @contextmanager
    def trace(
        self,
        operation_name: str,
        tags: dict[str, Any] | None = None,
        parent_span: Span | None = None,
    ) -> Iterator[Span]:
        span = AgentLensSpan()
        if tags:
            span.tags.update(tags)
        previous = self._current
        self._current = span
        try:
            yield span
        finally:
            self._current = previous
            with suppress(Exception):
                self._maybe_log(span)

    def current_span(self) -> Span | None:
        return self._current

    def get_correlation_data_for_logs(self) -> dict[str, Any]:
        return {}

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

    def _maybe_log(self, span: AgentLensSpan) -> None:
        comp_type = str(span.tags.get("haystack.component.type", ""))
        if "Generator" not in comp_type:
            return  # only LLM components

        output = span.tags.get("haystack.component.output") or {}
        replies = _get(output, "replies") or []
        first = replies[0] if isinstance(replies, list) and replies else None

        # meta carrying model + usage: output-level list, or the reply's own meta.
        meta_list = _get(output, "meta")
        out_meta = meta_list[0] if isinstance(meta_list, list) and meta_list else None
        meta = out_meta or _get(first, "meta") or {}
        model = str(_get(meta, "model") or "unknown")

        config = self._config()
        if config is None:
            return
        client, agent_id, session_id, redact = config
        inp, out, total = _usage(meta)

        from agentlensai.models import LlmMessage, LogLlmCallParams, TokenUsage

        inputs = _messages_from_input(span.tags.get("haystack.component.input"))
        params = LogLlmCallParams(
            provider=_provider_from_model(model),
            model=model,
            messages=[LlmMessage(role=cast(Any, m["role"]), content=m["content"]) for m in inputs],
            completion=_completion_from_reply(first),
            finish_reason="stop",
            usage=TokenUsage(input_tokens=inp, output_tokens=out, total_tokens=total),
            cost_usd=0.0,
            latency_ms=(time.time() - span.started_at) * 1000.0,
            redact=redact or None,
        )
        client.log_llm_call(session_id, agent_id, params)

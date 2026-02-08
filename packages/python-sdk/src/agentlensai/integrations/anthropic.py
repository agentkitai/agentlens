"""Auto-instrumentation for the Anthropic Python SDK.

Monkey-patches ``anthropic.resources.messages.Messages.create`` (sync) and
``anthropic.resources.messages.AsyncMessages.create`` (async) to automatically
capture every *non-streaming* call and forward telemetry to AgentLens.
"""
from __future__ import annotations

import functools
import time
from typing import Any

_original_create: Any = None
_original_async_create: Any = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_system_prompt(raw: Any) -> str | None:
    """Normalise the ``system`` parameter to a plain string or ``None``."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        return " ".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in raw
        )
    return str(raw)


def _extract_params(kwargs: dict[str, Any]) -> dict[str, Any] | None:
    """Pull out model parameters we want to log."""
    params: dict[str, Any] = {}
    for key in ("temperature", "max_tokens", "top_p", "top_k", "stop_sequences"):
        if key in kwargs and kwargs[key] is not None:
            params[key] = kwargs[key]
    return params or None


def _normalise_messages(messages: Any) -> list[dict[str, Any]]:
    """Turn the caller's ``messages`` list into simple ``{role, content}`` dicts."""
    out: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user") if isinstance(msg, dict) else getattr(msg, "role", "user")
        content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
        if isinstance(content, list):
            text_parts: list[str] = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
                elif isinstance(part, dict):
                    text_parts.append(str(part))
            content = " ".join(text_parts)
        out.append({"role": str(role), "content": str(content)})
    return out


def _build_call_data(
    response: Any,
    model_hint: Any,
    messages: Any,
    system_prompt: str | None,
    params: dict[str, Any] | None,
    latency_ms: float,
) -> Any:
    """Build an ``LlmCallData`` from the Anthropic response."""
    from agentlensai._sender import LlmCallData

    # Extract completion text and tool calls from content blocks
    completion_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for block in response.content:
        if block.type == "text":
            completion_parts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append({
                "id": block.id,
                "name": block.name,
                "arguments": block.input,
            })

    completion = "\n".join(completion_parts) if completion_parts else None
    user_messages = _normalise_messages(messages)

    return LlmCallData(
        provider="anthropic",
        model=response.model or str(model_hint),
        messages=user_messages,
        system_prompt=system_prompt,
        completion=completion,
        tool_calls=tool_calls if tool_calls else None,
        finish_reason=response.stop_reason or "unknown",
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        total_tokens=response.usage.input_tokens + response.usage.output_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
        parameters=params,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def instrument_anthropic() -> None:
    """Patch Anthropic SDK to auto-capture messages.create calls."""
    global _original_create, _original_async_create  # noqa: PLW0603
    from anthropic.resources.messages import AsyncMessages, Messages

    _original_create = Messages.create
    _original_async_create = AsyncMessages.create

    # -- Sync wrapper -------------------------------------------------------
    @functools.wraps(_original_create)
    def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        from agentlensai._sender import get_sender
        from agentlensai._state import get_state

        state = get_state()
        if state is None or kwargs.get("stream", False):
            return _original_create(self, *args, **kwargs)

        start_time = time.perf_counter()
        model = kwargs.get("model", args[0] if args else "unknown")
        messages = kwargs.get("messages", [])
        system_prompt = _extract_system_prompt(kwargs.get("system"))
        params = _extract_params(kwargs)

        try:
            response = _original_create(self, *args, **kwargs)
        except Exception:
            raise

        try:
            latency_ms = (time.perf_counter() - start_time) * 1000
            data = _build_call_data(response, model, messages, system_prompt, params, latency_ms)
            get_sender().send(state, data)
        except Exception:
            pass  # Never break user code

        return response

    Messages.create = patched_create  # type: ignore[assignment]

    # -- Async wrapper ------------------------------------------------------
    @functools.wraps(_original_async_create)
    async def patched_async_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        from agentlensai._sender import get_sender
        from agentlensai._state import get_state

        state = get_state()
        if state is None or kwargs.get("stream", False):
            return await _original_async_create(self, *args, **kwargs)

        start_time = time.perf_counter()
        model = kwargs.get("model", args[0] if args else "unknown")
        messages = kwargs.get("messages", [])
        system_prompt = _extract_system_prompt(kwargs.get("system"))
        params = _extract_params(kwargs)

        try:
            response = await _original_async_create(self, *args, **kwargs)
        except Exception:
            raise

        try:
            latency_ms = (time.perf_counter() - start_time) * 1000
            data = _build_call_data(response, model, messages, system_prompt, params, latency_ms)
            get_sender().send(state, data)
        except Exception:
            pass  # Never break user code

        return response

    AsyncMessages.create = patched_async_create  # type: ignore[assignment]


def uninstrument_anthropic() -> None:
    """Restore the original Anthropic SDK methods."""
    global _original_create, _original_async_create  # noqa: PLW0603
    if _original_create is not None:
        from anthropic.resources.messages import Messages

        Messages.create = _original_create  # type: ignore[assignment]
        _original_create = None
    if _original_async_create is not None:
        from anthropic.resources.messages import AsyncMessages

        AsyncMessages.create = _original_async_create  # type: ignore[assignment]
        _original_async_create = None

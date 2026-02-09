"""Auto-instrumentation for the OpenAI Python SDK.

Monkey-patches ``openai.resources.chat.completions`` so that every
(non-streaming) chat completion call is captured and sent to AgentLens.

Usage::

    from agentlensai.integrations.openai import instrument_openai, uninstrument_openai

    instrument_openai()   # start capturing
    uninstrument_openai() # restore originals
"""
from __future__ import annotations

import functools
import logging
import time
from typing import Any

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation, PatchTarget
from agentlensai.integrations.registry import register

logger = logging.getLogger("agentlensai")

# Store originals so we can restore them in uninstrument_openai()
_original_create: Any = None
_original_async_create: Any = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_content_text(content: Any) -> str:
    """Extract text from an OpenAI message ``content`` field.

    ``content`` may be:
    - a plain string
    - a list of content-part dicts (e.g. ``[{"type": "text", "text": "..."}]``)
    - ``None``
    - a Pydantic model / other object
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            else:
                # Pydantic content-part object
                parts.append(getattr(part, "text", str(part)))
        return " ".join(parts)
    return str(content)


def _extract_messages(raw_messages: Any) -> tuple[str | None, list[dict[str, Any]]]:
    """Return ``(system_prompt, messages_list)`` from the raw messages arg."""
    system_prompt: str | None = None
    user_messages: list[dict[str, Any]] = []

    if not raw_messages:
        return system_prompt, user_messages

    for msg in raw_messages:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            # Pydantic / typed-dict style message objects
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")

        text = _extract_content_text(content)

        if role == "system":
            system_prompt = text

        user_messages.append({"role": str(role), "content": text})

    return system_prompt, user_messages


def _extract_params(kwargs: dict[str, Any]) -> dict[str, Any] | None:
    """Pull out well-known generation parameters when present."""
    params: dict[str, Any] = {}
    for key in (
        "temperature",
        "max_tokens",
        "top_p",
        "stop",
        "frequency_penalty",
        "presence_penalty",
    ):
        val = kwargs.get(key)
        if val is not None:
            params[key] = val
    return params or None


def _build_call_data(
    response: Any,
    model_hint: Any,
    messages: Any,
    params: dict[str, Any] | None,
    latency_ms: float,
) -> LlmCallData:
    """Build an ``LlmCallData`` from a completed (non-streaming) response."""
    # Response fields ---------------------------------------------------
    choice = response.choices[0] if response.choices else None
    completion = choice.message.content if choice and choice.message else None
    finish_reason = choice.finish_reason if choice else "unknown"

    # Tool calls
    tool_calls: list[dict[str, Any]] | None = None
    if choice and choice.message and choice.message.tool_calls:
        tool_calls = []
        for tc in choice.message.tool_calls:
            tool_calls.append(
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }
            )

    # Usage
    input_tokens = response.usage.prompt_tokens if response.usage else 0
    output_tokens = response.usage.completion_tokens if response.usage else 0
    total_tokens = response.usage.total_tokens if response.usage else 0

    # Messages
    system_prompt, user_messages = _extract_messages(messages)

    return LlmCallData(
        provider="openai",
        model=response.model or str(model_hint),
        messages=user_messages,
        system_prompt=system_prompt,
        completion=completion,
        tool_calls=tool_calls,
        finish_reason=str(finish_reason),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
        parameters=params,
    )


# ---------------------------------------------------------------------------
# BaseLLMInstrumentation subclass
# ---------------------------------------------------------------------------

@register("openai")
class OpenAIInstrumentation(BaseLLMInstrumentation):
    """OpenAI chat completions instrumentation.

    Overrides the base ``instrument``/``uninstrument`` to maintain the
    module-level ``_original_create`` / ``_original_async_create`` references
    used by backward-compatible wrapper functions.
    """

    provider_name = "openai"

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            PatchTarget(
                module_path="openai.resources.chat.completions",
                class_name="Completions",
                attr_name="create",
                is_async=False,
            ),
            PatchTarget(
                module_path="openai.resources.chat.completions",
                class_name="AsyncCompletions",
                attr_name="create",
                is_async=True,
            ),
        ]

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return bool(kwargs.get("stream", False))

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return str(kwargs.get("model", args[0] if args else "unknown"))

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        model_hint = kwargs.get("model", "unknown")
        messages = kwargs.get("messages", [])
        params = _extract_params(kwargs)
        return _build_call_data(response, model_hint, messages, params, latency_ms)

    def instrument(self) -> None:
        """Patch OpenAI SDK using module-level original references."""
        global _original_create, _original_async_create  # noqa: PLW0603

        if self._instrumented:
            return

        from openai.resources.chat.completions import (
            AsyncCompletions,
            Completions,
        )

        _original_create = Completions.create
        _original_async_create = AsyncCompletions.create

        # -- Sync wrapper -----------------------------------------------
        @functools.wraps(_original_create)
        def patched_create(self_sdk: Any, *args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return _original_create(self_sdk, *args, **kwargs)
            if kwargs.get("stream", False):
                return _original_create(self_sdk, *args, **kwargs)

            start_time = time.perf_counter()
            model_hint = kwargs.get("model", args[0] if args else "unknown")
            messages = kwargs.get("messages", args[1] if len(args) > 1 else [])
            params = _extract_params(kwargs)

            response = _original_create(self_sdk, *args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = _build_call_data(response, model_hint, messages, params, latency_ms)
                get_sender().send(state, data)
            except Exception:  # noqa: BLE001
                logger.debug("AgentLens: failed to capture OpenAI call", exc_info=True)

            return response

        Completions.create = patched_create  # type: ignore[assignment,method-assign]

        # -- Async wrapper ----------------------------------------------
        @functools.wraps(_original_async_create)
        async def patched_async_create(self_sdk: Any, *args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return await _original_async_create(self_sdk, *args, **kwargs)
            if kwargs.get("stream", False):
                return await _original_async_create(self_sdk, *args, **kwargs)

            start_time = time.perf_counter()
            model_hint = kwargs.get("model", args[0] if args else "unknown")
            messages = kwargs.get("messages", args[1] if len(args) > 1 else [])
            params = _extract_params(kwargs)

            response = await _original_async_create(self_sdk, *args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = _build_call_data(response, model_hint, messages, params, latency_ms)
                get_sender().send(state, data)
            except Exception:  # noqa: BLE001
                logger.debug("AgentLens: failed to capture async OpenAI call", exc_info=True)

            return response

        AsyncCompletions.create = patched_async_create  # type: ignore[assignment,method-assign]

        self._instrumented = True
        logger.debug("AgentLens: OpenAI integration instrumented")

    def uninstrument(self) -> None:
        """Restore the original OpenAI SDK methods."""
        global _original_create, _original_async_create  # noqa: PLW0603

        if not self._instrumented:
            return

        if _original_create is not None:
            from openai.resources.chat.completions import Completions
            Completions.create = _original_create  # type: ignore[method-assign]

        if _original_async_create is not None:
            from openai.resources.chat.completions import AsyncCompletions
            AsyncCompletions.create = _original_async_create  # type: ignore[method-assign]

        _original_create = None
        _original_async_create = None
        self._instrumented = False
        logger.debug("AgentLens: OpenAI integration uninstrumented")


# ---------------------------------------------------------------------------
# Backward-compatible thin wrappers
# ---------------------------------------------------------------------------

_instance: OpenAIInstrumentation | None = None


def instrument_openai() -> None:
    """Monkey-patch the OpenAI SDK to capture all chat completion calls."""
    global _instance  # noqa: PLW0603

    # Guard against double-instrumentation
    if _original_create is not None:
        return

    _instance = OpenAIInstrumentation()
    _instance.instrument()


def uninstrument_openai() -> None:
    """Restore the original OpenAI SDK methods."""
    global _instance  # noqa: PLW0603

    if _instance is not None:
        _instance.uninstrument()
        _instance = None
    else:
        # Legacy cleanup: reset module globals even without instance
        global _original_create, _original_async_create  # noqa: PLW0603
        if _original_create is not None:
            from openai.resources.chat.completions import Completions
            Completions.create = _original_create  # type: ignore[method-assign]
            _original_create = None
        if _original_async_create is not None:
            from openai.resources.chat.completions import AsyncCompletions
            AsyncCompletions.create = _original_async_create  # type: ignore[method-assign]
            _original_async_create = None

"""Auto-instrumentation for the Mistral AI Python SDK.

Monkey-patches ``mistralai.Mistral.chat`` methods so that every
(non-streaming) chat call is captured and sent to AgentLens.

Usage::

    from agentlensai.integrations.mistral import MistralInstrumentation

    inst = MistralInstrumentation()
    inst.instrument()
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_messages(raw_messages: Any) -> tuple[str | None, list[dict[str, Any]]]:
    """Extract (system_prompt, messages) from Mistral-style messages."""
    system_prompt: str | None = None
    messages: list[dict[str, Any]] = []

    if not raw_messages:
        return system_prompt, messages

    for msg in raw_messages:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")

        text = str(content) if content else ""
        if role == "system":
            system_prompt = text
        messages.append({"role": str(role), "content": text})

    return system_prompt, messages


def _extract_params(kwargs: dict[str, Any]) -> dict[str, Any] | None:
    """Pull out well-known generation parameters."""
    params: dict[str, Any] = {}
    for key in ("temperature", "max_tokens", "top_p", "stop"):
        val = kwargs.get(key)
        if val is not None:
            params[key] = val
    return params or None


def _build_call_data(response: Any, kwargs: dict[str, Any], latency_ms: float) -> LlmCallData:
    """Build LlmCallData from a Mistral ChatCompletionResponse."""
    choice = response.choices[0] if response.choices else None
    completion = choice.message.content if choice and choice.message else None
    finish_reason = choice.finish_reason if choice else "unknown"

    # Tool calls
    tool_calls: list[dict[str, Any]] | None = None
    if choice and choice.message and getattr(choice.message, "tool_calls", None):
        tool_calls = []
        for tc in choice.message.tool_calls:
            tool_calls.append(
                {
                    "id": getattr(tc, "id", ""),
                    "name": getattr(tc.function, "name", "") if hasattr(tc, "function") else "",
                    "arguments": getattr(tc.function, "arguments", "")
                    if hasattr(tc, "function")
                    else "",
                }
            )

    input_tokens = response.usage.prompt_tokens if response.usage else 0
    output_tokens = response.usage.completion_tokens if response.usage else 0
    total_tokens = response.usage.total_tokens if response.usage else (input_tokens + output_tokens)

    model = getattr(response, "model", kwargs.get("model", "unknown"))

    messages_raw = kwargs.get("messages", [])
    system_prompt, messages = _extract_messages(messages_raw)
    params = _extract_params(kwargs)

    return LlmCallData(
        provider="mistral",
        model=str(model),
        messages=messages,
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
# Instrumentation class
# ---------------------------------------------------------------------------


@register("mistral")
class MistralInstrumentation(BaseLLMInstrumentation):
    """Mistral AI SDK instrumentation.

    Patches chat.complete, chat.complete_async, chat.stream, chat.stream_async
    on the mistralai SDK's Chat class.
    """

    provider_name = "mistral"
    _original_complete: Any = None
    _original_complete_async: Any = None

    def _get_patch_targets(self) -> list[PatchTarget]:
        # Not used — we override instrument() directly for the nested chat object
        return []

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return False

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return str(kwargs.get("model", "unknown"))

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        return _build_call_data(response, kwargs, latency_ms)

    def instrument(self) -> None:
        """Patch Mistral SDK chat methods."""
        if self._instrumented:
            return

        try:
            from mistralai.chat import Chat
        except ImportError:
            logger.debug("AgentLens: mistralai not installed, skipping")
            raise

        # Save originals (only methods we actually patch)
        self._original_complete = Chat.complete
        self._original_complete_async = Chat.complete_async

        # --- Sync complete ---
        orig_complete = self._original_complete

        @functools.wraps(orig_complete)
        def patched_complete(chat_self: Any, *args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return orig_complete(chat_self, *args, **kwargs)

            start = time.perf_counter()
            response = orig_complete(chat_self, *args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start) * 1000
                data = _build_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture Mistral complete", exc_info=True)

            return response

        Chat.complete = patched_complete

        # --- Async complete ---
        orig_async = self._original_complete_async

        @functools.wraps(orig_async)
        async def patched_complete_async(chat_self: Any, *args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return await orig_async(chat_self, *args, **kwargs)

            start = time.perf_counter()
            response = await orig_async(chat_self, *args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start) * 1000
                data = _build_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture Mistral async complete", exc_info=True)

            return response

        Chat.complete_async = patched_complete_async

        # --- Stream (pass-through, no capture) ---
        # Streaming calls are passed through without capture (same as other providers)

        self._instrumented = True
        logger.debug("AgentLens: Mistral integration instrumented")

    def uninstrument(self) -> None:
        """Restore original Mistral SDK methods."""
        if not self._instrumented:
            return

        try:
            from mistralai.chat import Chat

            if self._original_complete is not None:
                Chat.complete = self._original_complete
            if self._original_complete_async is not None:
                Chat.complete_async = self._original_complete_async
        except ImportError:
            pass

        self._original_complete = None
        self._original_complete_async = None
        self._instrumented = False
        logger.debug("AgentLens: Mistral integration uninstrumented")

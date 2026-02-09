"""Auto-instrumentation for Cohere Python SDK.

Supports:
- v2 API: ``cohere.ClientV2.chat``
- v1 API: ``cohere.Client.chat`` and ``cohere.Client.generate``
- Streaming: ``chat_stream()`` passed through (not captured).
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


def _extract_v2_call_data(response: Any, kwargs: dict[str, Any], latency_ms: float) -> LlmCallData:
    """Extract data from a Cohere v2 chat response."""
    # Completion text
    completion = None
    try:
        content = response.message.content
        if content and len(content) > 0:
            completion = content[0].text
    except Exception:
        pass

    # Usage
    input_tokens = 0
    output_tokens = 0
    try:
        input_tokens = response.usage.tokens.input_tokens
        output_tokens = response.usage.tokens.output_tokens
    except Exception:
        pass

    model = str(kwargs.get("model", "unknown"))
    messages = _extract_messages(kwargs.get("messages", []))

    return LlmCallData(
        provider="cohere",
        model=model,
        messages=messages,
        system_prompt=None,
        completion=completion,
        tool_calls=None,
        finish_reason="stop",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
    )


def _extract_v1_chat_data(response: Any, kwargs: dict[str, Any], latency_ms: float) -> LlmCallData:
    """Extract data from a Cohere v1 chat response."""
    completion = getattr(response, "text", None)

    input_tokens = 0
    output_tokens = 0
    try:
        tokens = response.meta.tokens
        input_tokens = getattr(tokens, "input_tokens", 0)
        output_tokens = getattr(tokens, "output_tokens", 0)
    except Exception:
        pass

    model = str(kwargs.get("model", "unknown"))
    message = kwargs.get("message", "")
    messages = [{"role": "user", "content": str(message)}] if message else []

    return LlmCallData(
        provider="cohere",
        model=model,
        messages=messages,
        system_prompt=None,
        completion=completion,
        tool_calls=None,
        finish_reason="stop",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
    )


def _extract_generate_data(response: Any, kwargs: dict[str, Any], latency_ms: float) -> LlmCallData:
    """Extract data from a Cohere generate response."""
    completion = None
    try:
        if response.generations:
            completion = response.generations[0].text
    except Exception:
        pass

    # Generate doesn't always have token counts in the same way
    input_tokens = 0
    output_tokens = 0
    try:
        meta = getattr(response, "meta", None)
        if meta:
            tokens = getattr(meta, "tokens", None) or getattr(meta, "billed_units", None)
            if tokens:
                input_tokens = getattr(tokens, "input_tokens", 0)
                output_tokens = getattr(tokens, "output_tokens", 0)
    except Exception:
        pass

    model = str(kwargs.get("model", "unknown"))
    prompt = kwargs.get("prompt", "")
    messages = [{"role": "user", "content": str(prompt)}] if prompt else []

    return LlmCallData(
        provider="cohere",
        model=model,
        messages=messages,
        system_prompt=None,
        completion=completion,
        tool_calls=None,
        finish_reason="stop",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
    )


def _extract_messages(raw_messages: Any) -> list[dict[str, Any]]:
    """Convert Cohere message format to AgentLens format."""
    messages: list[dict[str, Any]] = []
    if not raw_messages:
        return messages
    for msg in raw_messages:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")
        messages.append({"role": str(role), "content": str(content)})
    return messages


@register("cohere")
class CohereInstrumentation(BaseLLMInstrumentation):
    provider_name = "cohere"

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            # v2 API
            PatchTarget(
                module_path="cohere",
                class_name="ClientV2",
                attr_name="chat",
                is_async=False,
            ),
            # v1 API
            PatchTarget(
                module_path="cohere",
                class_name="Client",
                attr_name="chat",
                is_async=False,
            ),
            # v1 generate
            PatchTarget(
                module_path="cohere",
                class_name="Client",
                attr_name="generate",
                is_async=False,
            ),
        ]

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return bool(kwargs.get("stream", False))

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return str(kwargs.get("model", "unknown"))

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        # Best-effort fallback — normally dispatched per-method in custom wrappers.
        # Try v2 first, fall back to v1 chat, then return a default.
        try:
            return _extract_v2_call_data(response, kwargs, latency_ms)
        except Exception:
            pass
        try:
            return _extract_v1_chat_data(response, kwargs, latency_ms)
        except Exception:
            pass
        return LlmCallData(
            provider="cohere",
            model=str(kwargs.get("model", "unknown")),
            messages=_extract_messages(kwargs.get("messages", [])),
            system_prompt=None,
            completion=None,
            tool_calls=None,
            finish_reason="unknown",
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )

    def instrument(self) -> None:
        if self._instrumented:
            return

        import importlib

        targets_extractors = [
            (self._get_patch_targets()[0], _extract_v2_call_data),  # ClientV2.chat
            (self._get_patch_targets()[1], _extract_v1_chat_data),  # Client.chat
            (self._get_patch_targets()[2], _extract_generate_data),  # Client.generate
        ]

        for target, extractor in targets_extractors:
            key = f"{target.module_path}.{target.class_name}.{target.attr_name}"
            try:
                mod = importlib.import_module(target.module_path)
                owner = getattr(mod, target.class_name) if target.class_name else mod
                original = getattr(owner, target.attr_name)
                self._originals[key] = (owner, target.attr_name, original)

                wrapper = self._make_method_wrapper(original, extractor)
                setattr(owner, target.attr_name, wrapper)
            except Exception:
                logger.debug("AgentLens: failed to patch %s", key, exc_info=True)

        self._instrumented = True
        logger.debug("AgentLens: cohere instrumented")

    def _make_method_wrapper(self, original: Any, extractor: Any) -> Any:
        instrumentation = self

        @functools.wraps(original)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return original(*args, **kwargs)
            if instrumentation._is_streaming(kwargs):
                return original(*args, **kwargs)

            start_time = time.perf_counter()
            response = original(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = extractor(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture cohere call", exc_info=True)

            return response

        return wrapper

"""Auto-instrumentation for the LiteLLM library.

Monkey-patches ``litellm.completion`` and ``litellm.acompletion`` so that
every (non-streaming) call is captured and sent to AgentLens.  Streaming
calls are wrapped to accumulate chunks and emit a final event on completion.

Usage::

    from agentlensai.integrations.litellm import LiteLLMInstrumentation

    inst = LiteLLMInstrumentation()
    inst.instrument()   # start capturing
    inst.uninstrument() # restore originals
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


def _extract_messages(kwargs: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    """Return ``(system_prompt, messages_list)`` from kwargs."""
    system_prompt: str | None = None
    user_messages: list[dict[str, Any]] = []
    raw = kwargs.get("messages", [])
    for msg in raw:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")
        if role == "system":
            system_prompt = str(content) if content else ""
        user_messages.append({"role": str(role), "content": str(content) if content else ""})
    return system_prompt, user_messages


def _extract_params(kwargs: dict[str, Any]) -> dict[str, Any] | None:
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
    kwargs: dict[str, Any],
    latency_ms: float,
    *,
    is_streaming: bool = False,
    accumulated_content: str | None = None,
    accumulated_usage: dict[str, int] | None = None,
) -> LlmCallData:
    """Build ``LlmCallData`` from a LiteLLM response."""
    model_hint = kwargs.get("model", "unknown")
    system_prompt, user_messages = _extract_messages(kwargs)
    params = _extract_params(kwargs)

    # Extract completion text, finish reason, tokens, model
    if is_streaming:
        completion = accumulated_content or ""
        finish_reason = "stop"
        if accumulated_usage:
            input_tokens = accumulated_usage.get("prompt_tokens", 0)
            output_tokens = accumulated_usage.get("completion_tokens", 0)
            total_tokens = accumulated_usage.get("total_tokens", 0)
        else:
            input_tokens = 0
            output_tokens = 0
            total_tokens = 0
        model = str(model_hint)
    else:
        choice = response.choices[0] if getattr(response, "choices", None) else None
        completion = (
            str(choice.message.content)
            if choice and hasattr(choice, "message") and choice.message and choice.message.content
            else ""
        )
        finish_reason = (
            str(choice.finish_reason) if choice and hasattr(choice, "finish_reason") else "unknown"
        )
        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
        output_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
        total_tokens = getattr(usage, "total_tokens", 0) if usage else 0
        model = getattr(response, "model", None) or str(model_hint)

    # Cost via litellm.completion_cost
    cost_usd = 0.0
    if not is_streaming:
        try:
            import litellm

            cost_usd = litellm.completion_cost(completion_response=response)
        except Exception:
            pass

    # Provider metadata
    provider = "litellm"
    metadata: dict[str, Any] = {}
    hidden = getattr(response, "_hidden_params", None)
    if isinstance(hidden, dict):
        custom_provider = hidden.get("custom_llm_provider")
        if custom_provider:
            metadata["custom_llm_provider"] = custom_provider

    api_base = kwargs.get("api_base")
    if api_base:
        metadata["api_base"] = api_base

    # Tool calls (only available for non-streaming responses)
    tool_calls: list[dict[str, Any]] | None = None
    if not is_streaming and response is not None:
        choice = response.choices[0] if getattr(response, "choices", None) else None
        if (
            choice
            and hasattr(choice, "message")
            and choice.message
            and getattr(choice.message, "tool_calls", None)
        ):
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

    # Merge metadata into parameters
    combined_params = params or {}
    if metadata:
        combined_params = {**(params or {}), "metadata": metadata}

    return LlmCallData(
        provider=provider,
        model=model,
        messages=user_messages,
        system_prompt=system_prompt,
        completion=completion,
        tool_calls=tool_calls,
        finish_reason=finish_reason,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        parameters=combined_params or None,
    )


# ---------------------------------------------------------------------------
# Stream wrappers
# ---------------------------------------------------------------------------


class _SyncStreamWrapper:
    """Wraps a LiteLLM sync stream to accumulate chunks and emit event on completion."""

    def __init__(self, stream: Any, kwargs: dict[str, Any], start_time: float) -> None:
        self._stream = stream
        self._kwargs = kwargs
        self._start_time = start_time
        self._chunks: list[str] = []
        self._usage: dict[str, int] = {}
        self._finished = False

    def __iter__(self) -> _SyncStreamWrapper:
        return self

    def __next__(self) -> Any:
        try:
            chunk = next(self._stream)
            self._accumulate(chunk)
            return chunk
        except StopIteration:
            self._emit()
            raise

    def _accumulate(self, chunk: Any) -> None:
        choices = getattr(chunk, "choices", None)
        if choices:
            delta = getattr(choices[0], "delta", None)
            if delta:
                content = getattr(delta, "content", None)
                if content:
                    self._chunks.append(content)
        # Check for usage on chunk
        usage = getattr(chunk, "usage", None)
        if usage:
            self._usage["prompt_tokens"] = getattr(usage, "prompt_tokens", 0) or 0
            self._usage["completion_tokens"] = getattr(usage, "completion_tokens", 0) or 0
            self._usage["total_tokens"] = getattr(usage, "total_tokens", 0) or 0

    def _emit(self) -> None:
        if self._finished:
            return
        self._finished = True
        try:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return

            latency_ms = (time.perf_counter() - self._start_time) * 1000
            data = _build_call_data(
                response=None,
                kwargs=self._kwargs,
                latency_ms=latency_ms,
                is_streaming=True,
                accumulated_content="".join(self._chunks),
                accumulated_usage=self._usage,
            )
            get_sender().send(state, data)
        except Exception:
            logger.debug("AgentLens: failed to capture LiteLLM stream", exc_info=True)


class _AsyncStreamWrapper:
    """Wraps a LiteLLM async stream to accumulate chunks and emit event on completion."""

    def __init__(self, stream: Any, kwargs: dict[str, Any], start_time: float) -> None:
        self._stream = stream
        self._kwargs = kwargs
        self._start_time = start_time
        self._chunks: list[str] = []
        self._usage: dict[str, int] = {}
        self._finished = False

    def __aiter__(self) -> _AsyncStreamWrapper:
        return self

    async def __anext__(self) -> Any:
        try:
            chunk = await self._stream.__anext__()
            self._accumulate(chunk)
            return chunk
        except StopAsyncIteration:
            self._emit()
            raise

    def _accumulate(self, chunk: Any) -> None:
        choices = getattr(chunk, "choices", None)
        if choices:
            delta = getattr(choices[0], "delta", None)
            if delta:
                content = getattr(delta, "content", None)
                if content:
                    self._chunks.append(content)
        usage = getattr(chunk, "usage", None)
        if usage:
            self._usage["prompt_tokens"] = getattr(usage, "prompt_tokens", 0) or 0
            self._usage["completion_tokens"] = getattr(usage, "completion_tokens", 0) or 0
            self._usage["total_tokens"] = getattr(usage, "total_tokens", 0) or 0

    def _emit(self) -> None:
        if self._finished:
            return
        self._finished = True
        try:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return

            latency_ms = (time.perf_counter() - self._start_time) * 1000
            data = _build_call_data(
                response=None,
                kwargs=self._kwargs,
                latency_ms=latency_ms,
                is_streaming=True,
                accumulated_content="".join(self._chunks),
                accumulated_usage=self._usage,
            )
            get_sender().send(state, data)
        except Exception:
            logger.debug("AgentLens: failed to capture async LiteLLM stream", exc_info=True)


# ---------------------------------------------------------------------------
# LiteLLMInstrumentation
# ---------------------------------------------------------------------------


@register("litellm")
class LiteLLMInstrumentation(BaseLLMInstrumentation):
    """LiteLLM auto-instrumentation.

    Patches ``litellm.completion`` and ``litellm.acompletion`` module-level
    functions.  Streaming calls are wrapped to accumulate chunks.
    """

    provider_name = "litellm"

    _original_completion: Any = None
    _original_acompletion: Any = None

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            PatchTarget(
                module_path="litellm", class_name=None, attr_name="completion", is_async=False
            ),
            PatchTarget(
                module_path="litellm", class_name=None, attr_name="acompletion", is_async=True
            ),
        ]

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return bool(kwargs.get("stream", False))

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return str(kwargs.get("model", args[0] if args else "unknown"))

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        return _build_call_data(response, kwargs, latency_ms)

    def instrument(self) -> None:
        """Patch litellm.completion and litellm.acompletion."""
        if self._instrumented:
            return

        import litellm

        self._original_completion = litellm.completion
        self._original_acompletion = litellm.acompletion

        orig_completion = self._original_completion
        orig_acompletion = self._original_acompletion

        @functools.wraps(orig_completion)
        def patched_completion(*args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return orig_completion(*args, **kwargs)

            # Streaming — wrap the result
            if kwargs.get("stream", False):
                start_time = time.perf_counter()
                result = orig_completion(*args, **kwargs)
                return _SyncStreamWrapper(result, kwargs, start_time)

            start_time = time.perf_counter()
            response = orig_completion(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = _build_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture LiteLLM call", exc_info=True)

            return response

        @functools.wraps(orig_acompletion)
        async def patched_acompletion(*args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return await orig_acompletion(*args, **kwargs)

            # Streaming — wrap the result
            if kwargs.get("stream", False):
                start_time = time.perf_counter()
                result = await orig_acompletion(*args, **kwargs)
                return _AsyncStreamWrapper(result, kwargs, start_time)

            start_time = time.perf_counter()
            response = await orig_acompletion(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = _build_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture async LiteLLM call", exc_info=True)

            return response

        litellm.completion = patched_completion
        litellm.acompletion = patched_acompletion
        self._instrumented = True
        logger.debug("AgentLens: LiteLLM integration instrumented")

    def uninstrument(self) -> None:
        """Restore original litellm functions."""
        if not self._instrumented:
            return

        import litellm

        if self._original_completion is not None:
            litellm.completion = self._original_completion
        if self._original_acompletion is not None:
            litellm.acompletion = self._original_acompletion

        self._original_completion = None
        self._original_acompletion = None
        self._instrumented = False
        logger.debug("AgentLens: LiteLLM integration uninstrumented")

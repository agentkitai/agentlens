"""Auto-instrumentation for Google Gemini (google-generativeai SDK).

Patches ``google.generativeai.GenerativeModel.generate_content`` (sync)
and ``generate_content_async`` (async). Streaming calls are passed through.
"""

from __future__ import annotations

import logging
from typing import Any

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation, PatchTarget
from agentlensai.integrations.registry import register

logger = logging.getLogger("agentlensai")


@register("gemini")
class GeminiInstrumentation(BaseLLMInstrumentation):
    provider_name = "gemini"

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            PatchTarget(
                module_path="google.generativeai",
                class_name="GenerativeModel",
                attr_name="generate_content",
                is_async=False,
            ),
            PatchTarget(
                module_path="google.generativeai",
                class_name="GenerativeModel",
                attr_name="generate_content_async",
                is_async=True,
            ),
        ]

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return bool(kwargs.get("stream", False))

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return str(kwargs.get("model", "unknown"))

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        # Extract usage
        usage = getattr(response, "usage_metadata", None)
        input_tokens = getattr(usage, "prompt_token_count", 0) if usage else 0
        output_tokens = getattr(usage, "candidates_token_count", 0) if usage else 0
        total_tokens = getattr(usage, "total_token_count", 0) if usage else 0

        # Extract completion text
        completion = None
        try:
            candidates = getattr(response, "candidates", [])
            if candidates:
                parts = candidates[0].content.parts
                if parts:
                    completion = parts[0].text
        except Exception:
            pass

        # Content as messages
        content_arg = kwargs.get("contents")
        messages: list[dict[str, Any]] = []
        if content_arg:
            if isinstance(content_arg, str):
                messages = [{"role": "user", "content": content_arg}]
            elif isinstance(content_arg, list):
                for item in content_arg:
                    if isinstance(item, str):
                        messages.append({"role": "user", "content": item})
                    else:
                        messages.append({"role": "user", "content": str(item)})

        return LlmCallData(
            provider="gemini",
            model=kwargs.get("_agentlens_model", "unknown"),
            messages=messages,
            system_prompt=None,
            completion=completion,
            tool_calls=None,
            finish_reason="stop",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )

    def _make_sync_wrapper(self, original: Any) -> Any:
        instrumentation = self
        import functools

        @functools.wraps(original)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            import time

            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return original(*args, **kwargs)
            if instrumentation._is_streaming(kwargs):
                return original(*args, **kwargs)

            model_name = "unknown"
            if args:
                model_name = getattr(
                    args[0], "model_name", getattr(args[0], "_model_name", "unknown")
                )

            start_time = time.perf_counter()
            response = original(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                extract_kwargs = {**kwargs, "_agentlens_model": model_name}
                data = instrumentation._extract_call_data(response, extract_kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture gemini call", exc_info=True)

            return response

        return wrapper

    def _make_async_wrapper(self, original: Any) -> Any:
        instrumentation = self
        import functools

        @functools.wraps(original)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            import time

            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return await original(*args, **kwargs)
            if instrumentation._is_streaming(kwargs):
                return await original(*args, **kwargs)

            model_name = "unknown"
            if args:
                model_name = getattr(
                    args[0], "model_name", getattr(args[0], "_model_name", "unknown")
                )

            start_time = time.perf_counter()
            response = await original(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                extract_kwargs = {**kwargs, "_agentlens_model": model_name}
                data = instrumentation._extract_call_data(response, extract_kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:
                logger.debug("AgentLens: failed to capture async gemini call", exc_info=True)

            return response

        return wrapper

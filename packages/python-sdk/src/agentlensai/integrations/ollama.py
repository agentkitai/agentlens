"""Auto-instrumentation for the Ollama Python SDK.

Patches ``ollama.chat`` (module-level), ``ollama.Client.chat``, and
``ollama.AsyncClient.chat``.  Streaming calls (``stream=True``) are
passed through without capture.

Cost is always $0 (local inference), but tokens are still tracked.
"""

from __future__ import annotations

import logging
from typing import Any

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation, PatchTarget
from agentlensai.integrations.registry import register

logger = logging.getLogger("agentlensai")


def _extract_messages(kwargs: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    """Extract system prompt and messages from kwargs."""
    system_prompt: str | None = None
    messages: list[dict[str, Any]] = []
    for msg in kwargs.get("messages", []):
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")
        if role == "system":
            system_prompt = str(content)
        messages.append({"role": str(role), "content": str(content)})
    return system_prompt, messages


def _extract_call_data(response: Any, kwargs: dict[str, Any], latency_ms: float) -> LlmCallData:
    """Parse an Ollama chat response dict into LlmCallData."""
    # Response is a dict with keys: model, message, eval_count, prompt_eval_count, etc.
    completion = None
    try:
        msg = (
            response.get("message", {})
            if isinstance(response, dict)
            else getattr(response, "message", {})
        )
        completion = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
    except Exception:
        pass

    model = "unknown"
    if isinstance(response, dict):
        model = response.get("model", kwargs.get("model", "unknown"))
    else:
        model = getattr(response, "model", kwargs.get("model", "unknown"))

    input_tokens = 0
    output_tokens = 0
    try:
        if isinstance(response, dict):
            input_tokens = response.get("prompt_eval_count", 0) or 0
            output_tokens = response.get("eval_count", 0) or 0
        else:
            input_tokens = getattr(response, "prompt_eval_count", 0) or 0
            output_tokens = getattr(response, "eval_count", 0) or 0
    except Exception:
        pass

    system_prompt, messages = _extract_messages(kwargs)

    return LlmCallData(
        provider="ollama",
        model=str(model),
        messages=messages,
        system_prompt=system_prompt,
        completion=completion,
        tool_calls=None,
        finish_reason="stop",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost_usd=0.0,
        latency_ms=latency_ms,
    )


@register("ollama")
class OllamaInstrumentation(BaseLLMInstrumentation):
    provider_name = "ollama"

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            # Module-level function
            PatchTarget(
                module_path="ollama",
                class_name=None,
                attr_name="chat",
                is_async=False,
            ),
            # Client.chat
            PatchTarget(
                module_path="ollama",
                class_name="Client",
                attr_name="chat",
                is_async=False,
            ),
            # AsyncClient.chat
            PatchTarget(
                module_path="ollama",
                class_name="AsyncClient",
                attr_name="chat",
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
        return _extract_call_data(response, kwargs, latency_ms)

"""Auto-instrumentation for AWS Bedrock Runtime (invoke_model + converse APIs).

Uses botocore event hooks to intercept calls without monkey-patching generated clients.
Handles multi-format responses: Anthropic, Amazon Titan, Meta Llama, and Converse API.

Usage::

    from agentlensai.integrations.bedrock import BedrockInstrumentation

    inst = BedrockInstrumentation()
    inst.instrument()
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation, PatchTarget
from agentlensai.integrations.registry import register

logger = logging.getLogger("agentlensai")


# ---------------------------------------------------------------------------
# Model family detection
# ---------------------------------------------------------------------------

def _detect_model_family(model_id: str) -> str:
    """Detect the model family from a Bedrock modelId string."""
    model_lower = model_id.lower()
    if "anthropic" in model_lower:
        return "anthropic"
    if "amazon" in model_lower or "titan" in model_lower:
        return "titan"
    if "meta" in model_lower or "llama" in model_lower:
        return "llama"
    if "mistral" in model_lower:
        return "mistral"
    if "cohere" in model_lower:
        return "cohere"
    if "ai21" in model_lower:
        return "ai21"
    return "unknown"


# ---------------------------------------------------------------------------
# Response parsing by model family (InvokeModel API)
# ---------------------------------------------------------------------------

def _parse_invoke_response(body: dict[str, Any], family: str) -> dict[str, Any]:
    """Extract content, input_tokens, output_tokens from InvokeModel response body."""
    content = ""
    input_tokens = 0
    output_tokens = 0

    if family == "anthropic":
        # Anthropic on Bedrock
        content_list = body.get("content", [])
        if content_list and isinstance(content_list, list):
            content = content_list[0].get("text", "") if isinstance(content_list[0], dict) else str(content_list[0])
        usage = body.get("usage", {})
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

    elif family == "titan":
        # Amazon Titan
        input_tokens = body.get("inputTextTokenCount", 0)
        results = body.get("results", [])
        if results:
            content = results[0].get("outputText", "")
            output_tokens = results[0].get("tokenCount", 0)

    elif family == "llama":
        # Meta Llama on Bedrock
        content = body.get("generation", "")
        input_tokens = body.get("prompt_token_count", 0)
        output_tokens = body.get("generation_token_count", 0)

    elif family == "mistral":
        # Mistral on Bedrock
        outputs = body.get("outputs", [])
        if outputs:
            content = outputs[0].get("text", "")
        input_tokens = body.get("usage", {}).get("input_tokens", 0)
        output_tokens = body.get("usage", {}).get("output_tokens", 0)

    else:
        # Best effort for unknown families
        content = body.get("completion", body.get("generation", ""))
        input_tokens = body.get("usage", {}).get("input_tokens", 0)
        output_tokens = body.get("usage", {}).get("output_tokens", 0)

    return {
        "content": content,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }


def _parse_converse_response(response: dict[str, Any]) -> dict[str, Any]:
    """Extract content and tokens from a Converse API response."""
    content = ""
    try:
        msg_content = response.get("output", {}).get("message", {}).get("content", [])
        if msg_content and isinstance(msg_content, list):
            content = msg_content[0].get("text", "")
    except (KeyError, IndexError, TypeError):
        pass

    usage = response.get("usage", {})
    input_tokens = usage.get("inputTokens", 0)
    output_tokens = usage.get("outputTokens", 0)

    return {
        "content": content,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }


# ---------------------------------------------------------------------------
# Bedrock instrumentation
# ---------------------------------------------------------------------------

@register("bedrock")
class BedrockInstrumentation(BaseLLMInstrumentation):
    """AWS Bedrock Runtime instrumentation.

    Rather than using the base class's generic monkey-patching (which doesn't
    work well with boto3's dynamically generated clients), this implementation
    patches the botocore client methods directly for bedrock-runtime.
    """

    provider_name = "bedrock"

    def __init__(self) -> None:
        super().__init__()
        self._patched_clients: list[tuple[Any, str, Any]] = []

    # We override instrument/uninstrument entirely since Bedrock uses
    # a different patching strategy (botocore event system or direct client patching).
    # The base class _get_patch_targets / _extract_call_data are still implemented
    # for interface compliance.

    def _get_patch_targets(self) -> list[PatchTarget]:
        # Not used — we override instrument() directly
        return []

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return False

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return kwargs.get("modelId", "unknown")

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        # Not used directly — see _build_invoke_call_data / _build_converse_call_data
        return self._build_invoke_call_data(response, kwargs, latency_ms)

    def _build_invoke_call_data(
        self, body: dict[str, Any], kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        model_id = kwargs.get("modelId", "unknown")
        family = _detect_model_family(model_id)
        parsed = _parse_invoke_response(body, family)

        # Try to extract messages from request body
        messages: list[dict[str, Any]] = []
        system_prompt: str | None = None
        try:
            req_body = json.loads(kwargs.get("body", "{}")) if isinstance(kwargs.get("body"), (str, bytes)) else {}
            if family == "anthropic":
                system_prompt = req_body.get("system", None)
                for msg in req_body.get("messages", []):
                    messages.append({"role": msg.get("role", "user"), "content": str(msg.get("content", ""))})
            elif family == "titan":
                text = req_body.get("inputText", "")
                if text:
                    messages.append({"role": "user", "content": text})
            elif family == "llama":
                prompt = req_body.get("prompt", "")
                if prompt:
                    messages.append({"role": "user", "content": prompt})
        except Exception:
            pass

        return LlmCallData(
            provider="bedrock",
            model=model_id,
            messages=messages,
            system_prompt=system_prompt,
            completion=parsed["content"],
            tool_calls=None,
            finish_reason="stop",
            input_tokens=parsed["input_tokens"],
            output_tokens=parsed["output_tokens"],
            total_tokens=parsed["input_tokens"] + parsed["output_tokens"],
            cost_usd=0.0,
            latency_ms=latency_ms,
        )

    def _build_converse_call_data(
        self, response: dict[str, Any], kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        model_id = kwargs.get("modelId", "unknown")
        parsed = _parse_converse_response(response)

        messages: list[dict[str, Any]] = []
        system_prompt: str | None = None
        try:
            for msg in kwargs.get("messages", []):
                role = msg.get("role", "user")
                content_parts = msg.get("content", [])
                text = content_parts[0].get("text", "") if content_parts else ""
                messages.append({"role": role, "content": text})
            sys_parts = kwargs.get("system", [])
            if sys_parts:
                system_prompt = sys_parts[0].get("text", "") if isinstance(sys_parts, list) else str(sys_parts)
        except Exception:
            pass

        return LlmCallData(
            provider="bedrock",
            model=model_id,
            messages=messages,
            system_prompt=system_prompt,
            completion=parsed["content"],
            tool_calls=None,
            finish_reason=response.get("stopReason", "stop"),
            input_tokens=parsed["input_tokens"],
            output_tokens=parsed["output_tokens"],
            total_tokens=parsed["input_tokens"] + parsed["output_tokens"],
            cost_usd=0.0,
            latency_ms=latency_ms,
        )

    def instrument(self) -> None:
        """Patch bedrock-runtime client methods via botocore."""
        if self._instrumented:
            return

        try:
            import botocore.client
        except ImportError:
            logger.debug("AgentLens: botocore not installed, skipping bedrock")
            raise

        original_make_api_call = botocore.client.ClientCreator.create_client
        instrumentation = self

        # We'll patch ClientCreator.create_client to intercept bedrock-runtime clients
        original_init = botocore.client.BaseClient.__init__
        self._originals["botocore.client.BaseClient.__init__"] = (
            botocore.client.BaseClient, "__init__", original_init
        )

        def patched_init(client_self: Any, *args: Any, **kwargs: Any) -> None:
            original_init(client_self, *args, **kwargs)
            try:
                service_id = client_self._service_model.service_name
                if service_id == "bedrock-runtime":
                    instrumentation._patch_bedrock_client(client_self)
            except Exception:
                pass

        botocore.client.BaseClient.__init__ = patched_init  # type: ignore[method-assign]
        self._instrumented = True
        logger.debug("AgentLens: Bedrock integration instrumented")

    def _patch_bedrock_client(self, client: Any) -> None:
        """Patch invoke_model and converse methods on a bedrock-runtime client."""
        import io

        instrumentation = self

        # --- invoke_model ---
        if hasattr(client, "invoke_model"):
            original_invoke = client.invoke_model

            def patched_invoke_model(**kwargs: Any) -> Any:
                from agentlensai._sender import get_sender
                from agentlensai._state import get_state

                state = get_state()
                if state is None:
                    return original_invoke(**kwargs)

                start = time.perf_counter()
                response = original_invoke(**kwargs)

                try:
                    latency_ms = (time.perf_counter() - start) * 1000
                    # Read and re-wrap the body
                    body_bytes = response["body"].read()
                    response["body"] = io.BytesIO(body_bytes)
                    body = json.loads(body_bytes)
                    data = instrumentation._build_invoke_call_data(body, kwargs, latency_ms)
                    get_sender().send(state, data)
                except Exception:
                    logger.debug("AgentLens: failed to capture Bedrock invoke_model", exc_info=True)

                return response

            client.invoke_model = patched_invoke_model
            self._patched_clients.append((client, "invoke_model", original_invoke))

        # --- converse ---
        if hasattr(client, "converse"):
            original_converse = client.converse

            def patched_converse(**kwargs: Any) -> Any:
                from agentlensai._sender import get_sender
                from agentlensai._state import get_state

                state = get_state()
                if state is None:
                    return original_converse(**kwargs)

                start = time.perf_counter()
                response = original_converse(**kwargs)

                try:
                    latency_ms = (time.perf_counter() - start) * 1000
                    data = instrumentation._build_converse_call_data(response, kwargs, latency_ms)
                    get_sender().send(state, data)
                except Exception:
                    logger.debug("AgentLens: failed to capture Bedrock converse", exc_info=True)

                return response

            client.converse = patched_converse
            self._patched_clients.append((client, "converse", original_converse))

        # --- converse_stream ---
        if hasattr(client, "converse_stream"):
            original_converse_stream = client.converse_stream

            def patched_converse_stream(**kwargs: Any) -> Any:
                # Pass through streaming — same pattern as other providers
                return original_converse_stream(**kwargs)

            client.converse_stream = patched_converse_stream
            self._patched_clients.append((client, "converse_stream", original_converse_stream))

    def uninstrument(self) -> None:
        """Restore original methods."""
        if not self._instrumented:
            return

        # Restore BaseClient.__init__
        for key, (owner, attr_name, original) in self._originals.items():
            try:
                setattr(owner, attr_name, original)
            except Exception:
                logger.debug("AgentLens: failed to restore %s", key, exc_info=True)
        self._originals.clear()

        # Restore patched client methods
        for client, attr_name, original in self._patched_clients:
            try:
                setattr(client, attr_name, original)
            except Exception:
                pass
        self._patched_clients.clear()

        self._instrumented = False
        logger.debug("AgentLens: Bedrock integration uninstrumented")

from __future__ import annotations
"""Semantic Kernel integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.semantic_kernel import AgentLensSKHandler, init

    # Option 1: Add filter to kernel directly
    handler = AgentLensSKHandler()
    kernel.add_filter("function_invocation", handler.filter)

    # Option 2: Global init helper
    init(kernel)

CRITICAL: All methods are FAIL-SAFE — never break user code.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")


class AgentLensSKHandler(BaseFrameworkPlugin):
    """Semantic Kernel function/planner handler.

    Implements FunctionInvocationFilter interface for SK Python v1.0+.

    Enhanced in v0.8.0:
    - Function invocations → tool_call/tool_response/tool_error
      (function_name, plugin_name, parameters)
    - AI service calls → llm_call/llm_response (service_id)
    - agentId from kernel name or configured ID
    - Activatable via kernel.add_filter() or global init()
    """

    framework_name = "semantic_kernel"

    def __init__(self, kernel_name: str | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._kernel_name = kernel_name
        self._function_timers: dict[str, float] = {}
        self._llm_timers: dict[str, float] = {}

    def _resolve_agent_id(self) -> str:
        """Resolve agentId: explicit > kernel name > 'default'."""
        if self._agent_id:
            return self._agent_id
        if self._kernel_name:
            return self._kernel_name
        return "default"

    def _framework_metadata(
        self, component: str, extra: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Build standard framework metadata."""
        meta: dict[str, Any] = {
            "source": "semantic_kernel",
            "framework": "semantic_kernel",
            "framework_component": component,
        }
        if self._kernel_name:
            meta["kernel_name"] = self._kernel_name
        if extra:
            meta.update(extra)
        return meta

    # ─── FunctionInvocationFilter ──────────────────────

    async def filter(self, context: Any, next_fn: Any) -> None:
        """SK FunctionInvocationFilter — wraps function invocations.

        Usage: kernel.add_filter("function_invocation", handler.filter)

        Emits tool_call before execution and tool_response/tool_error after.
        """
        call_id = str(uuid.uuid4())
        try:
            self._on_function_invoking(context, call_id)
        except Exception:
            logger.debug("AgentLens SK: pre-invoke error", exc_info=True)

        try:
            await next_fn(context)
        finally:
            try:
                self._on_function_invoked(context, call_id)
            except Exception:
                logger.debug("AgentLens SK: post-invoke error", exc_info=True)

    def _on_function_invoking(self, context: Any, call_id: str) -> None:
        """Called before a SK function executes.

        Emits a ``tool_call`` event with function_name, plugin_name, parameters.
        """
        try:
            self._function_timers[call_id] = time.perf_counter()

            function = getattr(context, "function", None)
            func_name = "unknown"
            plugin_name = "unknown"
            if function:
                func_name = str(getattr(function, "name", "unknown"))
                plugin_name = str(getattr(function, "plugin_name", "unknown"))

            # Extract arguments
            arguments: dict[str, str] = {}
            if hasattr(context, "arguments"):
                try:
                    args = context.arguments
                    if hasattr(args, "items"):
                        arguments = {str(k): str(v)[:200] for k, v in args.items()}
                except Exception:
                    pass

            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            agent_id = self._resolve_agent_id()

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_call",
                "severity": "info",
                "payload": {
                    "toolName": f"{plugin_name}.{func_name}",
                    "callId": call_id,
                    "arguments": arguments,
                    "function_name": func_name,
                    "plugin_name": plugin_name,
                },
                "metadata": self._framework_metadata("function"),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens SK: _on_function_invoking error", exc_info=True)

    def _on_function_invoked(self, context: Any, call_id: str) -> None:
        """Called after a SK function executes.

        Emits ``tool_response`` or ``tool_error`` depending on outcome.
        """
        try:
            start = self._function_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            function = getattr(context, "function", None)
            func_name = "unknown"
            plugin_name = "unknown"
            if function:
                func_name = str(getattr(function, "name", "unknown"))
                plugin_name = str(getattr(function, "plugin_name", "unknown"))

            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            agent_id = self._resolve_agent_id()
            tool_name = f"{plugin_name}.{func_name}"

            # Check for errors
            exception = getattr(context, "exception", None)
            if exception:
                event = {
                    "sessionId": session_id,
                    "agentId": agent_id,
                    "eventType": "tool_error",
                    "severity": "error",
                    "payload": {
                        "callId": call_id,
                        "toolName": tool_name,
                        "error": str(exception)[:500],
                        "durationMs": round(duration_ms, 2),
                        "function_name": func_name,
                        "plugin_name": plugin_name,
                    },
                    "metadata": self._framework_metadata("function"),
                    "timestamp": self._now(),
                }
                self._send_event(client, event)
                return

            # Get result
            result = ""
            if hasattr(context, "result"):
                result = str(context.result)[:500]

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "toolName": tool_name,
                    "result": result,
                    "durationMs": round(duration_ms, 2),
                    "function_name": func_name,
                    "plugin_name": plugin_name,
                },
                "metadata": self._framework_metadata("function"),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens SK: _on_function_invoked error", exc_info=True)

    # ─── AI Service Calls ──────────────────────────────

    def on_ai_call(
        self,
        service_id: str = "default",
        model: str = "unknown",
        messages: list[dict[str, Any]] | None = None,
    ) -> str:
        """Called when Semantic Kernel makes an AI service call.

        Returns a call_id for pairing with on_ai_response.
        Emits an ``llm_call`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return ""

            client, _agent_id, session_id, _redact = config
            agent_id = self._resolve_agent_id()
            call_id = str(uuid.uuid4())
            self._llm_timers[call_id] = time.perf_counter()

            # Truncate messages
            truncated_msgs = []
            for msg in messages or []:
                truncated_msgs.append(
                    {
                        "role": msg.get("role", "unknown"),
                        "content": str(msg.get("content", ""))[:300],
                    }
                )

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "llm_call",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "model": model,
                    "service_id": service_id,
                    "messages": truncated_msgs[:20],
                },
                "metadata": self._framework_metadata("ai_service", {"service_id": service_id}),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
            return call_id
        except Exception:
            logger.debug("AgentLens SK: on_ai_call error", exc_info=True)
            return ""

    def on_ai_response(
        self,
        call_id: str = "",
        response: str | None = None,
        service_id: str = "default",
        model: str = "unknown",
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Called when an AI service returns a response.

        Emits an ``llm_response`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            agent_id = self._resolve_agent_id()
            start = self._llm_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "llm_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "model": model,
                    "service_id": service_id,
                    "completion": (response or "")[:1000],
                    "durationMs": round(duration_ms, 2),
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                },
                "metadata": self._framework_metadata("ai_service", {"service_id": service_id}),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens SK: on_ai_response error", exc_info=True)

    # ─── Planner ───────────────────────────────────────

    def on_planner_step(self, step: Any) -> None:
        """Called for each planner step (manual integration)."""
        try:
            data = {
                "step_type": type(step).__name__,
                "step_info": str(step)[:500],
            }
            self._send_custom_event("planner_step", data)
        except Exception:
            logger.debug("AgentLens SK: on_planner_step error", exc_info=True)


def init(
    kernel: Any, handler: AgentLensSKHandler | None = None, **kwargs: Any
) -> AgentLensSKHandler:
    """Convenience function to add AgentLens filter to a Semantic Kernel kernel.

    Args:
        kernel: A Semantic Kernel ``Kernel`` instance.
        handler: Existing handler to use (creates new one if None).
        **kwargs: Passed to AgentLensSKHandler constructor.

    Returns:
        The handler instance (for further configuration).
    """
    if handler is None:
        # Try to extract kernel name
        kernel_name = getattr(kernel, "name", None) or kwargs.pop("kernel_name", None)
        handler = AgentLensSKHandler(kernel_name=kernel_name, **kwargs)

    try:
        kernel.add_filter("function_invocation", handler.filter)
    except Exception:
        logger.debug("AgentLens SK: failed to add filter to kernel", exc_info=True)

    return handler


def instrument_semantic_kernel() -> None:
    """Auto-instrument Semantic Kernel (placeholder — requires kernel instance)."""
    logger.info("AgentLens: Semantic Kernel handler available (add filter to kernel)")


def uninstrument_semantic_kernel() -> None:
    """Remove Semantic Kernel instrumentation."""
    pass

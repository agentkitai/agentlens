"""Semantic Kernel integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

    handler = AgentLensSKHandler()

    # Use as a function invocation filter:
    kernel.add_filter("function_invocation", handler.filter)

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
    """Semantic Kernel function/planner handler."""

    framework_name = "semantic_kernel"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._function_timers: dict[str, float] = {}

    async def filter(self, context: Any, next_fn: Any) -> None:
        """SK FunctionInvocationFilter — wraps function invocations.

        Usage: kernel.add_filter("function_invocation", handler.filter)
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
        """Called before a SK function executes."""
        try:
            self._function_timers[call_id] = time.perf_counter()

            function = getattr(context, "function", None)
            func_name = "unknown"
            plugin_name = "unknown"
            if function:
                func_name = str(getattr(function, "name", "unknown"))
                plugin_name = str(getattr(function, "plugin_name", "unknown"))

            # Extract arguments
            arguments = {}
            if hasattr(context, "arguments"):
                try:
                    args = context.arguments
                    if hasattr(args, "items"):
                        arguments = {str(k): str(v)[:200] for k, v in args.items()}
                except Exception:
                    pass

            self._send_tool_call(
                tool_name=f"{plugin_name}.{func_name}",
                call_id=call_id,
                arguments=arguments,
            )
        except Exception:
            logger.debug("AgentLens SK: _on_function_invoking error", exc_info=True)

    def _on_function_invoked(self, context: Any, call_id: str) -> None:
        """Called after a SK function executes."""
        try:
            start = self._function_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            function = getattr(context, "function", None)
            func_name = "unknown"
            plugin_name = "unknown"
            if function:
                func_name = str(getattr(function, "name", "unknown"))
                plugin_name = str(getattr(function, "plugin_name", "unknown"))

            # Check for errors
            exception = getattr(context, "exception", None)
            if exception:
                self._send_tool_error(
                    tool_name=f"{plugin_name}.{func_name}",
                    call_id=call_id,
                    error=str(exception),
                    duration_ms=duration_ms,
                )
                return

            # Get result
            result = ""
            if hasattr(context, "result"):
                result = str(context.result)[:500]

            self._send_tool_response(
                tool_name=f"{plugin_name}.{func_name}",
                call_id=call_id,
                result=result,
                duration_ms=duration_ms,
            )
        except Exception:
            logger.debug("AgentLens SK: _on_function_invoked error", exc_info=True)

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


def instrument_semantic_kernel() -> None:
    """Auto-instrument Semantic Kernel (placeholder — requires kernel instance)."""
    logger.info("AgentLens: Semantic Kernel handler available (add filter to kernel)")


def uninstrument_semantic_kernel() -> None:
    """Remove Semantic Kernel instrumentation."""
    pass

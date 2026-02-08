"""CrewAI integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.crewai import AgentLensCrewAIHandler

    handler = AgentLensCrewAIHandler()

    # Use with CrewAI step callback:
    crew = Crew(
        agents=[...],
        tasks=[...],
        step_callback=handler.step_callback,
    )

CRITICAL: All methods are FAIL-SAFE — never break user code.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")


class AgentLensCrewAIHandler(BaseFrameworkPlugin):
    """CrewAI step callback handler that sends events to AgentLens."""

    framework_name = "crewai"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._task_timers: dict[str, float] = {}

    def step_callback(self, step_output: Any) -> None:
        """CrewAI step_callback — called after each agent step.

        This is the main integration point. CrewAI calls this
        after each step with the step output.
        """
        try:
            step_type = type(step_output).__name__
            data: dict[str, Any] = {"step_type": step_type}

            # Extract useful info from step output
            if hasattr(step_output, "text"):
                data["text"] = str(step_output.text)[:500]
            if hasattr(step_output, "tool"):
                data["tool"] = str(step_output.tool)
            if hasattr(step_output, "tool_input"):
                data["tool_input"] = str(step_output.tool_input)[:200]
            if hasattr(step_output, "result"):
                data["result"] = str(step_output.result)[:500]

            self._send_custom_event("crew_step", data)
        except Exception:
            logger.debug("AgentLens CrewAI: step_callback error", exc_info=True)

    def on_task_start(self, task: Any, agent: Any) -> None:
        """Called when a CrewAI task starts."""
        try:
            task_id = str(getattr(task, "id", str(uuid.uuid4())))
            self._task_timers[task_id] = time.perf_counter()

            data = {
                "task_id": task_id,
                "task_description": str(getattr(task, "description", ""))[:200],
                "agent_role": str(getattr(agent, "role", "unknown")),
                "agent_goal": str(getattr(agent, "goal", ""))[:200],
            }
            self._send_custom_event("task_start", data)
        except Exception:
            logger.debug("AgentLens CrewAI: on_task_start error", exc_info=True)

    def on_task_end(self, task: Any, agent: Any, output: Any) -> None:
        """Called when a CrewAI task completes."""
        try:
            task_id = str(getattr(task, "id", ""))
            start = self._task_timers.pop(task_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            data = {
                "task_id": task_id,
                "agent_role": str(getattr(agent, "role", "unknown")),
                "output": str(output)[:500],
                "duration_ms": round(duration_ms, 2),
            }
            self._send_custom_event("task_end", data)
        except Exception:
            logger.debug("AgentLens CrewAI: on_task_end error", exc_info=True)

    def on_crew_start(self, crew: Any) -> None:
        """Called when a CrewAI crew starts execution."""
        try:
            data = {
                "crew_id": str(getattr(crew, "id", str(uuid.uuid4()))),
                "agent_count": len(getattr(crew, "agents", [])),
                "task_count": len(getattr(crew, "tasks", [])),
            }
            self._send_custom_event("crew_start", data)
        except Exception:
            logger.debug("AgentLens CrewAI: on_crew_start error", exc_info=True)

    def on_crew_end(self, crew: Any, result: Any) -> None:
        """Called when a CrewAI crew finishes execution."""
        try:
            data = {
                "crew_id": str(getattr(crew, "id", "")),
                "result": str(result)[:500],
            }
            self._send_custom_event("crew_end", data)
        except Exception:
            logger.debug("AgentLens CrewAI: on_crew_end error", exc_info=True)


def instrument_crewai() -> None:
    """Auto-instrument CrewAI (placeholder — CrewAI doesn't have global hooks)."""
    logger.info("AgentLens: CrewAI handler available (use step_callback=handler.step_callback)")


def uninstrument_crewai() -> None:
    """Remove CrewAI instrumentation."""
    pass

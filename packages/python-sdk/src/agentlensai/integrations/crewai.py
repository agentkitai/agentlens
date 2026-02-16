from __future__ import annotations
"""CrewAI integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.crewai import AgentLensCrewAIHandler

    handler = AgentLensCrewAIHandler(crew_name="my-crew")

    # Use with CrewAI step callback:
    crew = Crew(
        agents=[...],
        tasks=[...],
        step_callback=handler.step_callback,
    )

    # Lifecycle hooks (call manually or wire into your orchestration):
    handler.on_crew_start(crew)
    result = crew.kickoff()
    handler.on_crew_end(crew, result)

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
    """CrewAI handler that sends events to AgentLens.

    Enhanced in v0.8.0:
    - Crew kickoff → session_started with crew name in tags
    - Crew completion → session_ended with summary
    - Agent start/end → custom events with role, goal, backstory
    - Task start/end → custom events with description, expected_output, assigned_agent, output
    - Task delegation → custom event with delegator, delegatee, reason
    - Tool usage → tool_call/tool_response with calling agent metadata
    - agentId set to {crew_name}/{agent_role}
    """

    framework_name = "crewai"

    def __init__(self, crew_name: str = "default-crew", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._crew_name = crew_name
        self._task_timers: dict[str, float] = {}
        self._agent_timers: dict[str, float] = {}
        self._tool_timers: dict[str, float] = {}
        self._crew_start_time: float | None = None

    def _agent_id_for(self, agent_role: str | None = None) -> str:
        """Build agentId as {crew_name}/{agent_role}."""
        if agent_role:
            return f"{self._crew_name}/{agent_role}"
        return self._crew_name

    def _send_custom_event_with_agent(
        self,
        event_type: str,
        data: dict[str, Any],
        agent_role: str | None = None,
        severity: str = "info",
    ) -> None:
        """Send a custom event, overriding agentId to include crew/agent path."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            resolved_agent_id = self._agent_id_for(agent_role)

            from datetime import datetime, timezone

            event = {
                "sessionId": session_id,
                "agentId": resolved_agent_id,
                "eventType": "custom",
                "severity": severity,
                "payload": {"type": event_type, "data": data},
                "metadata": {
                    "source": "crewai",
                    "framework": "crewai",
                    "crew_name": self._crew_name,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens CrewAI: _send_custom_event_with_agent error", exc_info=True)

    # ─── Crew Lifecycle ────────────────────────────────

    def on_crew_start(self, crew: Any) -> None:
        """Called when a CrewAI crew starts execution.

        Emits a ``session_started`` event with crew name in tags.
        """
        try:
            self._crew_start_time = time.perf_counter()
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config

            # Try to extract crew name from the crew object
            crew_name = str(getattr(crew, "name", None) or getattr(crew, "id", self._crew_name))
            if crew_name and crew_name != self._crew_name:
                self._crew_name = crew_name

            agent_roles = []
            try:
                for a in getattr(crew, "agents", []):
                    agent_roles.append(str(getattr(a, "role", "unknown")))
            except Exception:
                pass

            from datetime import datetime, timezone

            event = {
                "sessionId": session_id,
                "agentId": self._crew_name,
                "eventType": "session_started",
                "severity": "info",
                "payload": {
                    "crew_name": self._crew_name,
                    "agent_count": len(getattr(crew, "agents", [])),
                    "task_count": len(getattr(crew, "tasks", [])),
                    "agent_roles": agent_roles[:20],
                },
                "metadata": {
                    "source": "crewai",
                    "framework": "crewai",
                    "crew_name": self._crew_name,
                },
                "tags": [f"crew:{self._crew_name}"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens CrewAI: on_crew_start error", exc_info=True)

    def on_crew_end(self, crew: Any, result: Any) -> None:
        """Called when a CrewAI crew finishes execution.

        Emits a ``session_ended`` event with summary.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config

            duration_ms = 0.0
            if self._crew_start_time is not None:
                duration_ms = (time.perf_counter() - self._crew_start_time) * 1000
                self._crew_start_time = None

            from datetime import datetime, timezone

            event = {
                "sessionId": session_id,
                "agentId": self._crew_name,
                "eventType": "session_ended",
                "severity": "info",
                "payload": {
                    "crew_name": self._crew_name,
                    "result_summary": str(result)[:500],
                    "duration_ms": round(duration_ms, 2),
                },
                "metadata": {
                    "source": "crewai",
                    "framework": "crewai",
                    "crew_name": self._crew_name,
                },
                "tags": [f"crew:{self._crew_name}"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens CrewAI: on_crew_end error", exc_info=True)

    # ─── Agent Lifecycle ───────────────────────────────

    def on_agent_start(self, agent: Any) -> None:
        """Called when a CrewAI agent starts working.

        Emits a custom event with role, goal, backstory.
        """
        try:
            role = str(getattr(agent, "role", "unknown"))
            agent_id_str = str(getattr(agent, "id", role))
            self._agent_timers[agent_id_str] = time.perf_counter()

            data = {
                "role": role,
                "goal": str(getattr(agent, "goal", ""))[:300],
                "backstory": str(getattr(agent, "backstory", ""))[:300],
            }
            self._send_custom_event_with_agent("agent_start", data, agent_role=role)
        except Exception:
            logger.debug("AgentLens CrewAI: on_agent_start error", exc_info=True)

    def on_agent_end(self, agent: Any, output: Any = None) -> None:
        """Called when a CrewAI agent finishes working.

        Emits a custom event with role and output.
        """
        try:
            role = str(getattr(agent, "role", "unknown"))
            agent_id_str = str(getattr(agent, "id", role))
            start = self._agent_timers.pop(agent_id_str, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            data = {
                "role": role,
                "output": str(output)[:500] if output else "",
                "duration_ms": round(duration_ms, 2),
            }
            self._send_custom_event_with_agent("agent_end", data, agent_role=role)
        except Exception:
            logger.debug("AgentLens CrewAI: on_agent_end error", exc_info=True)

    # ─── Task Lifecycle ────────────────────────────────

    def on_task_start(self, task: Any, agent: Any) -> None:
        """Called when a CrewAI task starts.

        Emits a custom event with description, expected_output, assigned_agent.
        """
        try:
            task_id = str(getattr(task, "id", str(uuid.uuid4())))
            self._task_timers[task_id] = time.perf_counter()

            role = str(getattr(agent, "role", "unknown"))
            data = {
                "task_id": task_id,
                "description": str(getattr(task, "description", ""))[:200],
                "expected_output": str(getattr(task, "expected_output", ""))[:200],
                "assigned_agent": role,
            }
            self._send_custom_event_with_agent("task_start", data, agent_role=role)
        except Exception:
            logger.debug("AgentLens CrewAI: on_task_start error", exc_info=True)

    def on_task_end(self, task: Any, agent: Any, output: Any) -> None:
        """Called when a CrewAI task completes.

        Emits a custom event with actual output, assigned_agent, duration_ms.
        """
        try:
            task_id = str(getattr(task, "id", ""))
            start = self._task_timers.pop(task_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            role = str(getattr(agent, "role", "unknown"))
            data = {
                "task_id": task_id,
                "assigned_agent": role,
                "output": str(output)[:500],
                "duration_ms": round(duration_ms, 2),
            }
            self._send_custom_event_with_agent("task_end", data, agent_role=role)
        except Exception:
            logger.debug("AgentLens CrewAI: on_task_end error", exc_info=True)

    def on_task_delegation(
        self,
        delegator: Any,
        delegatee: Any,
        task: Any,
        reason: str = "",
    ) -> None:
        """Called when a task is delegated from one agent to another.

        Emits a custom ``task_delegation`` event.
        """
        try:
            delegator_role = str(getattr(delegator, "role", "unknown"))
            delegatee_role = str(getattr(delegatee, "role", "unknown"))
            task_desc = str(getattr(task, "description", ""))[:200]

            data = {
                "delegator": delegator_role,
                "delegatee": delegatee_role,
                "task_description": task_desc,
                "reason": str(reason)[:300],
            }
            self._send_custom_event_with_agent("task_delegation", data, agent_role=delegator_role)
        except Exception:
            logger.debug("AgentLens CrewAI: on_task_delegation error", exc_info=True)

    # ─── Tool Usage ────────────────────────────────────

    def on_tool_use(
        self,
        agent: Any,
        tool_name: str,
        tool_input: Any,
    ) -> str:
        """Called when a CrewAI agent uses a tool.

        Returns a call_id to be passed to on_tool_result.
        Emits a ``tool_call`` event with calling agent in metadata.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return ""

            client, _agent_id, session_id, _redact = config
            role = str(getattr(agent, "role", "unknown"))
            call_id = str(uuid.uuid4())
            self._tool_timers[call_id] = time.perf_counter()

            from datetime import datetime, timezone

            event = {
                "sessionId": session_id,
                "agentId": self._agent_id_for(role),
                "eventType": "tool_call",
                "severity": "info",
                "payload": {
                    "toolName": str(tool_name),
                    "callId": call_id,
                    "arguments": {"input": str(tool_input)[:500]} if tool_input else {},
                },
                "metadata": {
                    "source": "crewai",
                    "framework": "crewai",
                    "crew_name": self._crew_name,
                    "calling_agent": role,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._send_event(client, event)
            return call_id
        except Exception:
            logger.debug("AgentLens CrewAI: on_tool_use error", exc_info=True)
            return ""

    def on_tool_result(
        self,
        agent: Any,
        tool_name: str,
        result: Any,
        call_id: str = "",
    ) -> None:
        """Called when a tool returns a result.

        Emits a ``tool_response`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            role = str(getattr(agent, "role", "unknown"))
            start = self._tool_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            from datetime import datetime, timezone

            event = {
                "sessionId": session_id,
                "agentId": self._agent_id_for(role),
                "eventType": "tool_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "toolName": str(tool_name),
                    "result": str(result)[:1000],
                    "durationMs": round(duration_ms, 2),
                },
                "metadata": {
                    "source": "crewai",
                    "framework": "crewai",
                    "crew_name": self._crew_name,
                    "calling_agent": role,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens CrewAI: on_tool_result error", exc_info=True)

    # ─── Step Callback (legacy compat) ─────────────────

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


def instrument_crewai() -> None:
    """Auto-instrument CrewAI (placeholder — CrewAI doesn't have global hooks)."""
    logger.info("AgentLens: CrewAI handler available (use step_callback=handler.step_callback)")


def uninstrument_crewai() -> None:
    """Remove CrewAI instrumentation."""
    pass

from __future__ import annotations
"""Base class for all framework plugins.

All framework plugins (LangChain, CrewAI, AutoGen, Semantic Kernel)
inherit from this class. Provides shared logic for client resolution,
event sending, and fail-safe guarantees.

CRITICAL: All methods are wrapped in try/except — NEVER raise to user code.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("agentlensai")


class BaseFrameworkPlugin:
    """Base class for all AgentLens framework plugins.

    Works in two modes:
    1. With agentlensai.init() — uses global state automatically
    2. Standalone — pass client, agent_id, session_id to constructor
    """

    # Framework name for metadata tagging (override in subclasses)
    framework_name: str = "unknown"

    def __init__(
        self,
        client: Any | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        redact: bool = False,
    ) -> None:
        self._client = client
        self._agent_id = agent_id
        self._session_id = session_id or str(uuid.uuid4())
        self._redact = redact

    def _get_client_and_config(self) -> tuple[Any, str, str, bool] | None:
        """Get client, agent_id, session_id, redact — from constructor or global state.

        Returns None if no client is available (instrumentation not initialized).
        """
        if self._client is not None:
            return (self._client, self._agent_id or "default", self._session_id, self._redact)

        try:
            from agentlensai._state import get_state

            state = get_state()
            if state is None:
                return None
            return (state.client, state.agent_id, state.session_id, state.redact or self._redact)
        except Exception:
            return None

    def _send_event(self, client: Any, event: dict[str, Any]) -> None:
        """Send a single event to the server. NEVER raises."""
        try:
            client._request("POST", "/api/events", json={"events": [event]})
        except Exception:
            logger.debug("AgentLens %s: failed to send event", self.framework_name, exc_info=True)

    def _send_custom_event(
        self,
        event_type: str,
        data: dict[str, Any],
        severity: str = "info",
        extra_metadata: dict[str, Any] | None = None,
    ) -> None:
        """Send a custom event with framework metadata. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            metadata = {"source": self.framework_name}
            if extra_metadata:
                metadata.update(extra_metadata)

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": severity,
                "payload": {"type": event_type, "data": data},
                "metadata": metadata,
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug(
                "AgentLens %s: failed to send custom event", self.framework_name, exc_info=True
            )

    def _send_tool_call(
        self,
        tool_name: str,
        call_id: str,
        arguments: dict[str, Any],
    ) -> None:
        """Send a tool_call event. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_call",
                "severity": "info",
                "payload": {
                    "toolName": tool_name,
                    "callId": call_id,
                    "arguments": arguments,
                },
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug(
                "AgentLens %s: failed to send tool_call", self.framework_name, exc_info=True
            )

    def _send_tool_response(
        self,
        tool_name: str,
        call_id: str,
        result: Any,
        duration_ms: float,
    ) -> None:
        """Send a tool_response event. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            result_str = str(result)[:1000]  # Truncate long outputs
            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "toolName": tool_name,
                    "result": result_str,
                    "durationMs": round(duration_ms, 2),
                },
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug(
                "AgentLens %s: failed to send tool_response", self.framework_name, exc_info=True
            )

    def _send_tool_error(
        self,
        tool_name: str,
        call_id: str,
        error: str,
        duration_ms: float,
    ) -> None:
        """Send a tool_error event. NEVER raises."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_error",
                "severity": "error",
                "payload": {
                    "callId": call_id,
                    "toolName": tool_name,
                    "error": str(error)[:500],
                    "durationMs": round(duration_ms, 2),
                },
                "metadata": {"source": self.framework_name},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug(
                "AgentLens %s: failed to send tool_error", self.framework_name, exc_info=True
            )

    @staticmethod
    def _now() -> str:
        """Return current UTC timestamp in ISO 8601 format."""
        return datetime.now(timezone.utc).isoformat()

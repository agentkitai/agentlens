"""AutoGen integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.autogen import AgentLensAutoGenHandler

    handler = AgentLensAutoGenHandler()

    # Register with AutoGen agents:
    agent.register_hook("process_message_before_send", handler.on_message_sent)

CRITICAL: All methods are FAIL-SAFE — never break user code.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from agentlensai.integrations.base import BaseFrameworkPlugin

logger = logging.getLogger("agentlensai")


class AgentLensAutoGenHandler(BaseFrameworkPlugin):
    """AutoGen conversation/agent handler that sends events to AgentLens."""

    framework_name = "autogen"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._tool_timers: dict[str, float] = {}

    def on_message_sent(
        self,
        sender: Any,
        receiver: Any,
        message: Any,
    ) -> Any:
        """Called when an agent sends a message.

        Can be used as a hook for process_message_before_send.
        Returns the message unchanged (transparent proxy).
        """
        try:
            sender_name = str(getattr(sender, "name", "unknown"))
            receiver_name = str(getattr(receiver, "name", "unknown"))

            content = ""
            if isinstance(message, str):
                content = message[:500]
            elif isinstance(message, dict):
                content = str(message.get("content", ""))[:500]

            data = {
                "sender": sender_name,
                "receiver": receiver_name,
                "content_preview": content,
                "message_type": type(message).__name__,
            }
            self._send_custom_event("agent_message", data)
        except Exception:
            logger.debug("AgentLens AutoGen: on_message_sent error", exc_info=True)

        return message  # Always return message unchanged

    def on_message_received(
        self,
        sender: Any,
        receiver: Any,
        message: Any,
    ) -> None:
        """Called when an agent receives a message."""
        try:
            sender_name = str(getattr(sender, "name", "unknown"))
            receiver_name = str(getattr(receiver, "name", "unknown"))

            content = ""
            if isinstance(message, str):
                content = message[:500]
            elif isinstance(message, dict):
                content = str(message.get("content", ""))[:500]

            data = {
                "sender": sender_name,
                "receiver": receiver_name,
                "content_preview": content,
            }
            self._send_custom_event("message_received", data)
        except Exception:
            logger.debug("AgentLens AutoGen: on_message_received error", exc_info=True)

    def on_tool_call(
        self,
        agent: Any,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
    ) -> None:
        """Called when an AutoGen agent calls a tool."""
        try:
            call_id = str(uuid.uuid4())
            self._tool_timers[call_id] = time.perf_counter()
            agent_name = str(getattr(agent, "name", "unknown"))

            self._send_tool_call(
                tool_name=tool_name,
                call_id=call_id,
                arguments={"agent": agent_name, **(arguments or {})},
            )
        except Exception:
            logger.debug("AgentLens AutoGen: on_tool_call error", exc_info=True)

    def on_tool_result(
        self,
        agent: Any,
        tool_name: str,
        result: Any,
        call_id: str | None = None,
    ) -> None:
        """Called when a tool returns a result."""
        try:
            cid = call_id or ""
            start = self._tool_timers.pop(cid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            self._send_tool_response(
                tool_name=tool_name,
                call_id=cid,
                result=result,
                duration_ms=duration_ms,
            )
        except Exception:
            logger.debug("AgentLens AutoGen: on_tool_result error", exc_info=True)

    def on_conversation_start(self, initiator: Any, participants: list[Any] | None = None) -> None:
        """Called when a multi-agent conversation starts."""
        try:
            data = {
                "initiator": str(getattr(initiator, "name", "unknown")),
                "participant_count": len(participants) if participants else 0,
                "participants": [str(getattr(p, "name", "unknown")) for p in (participants or [])][:10],
            }
            self._send_custom_event("conversation_start", data)
        except Exception:
            logger.debug("AgentLens AutoGen: on_conversation_start error", exc_info=True)

    def on_conversation_end(self, summary: str | None = None) -> None:
        """Called when a multi-agent conversation ends."""
        try:
            data = {"summary": (summary or "")[:500]}
            self._send_custom_event("conversation_end", data)
        except Exception:
            logger.debug("AgentLens AutoGen: on_conversation_end error", exc_info=True)


def instrument_autogen() -> None:
    """Auto-instrument AutoGen (placeholder — requires per-agent registration)."""
    logger.info("AgentLens: AutoGen handler available (register hooks per agent)")


def uninstrument_autogen() -> None:
    """Remove AutoGen instrumentation."""
    pass

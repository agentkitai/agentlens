"""AutoGen integration plugin for AgentLens.

Usage:
    from agentlensai.integrations.autogen import AgentLensAutoGenHandler

    handler = AgentLensAutoGenHandler()

    # Register with AutoGen v0.2 agents:
    agent.register_hook("process_message_before_send", handler.on_message_sent)

    # Or use lifecycle hooks manually:
    handler.on_conversation_start(initiator, [agent1, agent2])
    initiator.initiate_chat(receiver, message="Hello")
    handler.on_conversation_end("Summary")

Supports both AutoGen v0.2 (pyautogen) and v0.4+ (autogen-agentchat).

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
    """AutoGen conversation/agent handler that sends events to AgentLens.

    Enhanced in v0.8.0:
    - initiate_chat → session_started
    - Agent message exchanges → custom events (sender, receiver, content_preview, message_type)
    - LLM calls → llm_call/llm_response with calling agent metadata
    - Code execution → custom events (code content, result, exit_code)
    - Function/tool calls → tool_call/tool_response
    - agentId from AutoGen agent names
    - Support both AutoGen v0.2 (pyautogen) and v0.4+ (autogen-agentchat)
    """

    framework_name = "autogen"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._tool_timers: dict[str, float] = {}
        self._llm_timers: dict[str, float] = {}

    def _agent_name(self, agent: Any) -> str:
        """Extract agent name, supporting both v0.2 and v0.4+ API."""
        try:
            return str(getattr(agent, "name", None) or getattr(agent, "_name", "unknown"))
        except Exception:
            return "unknown"

    def _resolve_agent_id(self, agent: Any) -> str:
        """Resolve agentId from AutoGen agent name, or fall back to configured."""
        name = self._agent_name(agent)
        if name and name != "unknown":
            return name
        return self._agent_id or "default"

    def _framework_metadata(
        self, component: str, extra: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Build standard framework metadata."""
        meta: dict[str, Any] = {
            "source": "autogen",
            "framework": "autogen",
            "framework_component": component,
        }
        if extra:
            meta.update(extra)
        return meta

    # ─── Conversation Lifecycle ────────────────────────

    def on_conversation_start(self, initiator: Any, participants: list[Any] | None = None) -> None:
        """Called when a multi-agent conversation starts (initiate_chat).

        Emits a ``session_started`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            initiator_name = self._agent_name(initiator)

            participant_names = [self._agent_name(p) for p in (participants or [])]

            event = {
                "sessionId": session_id,
                "agentId": initiator_name,
                "eventType": "session_started",
                "severity": "info",
                "payload": {
                    "initiator": initiator_name,
                    "participant_count": len(participants) if participants else 0,
                    "participants": participant_names[:10],
                },
                "metadata": self._framework_metadata("conversation"),
                "tags": ["autogen:conversation"],
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens AutoGen: on_conversation_start error", exc_info=True)

    def on_conversation_end(self, summary: str | None = None) -> None:
        """Called when a multi-agent conversation ends.

        Emits a ``session_ended`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "session_ended",
                "severity": "info",
                "payload": {"summary": (summary or "")[:500]},
                "metadata": self._framework_metadata("conversation"),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens AutoGen: on_conversation_end error", exc_info=True)

    # ─── Message Exchange ──────────────────────────────

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
            sender_name = self._agent_name(sender)
            receiver_name = self._agent_name(receiver)

            content = ""
            msg_type = type(message).__name__
            if isinstance(message, str):
                content = message[:500]
            elif isinstance(message, dict):
                content = str(message.get("content", ""))[:500]
                # AutoGen v0.2 uses dict messages with role/content
                msg_type = message.get("role", msg_type)

            config = self._get_client_and_config()
            if config is not None:
                client, _agent_id, session_id, _redact = config
                event = {
                    "sessionId": session_id,
                    "agentId": sender_name,
                    "eventType": "custom",
                    "severity": "info",
                    "payload": {
                        "type": "agent_message",
                        "data": {
                            "sender": sender_name,
                            "receiver": receiver_name,
                            "content_preview": content,
                            "message_type": msg_type,
                        },
                    },
                    "metadata": self._framework_metadata("message"),
                    "timestamp": self._now(),
                }
                self._send_event(client, event)
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
            sender_name = self._agent_name(sender)
            receiver_name = self._agent_name(receiver)

            content = ""
            if isinstance(message, str):
                content = message[:500]
            elif isinstance(message, dict):
                content = str(message.get("content", ""))[:500]

            self._send_custom_event(
                "message_received",
                {
                    "sender": sender_name,
                    "receiver": receiver_name,
                    "content_preview": content,
                },
            )
        except Exception:
            logger.debug("AgentLens AutoGen: on_message_received error", exc_info=True)

    # ─── LLM Calls ─────────────────────────────────────

    def on_llm_call(
        self,
        agent: Any,
        messages: list[dict[str, Any]] | None = None,
        model: str = "unknown",
    ) -> str:
        """Called when an AutoGen agent makes an LLM call.

        Returns a call_id for pairing with on_llm_response.
        Emits an ``llm_call`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return ""

            client, _agent_id, session_id, _redact = config
            agent_name = self._agent_name(agent)
            call_id = str(uuid.uuid4())
            self._llm_timers[call_id] = time.perf_counter()

            # Truncate messages for storage
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
                "agentId": agent_name,
                "eventType": "llm_call",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "model": model,
                    "messages": truncated_msgs[:20],
                },
                "metadata": self._framework_metadata("llm", {"calling_agent": agent_name}),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
            return call_id
        except Exception:
            logger.debug("AgentLens AutoGen: on_llm_call error", exc_info=True)
            return ""

    def on_llm_response(
        self,
        agent: Any,
        response: str | None = None,
        call_id: str = "",
        model: str = "unknown",
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Called when an LLM returns a response.

        Emits an ``llm_response`` event.
        """
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, _agent_id, session_id, _redact = config
            agent_name = self._agent_name(agent)
            start = self._llm_timers.pop(call_id, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_name,
                "eventType": "llm_response",
                "severity": "info",
                "payload": {
                    "callId": call_id,
                    "model": model,
                    "completion": (response or "")[:1000],
                    "durationMs": round(duration_ms, 2),
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                },
                "metadata": self._framework_metadata("llm", {"calling_agent": agent_name}),
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens AutoGen: on_llm_response error", exc_info=True)

    # ─── Code Execution ────────────────────────────────

    def on_code_execution(
        self,
        agent: Any,
        code: str,
        language: str = "python",
    ) -> str:
        """Called when an AutoGen agent executes code.

        Returns a call_id for pairing with on_code_result.
        Emits a custom ``code_execution`` event.
        """
        try:
            call_id = str(uuid.uuid4())
            agent_name = self._agent_name(agent)

            config = self._get_client_and_config()
            if config is not None:
                client, _agent_id, session_id, _redact = config
                event = {
                    "sessionId": session_id,
                    "agentId": agent_name,
                    "eventType": "custom",
                    "severity": "info",
                    "payload": {
                        "type": "code_execution",
                        "data": {
                            "call_id": call_id,
                            "agent": agent_name,
                            "language": language,
                            "code": code[:2000],
                        },
                    },
                    "metadata": self._framework_metadata("code_execution"),
                    "timestamp": self._now(),
                }
                self._send_event(client, event)
            return call_id
        except Exception:
            logger.debug("AgentLens AutoGen: on_code_execution error", exc_info=True)
            return ""

    def on_code_result(
        self,
        agent: Any,
        call_id: str = "",
        result: str = "",
        exit_code: int = 0,
    ) -> None:
        """Called when code execution completes.

        Emits a custom ``code_result`` event.
        """
        try:
            agent_name = self._agent_name(agent)

            config = self._get_client_and_config()
            if config is not None:
                client, _agent_id, session_id, _redact = config
                event = {
                    "sessionId": session_id,
                    "agentId": agent_name,
                    "eventType": "custom",
                    "severity": "info" if exit_code == 0 else "warning",
                    "payload": {
                        "type": "code_result",
                        "data": {
                            "call_id": call_id,
                            "agent": agent_name,
                            "result": result[:2000],
                            "exit_code": exit_code,
                        },
                    },
                    "metadata": self._framework_metadata("code_execution"),
                    "timestamp": self._now(),
                }
                self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens AutoGen: on_code_result error", exc_info=True)

    # ─── Tool/Function Calls ───────────────────────────

    def on_tool_call(
        self,
        agent: Any,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
    ) -> str:
        """Called when an AutoGen agent calls a tool/function.

        Returns a call_id for pairing with on_tool_result.
        """
        try:
            call_id = str(uuid.uuid4())
            self._tool_timers[call_id] = time.perf_counter()
            agent_name = self._agent_name(agent)

            self._send_tool_call(
                tool_name=tool_name,
                call_id=call_id,
                arguments={"agent": agent_name, **(arguments or {})},
            )
            return call_id
        except Exception:
            logger.debug("AgentLens AutoGen: on_tool_call error", exc_info=True)
            return ""

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


def instrument_autogen() -> None:
    """Auto-instrument AutoGen (placeholder — requires per-agent registration)."""
    logger.info("AgentLens: AutoGen handler available (register hooks per agent)")


def uninstrument_autogen() -> None:
    """Remove AutoGen instrumentation."""
    pass

"""Fail-safe event sender for auto-instrumentation.

All sending is wrapped in try/except — NEVER raises to user code.
Supports both sync (inline) and background (threaded queue) modes.
"""
from __future__ import annotations

import logging
import queue
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Union

from agentlensai._state import InstrumentationState

logger = logging.getLogger("agentlensai")


@dataclass
class LlmCallData:
    """Captured data from an LLM call."""

    provider: str
    model: str
    messages: list[dict[str, Any]]  # Already in AgentLens format [{role, content}]
    system_prompt: str | None
    completion: str | None
    tool_calls: list[dict[str, Any]] | None
    finish_reason: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    latency_ms: float
    parameters: dict[str, Any] | None = None
    thinking_tokens: int | None = None


# Sentinel type and value for stopping the worker
_STOP = object()
_QueueItem = Union[tuple[InstrumentationState, LlmCallData], object]


class EventSender:
    """Background event sender with fail-safe guarantees."""

    def __init__(self, sync_mode: bool = False) -> None:
        self._sync_mode = sync_mode
        self._queue: queue.Queue[_QueueItem] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._started = False

    def start(self) -> None:
        """Start the background worker thread."""
        if self._sync_mode or self._started:
            return
        self._started = True
        self._worker = threading.Thread(
            target=self._worker_loop, daemon=True, name="agentlens-sender"
        )
        self._worker.start()

    def stop(self) -> None:
        """Stop the background worker and flush pending events."""
        if not self._started or self._sync_mode:
            return
        self._queue.put(_STOP)
        if self._worker is not None:
            self._worker.join(timeout=5.0)
        self._started = False

    def send(self, state: InstrumentationState, data: LlmCallData) -> None:
        """Queue an LLM call for sending. Never raises."""
        try:
            if self._sync_mode:
                self._send_events(state, data)
            else:
                self._queue.put_nowait((state, data))
        except Exception:
            logger.debug("AgentLens: failed to queue event", exc_info=True)

    def flush(self, timeout: float = 5.0) -> None:  # noqa: ARG002
        """Wait for all pending events to be sent."""
        if self._sync_mode:
            return
        self._queue.join()

    def _worker_loop(self) -> None:
        """Background worker that processes the event queue."""
        while True:
            try:
                item = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue

            if item is _STOP:
                self._queue.task_done()
                break

            assert isinstance(item, tuple)
            state, data = item
            try:
                self._send_events(state, data)
            except Exception:
                logger.debug("AgentLens: failed to send events", exc_info=True)
            finally:
                self._queue.task_done()

    def _send_events(self, state: InstrumentationState, data: LlmCallData) -> None:
        """Build and send paired llm_call + llm_response events."""
        call_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        redacted = state.redact

        # Build messages (potentially redacted)
        messages: list[dict[str, Any]] = data.messages
        if redacted:
            messages = [
                {"role": m.get("role", "user"), "content": "[REDACTED]"} for m in messages
            ]

        # llm_call payload
        call_payload: dict[str, Any] = {
            "callId": call_id,
            "provider": data.provider,
            "model": data.model,
            "messages": messages,
        }
        if data.system_prompt is not None:
            call_payload["systemPrompt"] = "[REDACTED]" if redacted else data.system_prompt
        if data.parameters is not None:
            call_payload["parameters"] = data.parameters
        if redacted:
            call_payload["redacted"] = True

        # llm_response payload
        usage: dict[str, Any] = {
            "inputTokens": data.input_tokens,
            "outputTokens": data.output_tokens,
            "totalTokens": data.total_tokens,
        }
        if data.thinking_tokens is not None:
            usage["thinkingTokens"] = data.thinking_tokens

        resp_payload: dict[str, Any] = {
            "callId": call_id,
            "provider": data.provider,
            "model": data.model,
            "completion": "[REDACTED]" if redacted else data.completion,
            "finishReason": data.finish_reason,
            "usage": usage,
            "costUsd": data.cost_usd,
            "latencyMs": data.latency_ms,
        }
        if data.tool_calls is not None:
            resp_payload["toolCalls"] = data.tool_calls
        if redacted:
            resp_payload["redacted"] = True

        # Send as batch
        events: list[dict[str, Any]] = [
            {
                "sessionId": state.session_id,
                "agentId": state.agent_id,
                "eventType": "llm_call",
                "severity": "info",
                "payload": call_payload,
                "metadata": {"source": "auto-instrumentation"},
                "timestamp": timestamp,
            },
            {
                "sessionId": state.session_id,
                "agentId": state.agent_id,
                "eventType": "llm_response",
                "severity": "info",
                "payload": resp_payload,
                "metadata": {"source": "auto-instrumentation"},
                "timestamp": timestamp,
            },
        ]

        state.client._request("POST", "/api/events", json={"events": events})


# Module-level singleton
_sender: EventSender | None = None


def get_sender(sync_mode: bool = False) -> EventSender:
    """Get or create the global event sender."""
    global _sender  # noqa: PLW0603
    if _sender is None:
        _sender = EventSender(sync_mode=sync_mode)
        if not sync_mode:
            _sender.start()
    return _sender


def reset_sender() -> None:
    """Stop and reset the global sender (for testing/shutdown)."""
    global _sender  # noqa: PLW0603
    if _sender is not None:
        _sender.stop()
        _sender = None

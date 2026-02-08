"""LangChain callback handler for AgentLens.

Usage:
    from agentlensai.integrations.langchain import AgentLensCallbackHandler

    handler = AgentLensCallbackHandler()
    chain.invoke(input, config={"callbacks": [handler]})

    # Or with explicit client (no init() needed):
    from agentlensai import AgentLensClient
    handler = AgentLensCallbackHandler(
        client=AgentLensClient("http://localhost:3400", api_key="als_xxx"),
        agent_id="my-agent",
        session_id="ses_abc",
    )
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

logger = logging.getLogger("agentlensai")


class AgentLensCallbackHandler(BaseCallbackHandler):
    """LangChain callback handler that sends events to AgentLens.

    Works in two modes:
    1. With agentlensai.init() — uses global state automatically
    2. Standalone — pass client, agent_id, session_id to constructor
    """

    def __init__(
        self,
        client: Any | None = None,  # AgentLensClient
        agent_id: str | None = None,
        session_id: str | None = None,
        redact: bool = False,
    ) -> None:
        super().__init__()
        self._client = client
        self._agent_id = agent_id
        self._session_id = session_id or str(uuid.uuid4())
        self._redact = redact
        # Track active LLM calls for latency measurement
        self._run_timers: dict[str, float] = {}  # run_id -> start_time
        self._run_prompts: dict[str, list[list[str]]] = {}  # run_id -> prompts
        self._run_models: dict[str, str] = {}  # run_id -> model name

    def _get_client_and_config(self) -> tuple[Any, str, str, bool] | None:
        """Get client, agent_id, session_id, redact — from constructor or global state."""
        if self._client is not None:
            return (self._client, self._agent_id or "default", self._session_id, self._redact)

        from agentlensai._state import get_state

        state = get_state()
        if state is None:
            return None
        return (state.client, state.agent_id, state.session_id, state.redact or self._redact)

    # ─── LLM Callbacks ─────────────────────────────────

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM starts running."""
        try:
            rid = str(run_id)
            self._run_timers[rid] = time.perf_counter()
            self._run_prompts[rid] = [prompts]
            # Try to extract model name from serialized or kwargs
            model_name = (
                kwargs.get("invocation_params", {}).get("model_name")
                or kwargs.get("invocation_params", {}).get("model")
                or serialized.get("kwargs", {}).get("model_name")
                or serialized.get("kwargs", {}).get("model")
                or serialized.get("id", ["unknown"])[-1]
            )
            self._run_models[rid] = str(model_name)
        except Exception:
            pass

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM finishes."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, redact = config
            rid = str(run_id)

            start_time = self._run_timers.pop(rid, None)
            latency_ms = (time.perf_counter() - start_time) * 1000 if start_time else 0.0
            prompts = self._run_prompts.pop(rid, [[]])
            model_name = self._run_models.pop(rid, "unknown")

            # Extract completion from response
            completion = None
            if response.generations and response.generations[0]:
                gen = response.generations[0][0]
                completion = gen.text

            # Build messages from prompts
            messages = [{"role": "user", "content": p} for p in (prompts[0] if prompts else [])]

            # Extract token usage from llm_output
            input_tokens = 0
            output_tokens = 0
            total_tokens = 0
            if response.llm_output and isinstance(response.llm_output, dict):
                usage = response.llm_output.get("token_usage", {})
                if isinstance(usage, dict):
                    input_tokens = usage.get("prompt_tokens", 0) or 0
                    output_tokens = usage.get("completion_tokens", 0) or 0
                    total_tokens = usage.get("total_tokens", 0) or 0
                # Also check model name from response
                if response.llm_output.get("model_name"):
                    model_name = response.llm_output["model_name"]

            # Detect provider from model name
            provider = "unknown"
            model_lower = model_name.lower()
            if "gpt" in model_lower or "o1" in model_lower or "o3" in model_lower:
                provider = "openai"
            elif "claude" in model_lower:
                provider = "anthropic"
            elif "gemini" in model_lower:
                provider = "google"
            elif "llama" in model_lower or "mixtral" in model_lower:
                provider = "meta"

            from agentlensai._sender import LlmCallData, get_sender

            data = LlmCallData(
                provider=provider,
                model=model_name,
                messages=messages,
                system_prompt=None,
                completion=completion,
                tool_calls=None,
                finish_reason="stop",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                cost_usd=0.0,
                latency_ms=latency_ms,
                parameters=None,
            )

            # Use the sender if global state, otherwise send directly
            from agentlensai._state import get_state

            state = get_state()
            if state is not None:
                get_sender().send(state, data)
            else:
                # Standalone mode — build and send events directly
                self._send_direct(client, agent_id, session_id, data, redact)
        except Exception:
            logger.debug("AgentLens LangChain: on_llm_end error", exc_info=True)

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM errors."""
        try:
            rid = str(run_id)
            self._run_timers.pop(rid, None)
            self._run_prompts.pop(rid, None)
            self._run_models.pop(rid, None)
        except Exception:
            pass

    # ─── Tool Callbacks ─────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool starts."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, redact = config
            rid = str(run_id)
            self._run_timers[rid] = time.perf_counter()

            tool_name = serialized.get("name", "unknown_tool")
            call_id = rid

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_call",
                "severity": "info",
                "payload": {
                    "toolName": tool_name,
                    "callId": call_id,
                    "arguments": {"input": input_str},
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_tool_start error", exc_info=True)

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool ends."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, redact = config
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_response",
                "severity": "info",
                "payload": {
                    "callId": rid,
                    "toolName": "unknown",
                    "result": output[:1000],  # Truncate long outputs
                    "durationMs": round(duration_ms, 2),
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_tool_end error", exc_info=True)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool errors."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, redact = config
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "tool_error",
                "severity": "error",
                "payload": {
                    "callId": rid,
                    "toolName": "unknown",
                    "error": str(error)[:500],
                    "durationMs": round(duration_ms, 2),
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_tool_error error", exc_info=True)

    # ─── Chain Callbacks (v0.8.0) ─────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain starts running."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            rid = str(run_id)
            self._run_timers[rid] = time.perf_counter()

            chain_type = serialized.get("id", ["unknown"])[-1] if serialized.get("id") else serialized.get("name", "unknown")

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "chain_start",
                    "data": {
                        "chain_type": str(chain_type),
                        "run_id": rid,
                        "parent_run_id": str(parent_run_id) if parent_run_id else None,
                        "input_keys": list(inputs.keys()) if isinstance(inputs, dict) else [],
                        "tags": tags or [],
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_chain_start error", exc_info=True)

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain finishes."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "chain_end",
                    "data": {
                        "run_id": rid,
                        "duration_ms": round(duration_ms, 2),
                        "output_keys": list(outputs.keys()) if isinstance(outputs, dict) else [],
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_chain_end error", exc_info=True)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain errors."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "error",
                "payload": {
                    "type": "chain_error",
                    "data": {
                        "run_id": rid,
                        "error": str(error)[:500],
                        "duration_ms": round(duration_ms, 2),
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_chain_error error", exc_info=True)

    def on_agent_action(
        self,
        action: Any,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when an agent takes an action."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config

            tool = getattr(action, "tool", "unknown")
            tool_input = str(getattr(action, "tool_input", ""))[:200]

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "agent_action",
                    "data": {
                        "tool": str(tool),
                        "tool_input": tool_input,
                        "run_id": str(run_id),
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_agent_action error", exc_info=True)

    def on_agent_finish(
        self,
        finish: Any,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when an agent finishes."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config

            output = str(getattr(finish, "return_values", ""))[:500]

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "agent_finish",
                    "data": {
                        "output": output,
                        "run_id": str(run_id),
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_agent_finish error", exc_info=True)

    def on_retriever_start(
        self,
        serialized: dict[str, Any],
        query: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever starts."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            rid = str(run_id)
            self._run_timers[rid] = time.perf_counter()

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "retriever_start",
                    "data": {
                        "query": query[:200],
                        "run_id": rid,
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_retriever_start error", exc_info=True)

    def on_retriever_end(
        self,
        documents: Any,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever finishes."""
        try:
            config = self._get_client_and_config()
            if config is None:
                return

            client, agent_id, session_id, _redact = config
            rid = str(run_id)
            start = self._run_timers.pop(rid, None)
            duration_ms = (time.perf_counter() - start) * 1000 if start else 0.0

            doc_count = len(documents) if documents else 0

            event = {
                "sessionId": session_id,
                "agentId": agent_id,
                "eventType": "custom",
                "severity": "info",
                "payload": {
                    "type": "retriever_end",
                    "data": {
                        "run_id": rid,
                        "document_count": doc_count,
                        "duration_ms": round(duration_ms, 2),
                    },
                },
                "metadata": {"source": "langchain"},
                "timestamp": self._now(),
            }
            self._send_event(client, event)
        except Exception:
            logger.debug("AgentLens LangChain: on_retriever_end error", exc_info=True)

    # ─── Helpers ────────────────────────────────────────

    @staticmethod
    def _now() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()

    def _send_event(self, client: Any, event: dict[str, Any]) -> None:
        """Send a single event to the server. Never raises."""
        try:
            client._request("POST", "/api/events", json={"events": [event]})
        except Exception:
            logger.debug("AgentLens LangChain: failed to send event", exc_info=True)

    def _send_direct(
        self,
        client: Any,
        agent_id: str,
        session_id: str,
        data: Any,  # LlmCallData
        redact: bool,
    ) -> None:
        """Send LLM call events directly (standalone mode, no global state)."""
        try:
            from agentlensai._sender import get_sender
            from agentlensai._state import InstrumentationState

            temp_state = InstrumentationState(
                client=client,
                agent_id=agent_id,
                session_id=session_id,
                redact=redact,
            )
            get_sender().send(temp_state, data)
        except Exception:
            logger.debug("AgentLens LangChain: failed to send direct", exc_info=True)

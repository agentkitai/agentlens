"""AgentLens auto-instrumentation entry point."""
from __future__ import annotations

import importlib.util
import logging
import uuid

from agentlensai._sender import get_sender, reset_sender
from agentlensai._state import InstrumentationState, clear_state, get_state, set_state
from agentlensai.client import AgentLensClient

logger = logging.getLogger("agentlensai")


def init(
    url: str,
    api_key: str | None = None,
    agent_id: str = "default",
    session_id: str | None = None,
    redact: bool = False,
    sync_mode: bool = False,
) -> str:
    """Initialize AgentLens auto-instrumentation.

    Automatically instruments any installed LLM provider SDKs
    (OpenAI, Anthropic) to capture all LLM calls.

    Args:
        url: AgentLens server URL (e.g., "http://localhost:3400")
        api_key: API key for authentication
        agent_id: Agent identifier for events
        session_id: Session ID (auto-generated if not provided)
        redact: If True, strip prompt/completion content from events
        sync_mode: If True, send events synchronously (useful for testing)

    Returns:
        The session ID being used
    """
    existing = get_state()
    if existing is not None:
        logger.warning("AgentLens already initialized. Call shutdown() first to reinitialize.")
        return existing.session_id

    # Create client
    client = AgentLensClient(url, api_key=api_key)

    # Generate session ID if not provided
    sid = session_id or str(uuid.uuid4())

    # Create and store state
    state = InstrumentationState(
        client=client,
        agent_id=agent_id,
        session_id=sid,
        redact=redact,
    )
    set_state(state)

    # Initialize sender
    get_sender(sync_mode=sync_mode)

    # Auto-detect and instrument providers
    _instrument_providers()

    logger.info("AgentLens initialized: agent=%s, session=%s", agent_id, sid)
    return sid


def shutdown() -> None:
    """Shut down AgentLens instrumentation.

    Flushes pending events, restores original methods, and cleans up.
    """
    state = get_state()
    if state is None:
        return

    # Flush and stop sender
    sender = get_sender()
    sender.flush(timeout=5.0)
    reset_sender()

    # Uninstrument providers
    _uninstrument_providers()

    # Close client and clear state
    state.client.close()
    clear_state()

    logger.info("AgentLens shut down")


def current_session_id() -> str | None:
    """Get the current session ID, or None if not initialized."""
    state = get_state()
    return state.session_id if state else None


def _instrument_providers() -> None:
    """Auto-detect installed providers and instrument them."""
    if importlib.util.find_spec("openai") is not None:
        try:
            from agentlensai.integrations.openai import (  # type: ignore[import-not-found]
                instrument_openai,
            )

            instrument_openai()
            logger.info("AgentLens: OpenAI instrumented")
        except Exception:
            logger.debug("AgentLens: failed to instrument OpenAI", exc_info=True)

    if importlib.util.find_spec("anthropic") is not None:
        try:
            from agentlensai.integrations.anthropic import (  # type: ignore[import-not-found]
                instrument_anthropic,
            )

            instrument_anthropic()
            logger.info("AgentLens: Anthropic instrumented")
        except Exception:
            logger.debug("AgentLens: failed to instrument Anthropic", exc_info=True)


def _uninstrument_providers() -> None:
    """Restore original methods on all providers."""
    if importlib.util.find_spec("openai") is not None:
        try:
            from agentlensai.integrations.openai import (
                uninstrument_openai,
            )

            uninstrument_openai()
        except Exception:
            logger.debug("AgentLens: failed to uninstrument OpenAI", exc_info=True)

    if importlib.util.find_spec("anthropic") is not None:
        try:
            from agentlensai.integrations.anthropic import (
                uninstrument_anthropic,
            )

            uninstrument_anthropic()
        except Exception:
            logger.debug("AgentLens: failed to uninstrument Anthropic", exc_info=True)

"""AgentLens auto-instrumentation entry point."""
from __future__ import annotations

import importlib.util
import logging
import uuid
from typing import Union

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
    integrations: Union[str, list[str], None] = None,
) -> str:
    """Initialize AgentLens auto-instrumentation.

    Automatically instruments any installed LLM provider SDKs
    (OpenAI, Anthropic, etc.) to capture all LLM calls.

    Args:
        url: AgentLens server URL (e.g., "http://localhost:3400")
        api_key: API key for authentication
        agent_id: Agent identifier for events
        session_id: Session ID (auto-generated if not provided)
        redact: If True, strip prompt/completion content from events
        sync_mode: If True, send events synchronously (useful for testing)
        integrations: Which LLM providers to instrument:
            - ``None`` or ``"auto"`` — instrument all available (default)
            - ``["openai", "anthropic"]`` — explicit list
            - ``[]`` — none

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

    # Auto-detect and instrument providers via registry
    _instrument_providers(integrations)

    # Auto-detect and instrument frameworks (v0.8.0)
    _instrument_frameworks()

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

    # Uninstrument providers via registry
    _uninstrument_providers()

    # Uninstrument frameworks
    _uninstrument_frameworks()

    # Close client and clear state
    state.client.close()
    clear_state()

    logger.info("AgentLens shut down")


def current_session_id() -> str | None:
    """Get the current session ID, or None if not initialized."""
    state = get_state()
    return state.session_id if state else None


def _instrument_providers(integrations: Union[str, list[str], None] = None) -> None:
    """Auto-detect installed providers and instrument them via the registry."""
    # Ensure provider modules are imported so @register decorators fire
    _ensure_providers_imported()

    from agentlensai.integrations.registry import instrument_providers

    if integrations is None or integrations == "auto":
        # Instrument all available
        instrument_providers(names=None)
    elif isinstance(integrations, list):
        if len(integrations) == 0:
            return  # Explicitly no providers
        instrument_providers(names=integrations)
    else:
        logger.warning("AgentLens: invalid integrations value: %r", integrations)


def _ensure_providers_imported() -> None:
    """Import provider modules so their @register decorators execute."""
    # OpenAI
    if importlib.util.find_spec("openai") is not None:
        try:
            import agentlensai.integrations.openai  # noqa: F401
        except Exception:
            pass

    # Anthropic
    if importlib.util.find_spec("anthropic") is not None:
        try:
            import agentlensai.integrations.anthropic  # noqa: F401
        except Exception:
            pass


def _instrument_frameworks() -> None:
    """Auto-detect installed frameworks and instrument them."""
    if importlib.util.find_spec("crewai") is not None:
        try:
            from agentlensai.integrations.crewai import instrument_crewai
            instrument_crewai()
            logger.info("AgentLens: CrewAI instrumented")
        except Exception:
            logger.debug("AgentLens: failed to instrument CrewAI", exc_info=True)

    if importlib.util.find_spec("autogen") is not None:
        try:
            from agentlensai.integrations.autogen import instrument_autogen
            instrument_autogen()
            logger.info("AgentLens: AutoGen instrumented")
        except Exception:
            logger.debug("AgentLens: failed to instrument AutoGen", exc_info=True)

    if importlib.util.find_spec("semantic_kernel") is not None:
        try:
            from agentlensai.integrations.semantic_kernel import instrument_semantic_kernel
            instrument_semantic_kernel()
            logger.info("AgentLens: Semantic Kernel instrumented")
        except Exception:
            logger.debug("AgentLens: failed to instrument Semantic Kernel", exc_info=True)


def _uninstrument_frameworks() -> None:
    """Restore original methods on all frameworks."""
    if importlib.util.find_spec("crewai") is not None:
        try:
            from agentlensai.integrations.crewai import uninstrument_crewai
            uninstrument_crewai()
        except Exception:
            logger.debug("AgentLens: failed to uninstrument CrewAI", exc_info=True)

    if importlib.util.find_spec("autogen") is not None:
        try:
            from agentlensai.integrations.autogen import uninstrument_autogen
            uninstrument_autogen()
        except Exception:
            logger.debug("AgentLens: failed to uninstrument AutoGen", exc_info=True)

    if importlib.util.find_spec("semantic_kernel") is not None:
        try:
            from agentlensai.integrations.semantic_kernel import uninstrument_semantic_kernel
            uninstrument_semantic_kernel()
        except Exception:
            logger.debug("AgentLens: failed to uninstrument Semantic Kernel", exc_info=True)


def _uninstrument_providers() -> None:
    """Restore original methods on all providers via registry."""
    from agentlensai.integrations.registry import uninstrument_providers
    uninstrument_providers()

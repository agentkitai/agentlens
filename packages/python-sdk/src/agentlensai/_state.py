"""Global instrumentation state for AgentLens auto-instrumentation."""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from agentlensai.client import AgentLensClient


@dataclass
class InstrumentationState:
    """Holds the active instrumentation configuration."""

    client: AgentLensClient
    agent_id: str
    session_id: str
    redact: bool = False
    pii_patterns: list[re.Pattern] | None = None
    pii_filter: Callable[[str], str] | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


# Module-level singleton
_state: InstrumentationState | None = None
_state_lock = threading.Lock()


def get_state() -> InstrumentationState | None:
    """Get the current instrumentation state (None if not initialized)."""
    return _state


def set_state(state: InstrumentationState) -> None:
    """Set the global instrumentation state."""
    global _state  # noqa: PLW0603
    with _state_lock:
        _state = state


def clear_state() -> None:
    """Clear the global instrumentation state."""
    global _state  # noqa: PLW0603
    with _state_lock:
        _state = None

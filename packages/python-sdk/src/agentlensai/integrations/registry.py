"""Provider registry for LLM auto-instrumentation.

Maintains a mapping of provider names to their ``BaseLLMInstrumentation``
subclasses. Providers register themselves via the ``@register`` decorator.

Usage::

    from agentlensai.integrations.registry import instrument_providers, uninstrument_providers

    instrument_providers()                         # all available
    instrument_providers(names=["openai"])          # explicit list
    uninstrument_providers()                        # restore all
"""
from __future__ import annotations

import logging
from typing import Type

from agentlensai.integrations.base_llm import BaseLLMInstrumentation

logger = logging.getLogger("agentlensai")

# Maps provider name → instrumentation class
REGISTRY: dict[str, Type[BaseLLMInstrumentation]] = {}

# Active (instrumented) instances
_active: dict[str, BaseLLMInstrumentation] = {}


def register(name: str):  # type: ignore[no-untyped-def]
    """Class decorator that registers a ``BaseLLMInstrumentation`` subclass."""

    def decorator(cls: Type[BaseLLMInstrumentation]) -> Type[BaseLLMInstrumentation]:
        REGISTRY[name] = cls
        return cls

    return decorator


def instrument_providers(names: list[str] | None = None) -> list[str]:
    """Instrument requested providers (or all registered if *names* is ``None``).

    Providers whose underlying SDK is not installed are silently skipped.

    Args:
        names: Explicit list of provider names to instrument, or ``None`` for all.

    Returns:
        List of provider names that were successfully instrumented.
    """
    instrumented: list[str] = []
    targets = names if names is not None else list(REGISTRY.keys())

    for name in targets:
        cls = REGISTRY.get(name)
        if cls is None:
            logger.warning("AgentLens: unknown provider '%s'", name)
            continue

        if name in _active:
            instrumented.append(name)
            continue

        try:
            instance = cls()
            instance.instrument()
            _active[name] = instance
            instrumented.append(name)
            logger.info("AgentLens: %s instrumented", name)
        except ImportError:
            logger.debug("AgentLens: %s SDK not installed, skipping", name)
        except Exception:
            logger.debug("AgentLens: failed to instrument %s", name, exc_info=True)

    return instrumented


def uninstrument_providers(names: list[str] | None = None) -> None:
    """Uninstrument providers, restoring original methods.

    Args:
        names: Explicit list, or ``None`` to uninstrument all active providers.
    """
    targets = names if names is not None else list(_active.keys())

    for name in targets:
        instance = _active.pop(name, None)
        if instance is not None:
            try:
                instance.uninstrument()
            except Exception:
                logger.debug("AgentLens: failed to uninstrument %s", name, exc_info=True)


def get_active_providers() -> list[str]:
    """Return names of currently instrumented providers."""
    return list(_active.keys())


def reset_registry() -> None:
    """Uninstrument all and clear active instances. For testing."""
    uninstrument_providers()
    _active.clear()

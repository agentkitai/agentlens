"""Base class for LLM provider auto-instrumentation.

Extracts the shared monkey-patching lifecycle, timing, state check,
error handling, and stream pass-through from provider-specific integrations.

Subclasses implement only the provider-specific bits:
- ``_get_patch_targets()`` — what to patch
- ``_extract_call_data()`` — parse response into ``LlmCallData``
- ``_is_streaming()`` — detect streaming calls
- ``_extract_model()`` — pull model name from kwargs
"""
from __future__ import annotations

import functools
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from agentlensai._sender import LlmCallData

logger = logging.getLogger("agentlensai")


@dataclass
class PatchTarget:
    """Describes a single method/function to monkey-patch.

    Attributes:
        module_path: Dotted import path, e.g. ``"openai.resources.chat.completions"``.
        class_name: Name of the class on the module (or ``None`` for module-level functions).
        attr_name: Attribute/method name to patch.
        is_async: Whether the target is an async function/method.
    """

    module_path: str
    class_name: str | None
    attr_name: str
    is_async: bool = False


class BaseLLMInstrumentation(ABC):
    """Base class for LLM provider auto-instrumentation.

    Handles the full instrument/uninstrument lifecycle, sync/async wrapper
    generation with timing + state check + error isolation, stream pass-through,
    and double-instrumentation guard.

    Subclasses only need to implement four abstract methods.
    """

    provider_name: str = ""

    def __init__(self) -> None:
        self._originals: dict[str, Any] = {}
        self._instrumented: bool = False

    # ------------------------------------------------------------------
    # Abstract methods — subclasses must implement
    # ------------------------------------------------------------------

    @abstractmethod
    def _get_patch_targets(self) -> list[PatchTarget]:
        """Return the list of targets to monkey-patch."""
        ...

    @abstractmethod
    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        """Parse a provider response into an ``LlmCallData``."""
        ...

    @abstractmethod
    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        """Return ``True`` if the call is a streaming request."""
        ...

    @abstractmethod
    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        """Extract the model identifier from call arguments."""
        ...

    # ------------------------------------------------------------------
    # Public lifecycle
    # ------------------------------------------------------------------

    def instrument(self) -> None:
        """Patch all targets. Idempotent — second call is a no-op."""
        if self._instrumented:
            return

        import importlib

        for target in self._get_patch_targets():
            key = f"{target.module_path}.{target.class_name}.{target.attr_name}"
            try:
                mod = importlib.import_module(target.module_path)
                owner: Any = getattr(mod, target.class_name) if target.class_name else mod
                original = getattr(owner, target.attr_name)
                self._originals[key] = (owner, target.attr_name, original)

                if target.is_async:
                    wrapper = self._make_async_wrapper(original)
                else:
                    wrapper = self._make_sync_wrapper(original)

                setattr(owner, target.attr_name, wrapper)
            except Exception:
                logger.debug(
                    "AgentLens: failed to patch %s", key, exc_info=True
                )

        self._instrumented = True
        logger.debug("AgentLens: %s instrumented", self.provider_name)

    def uninstrument(self) -> None:
        """Restore all original methods. Idempotent."""
        if not self._instrumented:
            return

        for key, (owner, attr_name, original) in self._originals.items():
            try:
                setattr(owner, attr_name, original)
            except Exception:
                logger.debug(
                    "AgentLens: failed to restore %s", key, exc_info=True
                )

        self._originals.clear()
        self._instrumented = False
        logger.debug("AgentLens: %s uninstrumented", self.provider_name)

    @property
    def is_instrumented(self) -> bool:
        """Whether this provider is currently instrumented."""
        return self._instrumented

    # ------------------------------------------------------------------
    # Wrapper generation
    # ------------------------------------------------------------------

    def _make_sync_wrapper(self, original: Callable[..., Any]) -> Callable[..., Any]:
        """Create a sync wrapper with timing, state check, error handling."""
        instrumentation = self

        @functools.wraps(original)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()

            # Not initialised → pass-through
            if state is None:
                return original(*args, **kwargs)

            # Streaming → pass-through
            if instrumentation._is_streaming(kwargs):
                return original(*args, **kwargs)

            start_time = time.perf_counter()

            # Call original — let exceptions propagate untouched
            response = original(*args, **kwargs)

            # Post-call capture (never break user code)
            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = instrumentation._extract_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:  # noqa: BLE001
                logger.debug(
                    "AgentLens: failed to capture %s call",
                    instrumentation.provider_name,
                    exc_info=True,
                )

            return response

        return wrapper

    def _make_async_wrapper(self, original: Callable[..., Any]) -> Callable[..., Any]:
        """Create an async wrapper with timing, state check, error handling."""
        instrumentation = self

        @functools.wraps(original)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            from agentlensai._sender import get_sender
            from agentlensai._state import get_state

            state = get_state()

            if state is None:
                return await original(*args, **kwargs)

            if instrumentation._is_streaming(kwargs):
                return await original(*args, **kwargs)

            start_time = time.perf_counter()

            response = await original(*args, **kwargs)

            try:
                latency_ms = (time.perf_counter() - start_time) * 1000
                data = instrumentation._extract_call_data(response, kwargs, latency_ms)
                get_sender().send(state, data)
            except Exception:  # noqa: BLE001
                logger.debug(
                    "AgentLens: failed to capture async %s call",
                    instrumentation.provider_name,
                    exc_info=True,
                )

            return response

        return wrapper

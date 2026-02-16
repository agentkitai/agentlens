"""Tests for BaseLLMInstrumentation base class (S0.1) and provider registry (S0.2),
OpenAI/Anthropic refactor (S0.3/S0.4), and init() integrations param (S0.5).
"""

from __future__ import annotations

import sys

# ---------------------------------------------------------------------------
# Mock subclass for testing the base class
# ---------------------------------------------------------------------------
# We need a real module + class to patch. Use a dynamically created one.
import types
from typing import Any
from unittest.mock import MagicMock

import pytest

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation, PatchTarget

_fake_mod = types.ModuleType("_fake_llm_sdk")
sys.modules["_fake_llm_sdk"] = _fake_mod


class _FakeClient:
    def create(self, **kwargs: Any) -> dict[str, Any]:
        return {"text": "original", "model": "fake-1"}

    async def acreate(self, **kwargs: Any) -> dict[str, Any]:
        return {"text": "original-async", "model": "fake-1"}


_fake_mod.FakeClient = _FakeClient  # type: ignore[attr-defined]


class FakeLLMInstrumentation(BaseLLMInstrumentation):
    provider_name = "fake"

    def _get_patch_targets(self) -> list[PatchTarget]:
        return [
            PatchTarget("_fake_llm_sdk", "FakeClient", "create", is_async=False),
            PatchTarget("_fake_llm_sdk", "FakeClient", "acreate", is_async=True),
        ]

    def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
        return bool(kwargs.get("stream", False))

    def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
        return "fake-1"

    def _extract_call_data(
        self, response: Any, kwargs: dict[str, Any], latency_ms: float
    ) -> LlmCallData:
        return LlmCallData(
            provider="fake",
            model="fake-1",
            messages=[],
            system_prompt=None,
            completion=str(response.get("text", "")),
            tool_calls=None,
            finish_reason="stop",
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )


# ---------------------------------------------------------------------------
# S0.1 — BaseLLMInstrumentation tests
# ---------------------------------------------------------------------------


class TestBaseLLMInstrumentation:
    """Tests for the base class contract."""

    def setup_method(self) -> None:
        # Reset FakeClient methods to originals
        _FakeClient.create = lambda self, **kwargs: {"text": "original", "model": "fake-1"}

        async def _acreate(self: Any, **kwargs: Any) -> dict[str, Any]:
            return {"text": "original-async", "model": "fake-1"}

        _FakeClient.acreate = _acreate  # type: ignore[assignment]

    def test_instrument_patches_target(self) -> None:
        inst = FakeLLMInstrumentation()
        original = _FakeClient.create
        inst.instrument()
        assert _FakeClient.create is not original
        inst.uninstrument()
        assert _FakeClient.create is original

    def test_instrument_is_idempotent(self) -> None:
        inst = FakeLLMInstrumentation()
        inst.instrument()
        patched = _FakeClient.create
        inst.instrument()  # second call — no-op
        assert _FakeClient.create is patched
        inst.uninstrument()

    def test_uninstrument_is_idempotent(self) -> None:
        inst = FakeLLMInstrumentation()
        inst.uninstrument()  # not instrumented — no-op, no error
        inst.instrument()
        inst.uninstrument()
        inst.uninstrument()  # second uninstrument — no-op

    def test_is_instrumented_property(self) -> None:
        inst = FakeLLMInstrumentation()
        assert not inst.is_instrumented
        inst.instrument()
        assert inst.is_instrumented
        inst.uninstrument()
        assert not inst.is_instrumented

    def test_state_none_passthrough(self) -> None:
        """When state is None, original is called directly."""
        inst = FakeLLMInstrumentation()
        inst.instrument()
        try:
            client = _FakeClient()
            result = client.create(model="fake-1")
            assert result["text"] == "original"
        finally:
            inst.uninstrument()

    def test_error_isolation(self) -> None:
        """If _extract_call_data raises, user still gets their response."""
        from agentlensai._state import InstrumentationState, clear_state, set_state

        client_mock = MagicMock()
        state = InstrumentationState(client=client_mock, agent_id="t", session_id="s")
        set_state(state)

        inst = FakeLLMInstrumentation()
        # Make extract_call_data raise
        inst._extract_call_data = MagicMock(side_effect=RuntimeError("boom"))  # type: ignore[assignment]
        inst.instrument()
        try:
            client = _FakeClient()
            result = client.create(model="fake-1")
            # Should still get the response
            assert result["text"] == "original"
        finally:
            inst.uninstrument()
            clear_state()

    def test_streaming_passthrough(self) -> None:
        """Streaming calls pass through without capture."""
        from agentlensai._state import InstrumentationState, clear_state, set_state

        client_mock = MagicMock()
        state = InstrumentationState(client=client_mock, agent_id="t", session_id="s")
        set_state(state)

        inst = FakeLLMInstrumentation()
        inst.instrument()
        try:
            client = _FakeClient()
            result = client.create(model="fake-1", stream=True)
            assert result["text"] == "original"
        finally:
            inst.uninstrument()
            clear_state()


# ---------------------------------------------------------------------------
# S0.2 — Provider registry tests
# ---------------------------------------------------------------------------


class TestProviderRegistry:
    """Tests for the provider registry."""

    def setup_method(self) -> None:
        from agentlensai.integrations.registry import _active

        _active.clear()
        # Reset FakeClient
        _FakeClient.create = lambda self, **kwargs: {"text": "original", "model": "fake-1"}

    def teardown_method(self) -> None:
        from agentlensai.integrations.registry import _active

        for inst in _active.values():
            inst.uninstrument()
        _active.clear()

    def test_register_decorator(self) -> None:
        # OpenAI and Anthropic should already be registered via module import
        # Let's check our fake one
        from agentlensai.integrations.registry import REGISTRY, register

        @register("fake_test")
        class FakeTestInst(FakeLLMInstrumentation):
            provider_name = "fake_test"

        assert "fake_test" in REGISTRY
        assert REGISTRY["fake_test"] is FakeTestInst
        # Cleanup
        del REGISTRY["fake_test"]

    def test_instrument_providers_all(self) -> None:
        from agentlensai.integrations.registry import (
            REGISTRY,
            instrument_providers,
            register,
            uninstrument_providers,
        )

        @register("fake_all")
        class FakeAllInst(FakeLLMInstrumentation):
            provider_name = "fake_all"

        try:
            result = instrument_providers(names=["fake_all"])
            assert "fake_all" in result
        finally:
            uninstrument_providers(names=["fake_all"])
            del REGISTRY["fake_all"]

    def test_instrument_providers_selective(self) -> None:
        from agentlensai.integrations.registry import (
            REGISTRY,
            instrument_providers,
            register,
            uninstrument_providers,
        )

        @register("fake_sel_a")
        class FakeSelA(FakeLLMInstrumentation):
            provider_name = "fake_sel_a"

        @register("fake_sel_b")
        class FakeSelB(FakeLLMInstrumentation):
            provider_name = "fake_sel_b"

        try:
            result = instrument_providers(names=["fake_sel_a"])
            assert "fake_sel_a" in result
            assert "fake_sel_b" not in result
        finally:
            uninstrument_providers()
            del REGISTRY["fake_sel_a"]
            del REGISTRY["fake_sel_b"]

    def test_missing_sdk_skipped(self) -> None:
        from agentlensai.integrations.registry import (
            REGISTRY,
            instrument_providers,
            register,
        )

        @register("fake_missing")
        class FakeMissing(BaseLLMInstrumentation):
            provider_name = "fake_missing"

            def _get_patch_targets(self) -> list[PatchTarget]:
                return [PatchTarget("nonexistent_sdk_xyz", "Client", "create")]

            def _is_streaming(self, kwargs: dict[str, Any]) -> bool:
                return False

            def _extract_model(self, kwargs: dict[str, Any], args: tuple[Any, ...]) -> str:
                return "x"

            def _extract_call_data(
                self, response: Any, kwargs: dict[str, Any], latency_ms: float
            ) -> LlmCallData:
                raise NotImplementedError

            def instrument(self) -> None:
                raise ImportError("SDK not installed")

        try:
            result = instrument_providers(names=["fake_missing"])
            assert "fake_missing" not in result
        finally:
            del REGISTRY["fake_missing"]

    def test_unknown_provider_warns(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        from agentlensai.integrations.registry import instrument_providers

        with caplog.at_level(logging.WARNING, logger="agentlensai"):
            instrument_providers(names=["nonexistent_provider_xyz"])
        assert "unknown provider" in caplog.text.lower()


# ---------------------------------------------------------------------------
# S0.3 — OpenAI refactor tests
# ---------------------------------------------------------------------------


class TestOpenAIRefactor:
    """Verify OpenAI instrumentation inherits from base class and is registered."""

    def test_inherits_base_class(self) -> None:
        from agentlensai.integrations.openai import OpenAIInstrumentation

        assert issubclass(OpenAIInstrumentation, BaseLLMInstrumentation)

    def test_registered_in_registry(self) -> None:
        from agentlensai.integrations.registry import REGISTRY

        assert "openai" in REGISTRY


# ---------------------------------------------------------------------------
# S0.4 — Anthropic refactor tests
# ---------------------------------------------------------------------------


class TestAnthropicRefactor:
    """Verify Anthropic instrumentation inherits from base class and is registered."""

    def test_inherits_base_class(self) -> None:
        from agentlensai.integrations.anthropic import AnthropicInstrumentation

        assert issubclass(AnthropicInstrumentation, BaseLLMInstrumentation)

    def test_registered_in_registry(self) -> None:
        from agentlensai.integrations.registry import REGISTRY

        assert "anthropic" in REGISTRY


# ---------------------------------------------------------------------------
# S0.5 — init() integrations parameter tests
# ---------------------------------------------------------------------------


class TestInitIntegrations:
    """Tests for the integrations parameter on init()."""

    def setup_method(self) -> None:
        from agentlensai._sender import reset_sender
        from agentlensai._state import clear_state
        from agentlensai.integrations.registry import reset_registry

        reset_registry()
        clear_state()
        reset_sender()

    def teardown_method(self) -> None:
        import contextlib

        from agentlensai import shutdown
        from agentlensai._sender import reset_sender
        from agentlensai._state import clear_state
        from agentlensai.integrations.registry import reset_registry

        with contextlib.suppress(Exception):
            shutdown()
        reset_registry()
        clear_state()
        reset_sender()
        # Reset OpenAI/Anthropic originals
        try:
            from agentlensai.integrations.openai import uninstrument_openai

            uninstrument_openai()
        except Exception:
            pass
        try:
            from agentlensai.integrations.anthropic import uninstrument_anthropic

            uninstrument_anthropic()
        except Exception:
            pass

    def test_auto_mode_instruments_available(self) -> None:
        """integrations='auto' (or None) instruments all available providers."""
        from agentlensai import init
        from agentlensai.integrations.registry import get_active_providers

        init("http://localhost:3400", sync_mode=True, integrations="auto")
        active = get_active_providers()
        # Both openai and anthropic SDKs are installed in test env
        assert "openai" in active
        assert "anthropic" in active

    def test_explicit_list(self) -> None:
        """integrations=["openai"] only instruments OpenAI."""
        from agentlensai import init
        from agentlensai.integrations.registry import get_active_providers

        init("http://localhost:3400", sync_mode=True, integrations=["openai"])
        active = get_active_providers()
        assert "openai" in active
        assert "anthropic" not in active

    def test_empty_list_instruments_none(self) -> None:
        """integrations=[] instruments no providers."""
        from agentlensai import init
        from agentlensai.integrations.registry import get_active_providers

        init("http://localhost:3400", sync_mode=True, integrations=[])
        active = get_active_providers()
        assert len(active) == 0

    def test_default_behaves_like_auto(self) -> None:
        """No integrations param → same as 'auto'."""
        from agentlensai import init
        from agentlensai.integrations.registry import get_active_providers

        init("http://localhost:3400", sync_mode=True)
        active = get_active_providers()
        assert "openai" in active
        assert "anthropic" in active

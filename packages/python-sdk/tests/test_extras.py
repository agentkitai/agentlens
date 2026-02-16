"""Tests for optional extras / import safety (S5.1)."""

from __future__ import annotations


class TestImportSafety:
    """Verify that importing integration modules without SDKs doesn't crash."""

    def test_import_base_no_deps(self):
        """Base module imports without any provider SDK."""
        from agentlensai.integrations.base_llm import BaseLLMInstrumentation

        assert BaseLLMInstrumentation is not None

    def test_import_registry_no_deps(self):
        """Registry imports without any provider SDK."""
        from agentlensai.integrations.registry import REGISTRY

        assert REGISTRY is not None

    def test_import_pricing_no_deps(self):
        """Pricing module imports without any provider SDK."""
        from agentlensai.integrations.pricing import get_cost

        assert get_cost is not None

    def test_agentlensai_init_importable(self):
        """Main package imports without provider SDKs installed."""
        import agentlensai

        assert hasattr(agentlensai, "init")
        assert hasattr(agentlensai, "shutdown")

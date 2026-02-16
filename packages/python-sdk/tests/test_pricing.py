"""Tests for the pricing module (S5.3)."""

from __future__ import annotations

import logging

from agentlensai.integrations.pricing import get_cost


class TestPricing:
    """Tests for get_cost()."""

    def test_ollama_always_free(self):
        cost = get_cost("ollama", "llama3", 1000, 500)
        assert cost == 0.0

    def test_bedrock_known_model(self):
        cost = get_cost("bedrock", "anthropic.claude-3-haiku-20240307-v1:0", 1_000_000, 1_000_000)
        assert cost is not None
        # input: 0.25, output: 1.25 → total = 1.50
        assert abs(cost - 1.50) < 0.001

    def test_mistral_known_model(self):
        cost = get_cost("mistral", "mistral-large-latest", 1_000_000, 1_000_000)
        assert cost is not None
        # input: 4.0, output: 12.0 → total = 16.0
        assert abs(cost - 16.0) < 0.001

    def test_cohere_known_model(self):
        cost = get_cost("cohere", "command-r-plus", 500_000, 200_000)
        assert cost is not None
        # input: 500k * 3.0/1M = 1.5, output: 200k * 15.0/1M = 3.0 → 4.5
        assert abs(cost - 4.5) < 0.001

    def test_vertex_known_model(self):
        cost = get_cost("vertex", "gemini-1.5-flash", 1_000_000, 1_000_000)
        assert cost is not None
        # input: 0.075, output: 0.3 → 0.375
        assert abs(cost - 0.375) < 0.001

    def test_unknown_model_returns_none(self, caplog):
        with caplog.at_level(logging.WARNING):
            cost = get_cost("bedrock", "nonexistent-model-xyz", 100, 100)
        assert cost is None
        assert "unknown model" in caplog.text.lower()

    def test_unknown_provider_returns_none(self, caplog):
        with caplog.at_level(logging.WARNING):
            cost = get_cost("unknown_provider_xyz", "some-model", 100, 100)
        assert cost is None
        assert "unknown provider" in caplog.text.lower()

    def test_zero_tokens(self):
        cost = get_cost("bedrock", "anthropic.claude-3-haiku-20240307-v1:0", 0, 0)
        assert cost == 0.0

    def test_small_token_count(self):
        cost = get_cost("mistral", "mistral-tiny", 100, 50)
        assert cost is not None
        # 100 * 0.25/1M + 50 * 0.25/1M = 0.0000375
        assert cost > 0
        assert cost < 0.001

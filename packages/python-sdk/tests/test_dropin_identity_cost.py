"""Capture-time cost + verified-agent-token plumbing (#123)."""

from __future__ import annotations

import httpx
import respx

from agentlensai import init, shutdown
from agentlensai._state import get_state
from agentlensai.client import AgentLensClient
from agentlensai.integrations.pricing import cost_for

BASE_URL = "http://localhost:3400"


class TestCostFor:
    def test_openai_known_model(self) -> None:
        # gpt-4o = (2.5, 10.0) per 1M; 1M in + 1M out = 2.5 + 10.0
        assert cost_for("openai", "gpt-4o", 1_000_000, 1_000_000) == 12.5

    def test_openai_dated_alias_is_stripped(self) -> None:
        assert cost_for("openai", "gpt-4o-2024-08-06", 1_000_000, 0) == 2.5

    def test_anthropic_known_model(self) -> None:
        assert cost_for("anthropic", "claude-3-5-sonnet-20241022", 1_000_000, 0) == 3.0

    def test_unknown_model_or_provider_returns_zero(self) -> None:
        assert cost_for("openai", "totally-made-up", 100, 100) == 0.0
        assert cost_for("nope", "x", 100, 100) == 0.0
        assert cost_for("ollama", "llama3", 100, 100) == 0.0


class TestAgentTokenHeader:
    @respx.mock
    def test_client_sends_agent_token_and_ingest_key(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
        )
        client = AgentLensClient(BASE_URL, api_key="k", agent_token="tok-1", ingest_key="ing-1")
        client.query_events()
        req = respx.calls[0].request
        assert req.headers["x-agent-token"] == "tok-1"
        assert req.headers["x-agent-ingest-key"] == "ing-1"

    def test_init_plumbs_agent_token_to_the_client(self) -> None:
        try:
            init(url=BASE_URL, api_key="k", agent_token="tok-xyz", integrations=[])
            state = get_state()
            assert state is not None
            assert state.client._client.headers["x-agent-token"] == "tok-xyz"
        finally:
            shutdown()

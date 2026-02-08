"""Tests for reflect (pattern analysis) in sync and async clients."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    ReflectQuery,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


def _reflect_response() -> dict:
    return {
        "analysis": "error_patterns",
        "insights": [
            {
                "type": "error_pattern",
                "summary": "Timeout errors spike on Mondays",
                "data": {"count": 42, "pattern": "TIMEOUT"},
                "confidence": 0.85,
            },
        ],
        "metadata": {
            "sessionsAnalyzed": 100,
            "eventsAnalyzed": 5000,
            "timeRange": {"from": "2025-01-01", "to": "2025-01-31"},
        },
    }


class TestSyncReflect:
    @respx.mock
    def test_sends_analysis_param(self) -> None:
        respx.get(f"{BASE_URL}/api/reflect").mock(
            return_value=httpx.Response(200, json=_reflect_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.reflect(ReflectQuery(analysis="error_patterns"))
        url = respx.calls[0].request.url
        assert url.params["analysis"] == "error_patterns"
        client.close()

    @respx.mock
    def test_sends_optional_params(self) -> None:
        respx.get(f"{BASE_URL}/api/reflect").mock(
            return_value=httpx.Response(200, json=_reflect_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.reflect(
            ReflectQuery(
                analysis="cost_analysis",
                agent_id="agent_001",
                from_time="2025-01-01",
                to="2025-01-31",
                limit=50,
            )
        )
        url = respx.calls[0].request.url
        assert url.params["analysis"] == "cost_analysis"
        assert url.params["agentId"] == "agent_001"
        assert url.params["from"] == "2025-01-01"
        assert url.params["to"] == "2025-01-31"
        assert url.params["limit"] == "50"
        client.close()

    @respx.mock
    def test_returns_reflect_result(self) -> None:
        respx.get(f"{BASE_URL}/api/reflect").mock(
            return_value=httpx.Response(200, json=_reflect_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.reflect(ReflectQuery(analysis="error_patterns"))
        assert result.analysis == "error_patterns"
        assert len(result.insights) == 1
        assert result.insights[0].confidence == 0.85
        assert result.metadata.sessions_analyzed == 100
        client.close()


class TestAsyncReflect:
    @respx.mock
    @pytest.mark.anyio
    async def test_sends_analysis_param(self) -> None:
        respx.get(f"{BASE_URL}/api/reflect").mock(
            return_value=httpx.Response(200, json=_reflect_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            await client.reflect(ReflectQuery(analysis="error_patterns"))
        url = respx.calls[0].request.url
        assert url.params["analysis"] == "error_patterns"

    @respx.mock
    @pytest.mark.anyio
    async def test_returns_reflect_result(self) -> None:
        respx.get(f"{BASE_URL}/api/reflect").mock(
            return_value=httpx.Response(200, json=_reflect_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.reflect(ReflectQuery(analysis="error_patterns"))
        assert result.analysis == "error_patterns"
        assert result.metadata.events_analyzed == 5000

"""Tests for agent health scores and optimization recommendations (Story 3.2)."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    CostRecommendation,
    HealthDimension,
    HealthScore,
    HealthTrend,
    NotFoundError,
    OptimizationResult,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


# ─── Fixtures ────────────────────────────────────────────────────────────────


def _health_score_response(agent_id: str = "agent_001") -> dict:
    return {
        "agentId": agent_id,
        "overallScore": 85.5,
        "dimensions": [
            {
                "name": "success_rate",
                "score": 92.0,
                "weight": 0.3,
                "trend": "improving",
                "rawValue": 0.92,
                "description": "Percentage of successful calls",
            },
            {
                "name": "cost_efficiency",
                "score": 78.0,
                "weight": 0.25,
                "trend": "stable",
                "rawValue": 0.032,
                "description": "Cost per successful outcome",
            },
        ],
        "trend": {
            "direction": "improving",
            "delta": 3.2,
            "previousScore": 82.3,
        },
        "computedAt": "2026-02-08T12:00:00Z",
        "windowDays": 7,
    }


def _optimization_response() -> dict:
    return {
        "recommendations": [
            {
                "currentModel": "gpt-4",
                "recommendedModel": "gpt-4o-mini",
                "complexityTier": "simple",
                "currentCostPerCall": 0.05,
                "recommendedCostPerCall": 0.002,
                "monthlySavings": 144.0,
                "callVolume": 3000,
                "currentSuccessRate": 0.95,
                "recommendedSuccessRate": 0.93,
                "confidence": 0.88,
                "agentId": "agent_001",
            },
        ],
        "totalPotentialSavings": 144.0,
        "period": 7,
        "analyzedCalls": 3000,
    }


# ─── Sync Client Tests ──────────────────────────────────────────────────────


class TestSyncGetHealth:
    @respx.mock
    def test_url_and_default_window(self) -> None:
        """get_health sends correct URL with default window=7."""
        route = respx.get(f"{BASE_URL}/api/agents/agent_001/health").mock(
            return_value=httpx.Response(200, json=_health_score_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_health("agent_001")
        url = respx.calls[0].request.url
        assert "/api/agents/agent_001/health" in str(url)
        assert url.params["window"] == "7"
        client.close()

    @respx.mock
    def test_custom_window(self) -> None:
        """get_health passes custom window parameter."""
        respx.get(f"{BASE_URL}/api/agents/agent_001/health").mock(
            return_value=httpx.Response(200, json=_health_score_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_health("agent_001", window=30)
        url = respx.calls[0].request.url
        assert url.params["window"] == "30"
        client.close()

    @respx.mock
    def test_deserializes_health_score(self) -> None:
        """get_health returns a properly deserialized HealthScore."""
        respx.get(f"{BASE_URL}/api/agents/agent_001/health").mock(
            return_value=httpx.Response(200, json=_health_score_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_health("agent_001")

        assert isinstance(result, HealthScore)
        assert result.agent_id == "agent_001"
        assert result.overall_score == 85.5
        assert result.window_days == 7
        assert result.computed_at == "2026-02-08T12:00:00Z"

        # Dimensions
        assert len(result.dimensions) == 2
        dim = result.dimensions[0]
        assert isinstance(dim, HealthDimension)
        assert dim.name == "success_rate"
        assert dim.score == 92.0
        assert dim.weight == 0.3
        assert dim.raw_value == 0.92

        # Trend
        assert isinstance(result.trend, HealthTrend)
        assert result.trend.direction == "improving"
        assert result.trend.delta == 3.2
        assert result.trend.previous_score == 82.3
        client.close()

    @respx.mock
    def test_404_raises_not_found(self) -> None:
        """get_health raises NotFoundError for unknown agent."""
        respx.get(f"{BASE_URL}/api/agents/unknown/health").mock(
            return_value=httpx.Response(
                404, json={"error": "Agent not found"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(NotFoundError):
            client.get_health("unknown")
        client.close()


class TestSyncHealthOverview:
    @respx.mock
    def test_returns_list(self) -> None:
        """get_health_overview returns a list of HealthScore."""
        respx.get(f"{BASE_URL}/api/health/overview").mock(
            return_value=httpx.Response(
                200,
                json=[
                    _health_score_response("agent_001"),
                    _health_score_response("agent_002"),
                ],
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_health_overview()

        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(s, HealthScore) for s in result)
        assert result[0].agent_id == "agent_001"
        assert result[1].agent_id == "agent_002"
        url = respx.calls[0].request.url
        assert url.params["window"] == "7"
        client.close()


class TestSyncOptimizationRecommendations:
    @respx.mock
    def test_default_params(self) -> None:
        """get_optimization_recommendations uses default period=7, limit=10."""
        respx.get(f"{BASE_URL}/api/optimize/recommendations").mock(
            return_value=httpx.Response(200, json=_optimization_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_optimization_recommendations()
        url = respx.calls[0].request.url
        assert url.params["period"] == "7"
        assert url.params["limit"] == "10"
        assert "agentId" not in url.params
        client.close()

    @respx.mock
    def test_with_agent_id(self) -> None:
        """get_optimization_recommendations passes agentId when provided."""
        respx.get(f"{BASE_URL}/api/optimize/recommendations").mock(
            return_value=httpx.Response(200, json=_optimization_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_optimization_recommendations(
            agent_id="agent_001", period=14, limit=5,
        )
        url = respx.calls[0].request.url
        assert url.params["agentId"] == "agent_001"
        assert url.params["period"] == "14"
        assert url.params["limit"] == "5"
        client.close()

    @respx.mock
    def test_deserializes_optimization_result(self) -> None:
        """get_optimization_recommendations returns OptimizationResult."""
        respx.get(f"{BASE_URL}/api/optimize/recommendations").mock(
            return_value=httpx.Response(200, json=_optimization_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_optimization_recommendations()

        assert isinstance(result, OptimizationResult)
        assert result.total_potential_savings == 144.0
        assert result.period == 7
        assert result.analyzed_calls == 3000

        assert len(result.recommendations) == 1
        rec = result.recommendations[0]
        assert isinstance(rec, CostRecommendation)
        assert rec.current_model == "gpt-4"
        assert rec.recommended_model == "gpt-4o-mini"
        assert rec.complexity_tier == "simple"
        assert rec.monthly_savings == 144.0
        assert rec.confidence == 0.88
        assert rec.agent_id == "agent_001"
        client.close()


# ─── Async Client Tests ─────────────────────────────────────────────────────


class TestAsyncGetHealth:
    @respx.mock
    @pytest.mark.anyio
    async def test_url_and_deserialization(self) -> None:
        """Async get_health sends correct URL and deserializes."""
        respx.get(f"{BASE_URL}/api/agents/agent_001/health").mock(
            return_value=httpx.Response(200, json=_health_score_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_health("agent_001", window=14)

        url = respx.calls[0].request.url
        assert url.params["window"] == "14"
        assert isinstance(result, HealthScore)
        assert result.overall_score == 85.5

    @respx.mock
    @pytest.mark.anyio
    async def test_404_raises_not_found(self) -> None:
        """Async get_health raises NotFoundError for unknown agent."""
        respx.get(f"{BASE_URL}/api/agents/bad_id/health").mock(
            return_value=httpx.Response(404, json={"error": "Agent not found"})
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            with pytest.raises(NotFoundError):
                await client.get_health("bad_id")


class TestAsyncHealthOverview:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_list(self) -> None:
        """Async get_health_overview returns list of HealthScore."""
        respx.get(f"{BASE_URL}/api/health/overview").mock(
            return_value=httpx.Response(
                200,
                json=[_health_score_response("a1"), _health_score_response("a2")],
            )
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_health_overview(window=30)

        assert len(result) == 2
        url = respx.calls[0].request.url
        assert url.params["window"] == "30"


class TestAsyncOptimizationRecommendations:
    @respx.mock
    @pytest.mark.anyio
    async def test_deserializes(self) -> None:
        """Async get_optimization_recommendations deserializes correctly."""
        respx.get(f"{BASE_URL}/api/optimize/recommendations").mock(
            return_value=httpx.Response(200, json=_optimization_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_optimization_recommendations(
                agent_id="agent_001",
            )

        assert isinstance(result, OptimizationResult)
        assert result.total_potential_savings == 144.0
        assert len(result.recommendations) == 1
        url = respx.calls[0].request.url
        assert url.params["agentId"] == "agent_001"

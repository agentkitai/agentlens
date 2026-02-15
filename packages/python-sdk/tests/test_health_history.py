"""Tests for get_health_history on the sync client."""

from __future__ import annotations

import httpx
import respx

from agentlensai import AgentLensClient, HealthHistoryResult

BASE_URL = "http://localhost:3400"

SAMPLE_HEALTH_HISTORY = {
    "snapshots": [
        {
            "agentId": "agent-1",
            "date": "2025-01-15",
            "overallScore": 85.0,
            "errorRateScore": 90.0,
            "costEfficiencyScore": 80.0,
            "toolSuccessScore": 88.0,
            "latencyScore": 82.0,
            "completionRateScore": 85.0,
            "sessionCount": 10,
        },
    ],
    "agentId": "agent-1",
    "days": 30,
}


class TestGetHealthHistory:
    @respx.mock
    def test_returns_health_history_result(self) -> None:
        respx.get(f"{BASE_URL}/api/health/history").mock(
            return_value=httpx.Response(200, json=SAMPLE_HEALTH_HISTORY),
        )
        client = AgentLensClient(BASE_URL, api_key="k")
        result = client.get_health_history("agent-1")
        assert isinstance(result, HealthHistoryResult)
        assert result.agent_id == "agent-1"
        assert result.days == 30
        assert len(result.snapshots) == 1
        assert result.snapshots[0].overall_score == 85.0
        assert result.snapshots[0].error_rate_score == 90.0
        assert result.snapshots[0].session_count == 10
        client.close()

    @respx.mock
    def test_sends_correct_params(self) -> None:
        respx.get(f"{BASE_URL}/api/health/history").mock(
            return_value=httpx.Response(200, json=SAMPLE_HEALTH_HISTORY),
        )
        client = AgentLensClient(BASE_URL, api_key="k")
        client.get_health_history("agent-1", days=14)
        url = respx.calls[0].request.url
        assert url.params["agentId"] == "agent-1"
        assert url.params["days"] == "14"
        client.close()

    @respx.mock
    def test_default_days_is_30(self) -> None:
        respx.get(f"{BASE_URL}/api/health/history").mock(
            return_value=httpx.Response(200, json=SAMPLE_HEALTH_HISTORY),
        )
        client = AgentLensClient(BASE_URL, api_key="k")
        client.get_health_history("agent-1")
        url = respx.calls[0].request.url
        assert url.params["days"] == "30"
        client.close()

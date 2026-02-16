"""Tests for AsyncAgentLensClient retry logic (429/503) and get_health_history."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
import respx

from agentlensai import (
    AsyncAgentLensClient,
    BackpressureError,
    HealthHistoryResult,
    RateLimitError,
)

BASE = "http://localhost:3400"

SAMPLE_EVENTS_RESPONSE = {"events": [], "total": 0, "hasMore": False}

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
        {
            "agentId": "agent-1",
            "date": "2025-01-14",
            "overallScore": 80.0,
            "errorRateScore": 85.0,
            "costEfficiencyScore": 75.0,
            "toolSuccessScore": 82.0,
            "latencyScore": 78.0,
            "completionRateScore": 80.0,
            "sessionCount": 8,
        },
    ],
    "agentId": "agent-1",
    "days": 30,
}


# ═══════════════════════════════════════════════════════════════════════════════
# Async client retry on 429
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_async_retry_on_429_with_retry_after():
    """429 with Retry-After header retries and succeeds."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(429, text="Rate limited", headers={"Retry-After": "0.01"}),
        httpx.Response(200, json=SAMPLE_EVENTS_RESPONSE),
    ]
    with patch("asyncio.sleep", return_value=None):
        # We need to make asyncio.sleep a coroutine
        pass

    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        # Patch asyncio.sleep to be a no-op coroutine
        import asyncio

        async def fast_sleep(seconds: float) -> None:
            pass  # Don't actually sleep in tests

        with patch.object(asyncio, "sleep", side_effect=fast_sleep):
            result = await client.query_events()

    assert result.total == 0
    assert len(route.calls) == 2


@respx.mock
async def test_async_retry_on_429_exhausts_retries():
    """429 that persists after max retries raises RateLimitError."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(429, text="Rate limited", headers={"Retry-After": "0.01"}),
        httpx.Response(429, text="Rate limited", headers={"Retry-After": "0.01"}),
        httpx.Response(429, text="Rate limited", headers={"Retry-After": "0.01"}),
        httpx.Response(429, text="Rate limited", headers={"Retry-After": "0.01"}),
    ]

    import asyncio

    async def fast_sleep(seconds: float) -> None:
        pass

    with patch.object(asyncio, "sleep", side_effect=fast_sleep):
        async with AsyncAgentLensClient(BASE, api_key="k") as client:
            with pytest.raises(RateLimitError):
                await client.query_events()

    assert len(route.calls) == 4  # 1 initial + 3 retries


@respx.mock
async def test_async_retry_on_503_with_backoff():
    """503 triggers exponential backoff retry."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(503, text="Service Unavailable"),
        httpx.Response(503, text="Service Unavailable"),
        httpx.Response(200, json=SAMPLE_EVENTS_RESPONSE),
    ]

    import asyncio

    sleep_times: list[float] = []

    async def recording_sleep(seconds: float) -> None:
        sleep_times.append(seconds)

    with patch.object(asyncio, "sleep", side_effect=recording_sleep):
        async with AsyncAgentLensClient(BASE, api_key="k") as client:
            result = await client.query_events()

    assert result.total == 0
    assert len(route.calls) == 3
    # Backoff: 1.0, 2.0
    assert sleep_times[0] == pytest.approx(1.0)
    assert sleep_times[1] == pytest.approx(2.0)


@respx.mock
async def test_async_retry_on_503_exhausts_retries():
    """503 that persists after max retries raises BackpressureError."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(503, text="Service Unavailable"),
        httpx.Response(503, text="Service Unavailable"),
        httpx.Response(503, text="Service Unavailable"),
        httpx.Response(503, text="Service Unavailable"),
    ]

    import asyncio

    async def fast_sleep(seconds: float) -> None:
        pass

    with patch.object(asyncio, "sleep", side_effect=fast_sleep):
        async with AsyncAgentLensClient(BASE, api_key="k") as client:
            with pytest.raises(BackpressureError):
                await client.query_events()

    assert len(route.calls) == 4


@respx.mock
async def test_async_no_retry_on_401():
    """401 is never retried."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(401, text="Unauthorized"),
    ]

    from agentlensai import AuthenticationError

    async with AsyncAgentLensClient(BASE, api_key="bad") as client:
        with pytest.raises(AuthenticationError):
            await client.query_events()

    assert len(route.calls) == 1


@respx.mock
async def test_async_no_retry_on_400():
    """400 is never retried."""
    route = respx.get(f"{BASE}/api/events")
    route.side_effect = [
        httpx.Response(400, text="Bad request"),
    ]

    from agentlensai import ValidationError

    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(ValidationError):
            await client.query_events()

    assert len(route.calls) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# get_health_history — async client
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_async_get_health_history():
    """get_health_history returns HealthHistoryResult."""
    respx.get(f"{BASE}/api/health/history").mock(
        return_value=httpx.Response(200, json=SAMPLE_HEALTH_HISTORY),
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_health_history("agent-1")

    assert isinstance(result, HealthHistoryResult)
    assert result.agent_id == "agent-1"
    assert result.days == 30
    assert len(result.snapshots) == 2
    assert result.snapshots[0].overall_score == 85.0
    assert result.snapshots[0].session_count == 10


@respx.mock
async def test_async_get_health_history_sends_params():
    """get_health_history sends agentId and days params."""
    respx.get(f"{BASE}/api/health/history").mock(
        return_value=httpx.Response(200, json=SAMPLE_HEALTH_HISTORY),
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.get_health_history("agent-1", days=14)

    url = respx.calls[0].request.url
    assert url.params["agentId"] == "agent-1"
    assert url.params["days"] == "14"


# ═══════════════════════════════════════════════════════════════════════════════
# get_agent — async client (parity with sync)
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_async_get_agent():
    """get_agent returns an Agent instance."""
    respx.get(f"{BASE}/api/agents/agent-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "agent-1",
                "name": "TestAgent",
                "status": "active",
                "modelOverride": None,
                "pausedAt": None,
                "firstSeenAt": "2025-01-01T00:00:00Z",
                "lastSeenAt": "2025-01-15T00:00:00Z",
                "sessionCount": 5,
                "tenantId": "default",
            },
        ),
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        agent = await client.get_agent("agent-1")

    assert agent.id == "agent-1"
    assert agent.name == "TestAgent"

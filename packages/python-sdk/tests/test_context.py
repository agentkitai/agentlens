"""Tests for context (cross-session) in sync and async clients."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    ContextQuery,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


def _context_response() -> dict:
    return {
        "topic": "deployment",
        "sessions": [
            {
                "sessionId": "sess_001",
                "agentId": "agent_001",
                "startedAt": "2025-01-01T00:00:00Z",
                "endedAt": "2025-01-01T01:00:00Z",
                "summary": "Deployed v2.0",
                "relevanceScore": 0.92,
                "keyEvents": [
                    {
                        "id": "ev_001",
                        "eventType": "tool_call",
                        "summary": "Called deploy tool",
                        "timestamp": "2025-01-01T00:30:00Z",
                    }
                ],
            }
        ],
        "lessons": [
            {
                "id": "les_001",
                "title": "Always run tests before deploy",
                "content": "Run full test suite before deploying.",
                "category": "deployment",
                "importance": "high",
                "relevanceScore": 0.88,
            }
        ],
        "summary": "Context about deployment",
    }


class TestSyncContext:
    @respx.mock
    def test_sends_topic_param(self) -> None:
        respx.get(f"{BASE_URL}/api/context").mock(
            return_value=httpx.Response(200, json=_context_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_context(ContextQuery(topic="deployment"))
        url = respx.calls[0].request.url
        assert url.params["topic"] == "deployment"
        client.close()

    @respx.mock
    def test_sends_optional_params(self) -> None:
        respx.get(f"{BASE_URL}/api/context").mock(
            return_value=httpx.Response(200, json=_context_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_context(
            ContextQuery(
                topic="deployment",
                user_id="user_001",
                agent_id="agent_001",
                limit=5,
            )
        )
        url = respx.calls[0].request.url
        assert url.params["userId"] == "user_001"
        assert url.params["agentId"] == "agent_001"
        assert url.params["limit"] == "5"
        client.close()

    @respx.mock
    def test_returns_context_result(self) -> None:
        respx.get(f"{BASE_URL}/api/context").mock(
            return_value=httpx.Response(200, json=_context_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_context(ContextQuery(topic="deployment"))
        assert result.topic == "deployment"
        assert len(result.sessions) == 1
        assert result.sessions[0].relevance_score == 0.92
        assert len(result.sessions[0].key_events) == 1
        assert len(result.lessons) == 1
        assert result.lessons[0].relevance_score == 0.88
        assert result.summary == "Context about deployment"
        client.close()


class TestAsyncContext:
    @respx.mock
    @pytest.mark.anyio
    async def test_sends_topic_param(self) -> None:
        respx.get(f"{BASE_URL}/api/context").mock(
            return_value=httpx.Response(200, json=_context_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            await client.get_context(ContextQuery(topic="deployment"))
        url = respx.calls[0].request.url
        assert url.params["topic"] == "deployment"

    @respx.mock
    @pytest.mark.anyio
    async def test_returns_context_result(self) -> None:
        respx.get(f"{BASE_URL}/api/context").mock(
            return_value=httpx.Response(200, json=_context_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_context(ContextQuery(topic="deployment"))
        assert result.topic == "deployment"
        assert len(result.sessions) == 1
        assert len(result.lessons) == 1

"""Tests for recall (semantic search) in sync and async clients."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    RecallQuery,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


def _recall_response() -> dict:
    return {
        "results": [
            {
                "sourceType": "event",
                "sourceId": "ev_001",
                "score": 0.95,
                "text": "Tool call to deploy",
                "metadata": {"sessionId": "sess_001"},
            },
        ],
        "query": "deploy",
        "totalResults": 1,
    }


class TestSyncRecall:
    @respx.mock
    def test_sends_query_param(self) -> None:
        respx.get(f"{BASE_URL}/api/recall").mock(
            return_value=httpx.Response(200, json=_recall_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.recall(RecallQuery(query="deploy"))
        url = respx.calls[0].request.url
        assert url.params["query"] == "deploy"
        client.close()

    @respx.mock
    def test_sends_optional_params(self) -> None:
        respx.get(f"{BASE_URL}/api/recall").mock(
            return_value=httpx.Response(200, json=_recall_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.recall(
            RecallQuery(
                query="deploy",
                scope="event",
                agent_id="agent_001",
                limit=5,
                min_score=0.7,
            )
        )
        url = respx.calls[0].request.url
        assert url.params["scope"] == "event"
        assert url.params["agentId"] == "agent_001"
        assert url.params["limit"] == "5"
        assert url.params["minScore"] == "0.7"
        client.close()

    @respx.mock
    def test_returns_recall_result(self) -> None:
        respx.get(f"{BASE_URL}/api/recall").mock(
            return_value=httpx.Response(200, json=_recall_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.recall(RecallQuery(query="deploy"))
        assert result.query == "deploy"
        assert result.total_results == 1
        assert len(result.results) == 1
        assert result.results[0].source_type == "event"
        assert result.results[0].score == 0.95
        client.close()


class TestAsyncRecall:
    @respx.mock
    @pytest.mark.anyio
    async def test_sends_query_param(self) -> None:
        respx.get(f"{BASE_URL}/api/recall").mock(
            return_value=httpx.Response(200, json=_recall_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            await client.recall(RecallQuery(query="deploy"))
        url = respx.calls[0].request.url
        assert url.params["query"] == "deploy"

    @respx.mock
    @pytest.mark.anyio
    async def test_returns_recall_result(self) -> None:
        respx.get(f"{BASE_URL}/api/recall").mock(
            return_value=httpx.Response(200, json=_recall_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.recall(RecallQuery(query="deploy"))
        assert result.total_results == 1
        assert result.results[0].score == 0.95

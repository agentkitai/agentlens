"""Tests for lesson CRUD in sync and async clients."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    CreateLessonInput,
    LessonQuery,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


def _lesson_data() -> dict:
    return {
        "id": "les_001",
        "tenantId": "tenant_1",
        "agentId": "agent_001",
        "category": "error-handling",
        "title": "Retry on timeout",
        "content": "Always retry once on timeout.",
        "context": {},
        "importance": "high",
        "sourceSessionId": None,
        "sourceEventId": None,
        "accessCount": 3,
        "lastAccessedAt": None,
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z",
        "archivedAt": None,
    }


class TestSyncCreateLesson:
    @respx.mock
    def test_sends_post_with_body(self) -> None:
        respx.post(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json=_lesson_data())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.create_lesson(
            CreateLessonInput(
                title="Retry on timeout",
                content="Always retry once on timeout.",
                category="error-handling",
                importance="high",
            )
        )
        body = json.loads(respx.calls[0].request.content)
        assert body["title"] == "Retry on timeout"
        assert body["importance"] == "high"
        client.close()

    @respx.mock
    def test_returns_lesson(self) -> None:
        respx.post(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json=_lesson_data())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.create_lesson(
            CreateLessonInput(title="Retry on timeout", content="Content")
        )
        assert result.id == "les_001"
        assert result.importance == "high"
        client.close()


class TestSyncGetLessons:
    @respx.mock
    def test_returns_list_result(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json={"lessons": [_lesson_data()], "total": 1})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_lessons()
        assert result.total == 1
        assert len(result.lessons) == 1
        client.close()

    @respx.mock
    def test_sends_filter_params(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json={"lessons": [], "total": 0})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_lessons(LessonQuery(category="error-handling", importance="high", limit=10))
        url = respx.calls[0].request.url
        assert url.params["category"] == "error-handling"
        assert url.params["importance"] == "high"
        assert url.params["limit"] == "10"
        client.close()


class TestSyncGetLesson:
    @respx.mock
    def test_returns_single_lesson(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json=_lesson_data())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_lesson("les_001")
        assert result.id == "les_001"
        assert result.title == "Retry on timeout"
        client.close()


class TestSyncUpdateLesson:
    @respx.mock
    def test_sends_put(self) -> None:
        updated = {**_lesson_data(), "title": "Updated"}
        respx.put(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json=updated)
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.update_lesson("les_001", {"title": "Updated"})
        assert result.title == "Updated"
        body = json.loads(respx.calls[0].request.content)
        assert body["title"] == "Updated"
        client.close()


class TestSyncDeleteLesson:
    @respx.mock
    def test_sends_delete(self) -> None:
        respx.delete(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json={"id": "les_001", "archived": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.delete_lesson("les_001")
        assert result.id == "les_001"
        assert result.archived is True
        client.close()


# ─── Async Tests ─────────────────────────────────────────────────────────────


class TestAsyncCreateLesson:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_lesson(self) -> None:
        respx.post(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json=_lesson_data())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.create_lesson(CreateLessonInput(title="Retry", content="Content"))
        assert result.id == "les_001"


class TestAsyncGetLessons:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_list_result(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json={"lessons": [_lesson_data()], "total": 1})
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_lessons()
        assert result.total == 1


class TestAsyncDeleteLesson:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_delete_result(self) -> None:
        respx.delete(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json={"id": "les_001", "archived": True})
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.delete_lesson("les_001")
        assert result.archived is True

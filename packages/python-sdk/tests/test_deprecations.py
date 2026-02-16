"""Tests for Lessons deprecation warnings and version consistency."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentlensai import AgentLensClient, AsyncAgentLensClient, CreateLessonInput

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"

_DEPRECATION_MSG = "Lessons API is deprecated. Use lore-sdk instead."

_LESSON = {
    "id": "les_001",
    "tenantId": "t",
    "agentId": "a",
    "category": "c",
    "title": "t",
    "content": "c",
    "context": {},
    "importance": "high",
    "sourceSessionId": None,
    "sourceEventId": None,
    "accessCount": 0,
    "lastAccessedAt": None,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z",
    "archivedAt": None,
}


class TestSyncLessonsDeprecation:
    """Every sync Lessons method emits a DeprecationWarning."""

    @respx.mock
    def test_create_lesson(self) -> None:
        respx.post(f"{BASE_URL}/api/lessons").mock(return_value=httpx.Response(200, json=_LESSON))
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
            client.create_lesson(CreateLessonInput(title="t", content="c"))
        client.close()

    @respx.mock
    def test_get_lessons(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json={"lessons": [], "total": 0})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
            client.get_lessons()
        client.close()

    @respx.mock
    def test_get_lesson(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json=_LESSON)
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
            client.get_lesson("les_001")
        client.close()

    @respx.mock
    def test_update_lesson(self) -> None:
        respx.put(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json=_LESSON)
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
            client.update_lesson("les_001", {"title": "new"})
        client.close()

    @respx.mock
    def test_delete_lesson(self) -> None:
        respx.delete(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json={"id": "les_001", "archived": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
            client.delete_lesson("les_001")
        client.close()


class TestAsyncLessonsDeprecation:
    """Every async Lessons method emits a DeprecationWarning."""

    @respx.mock
    @pytest.mark.anyio
    async def test_create_lesson(self) -> None:
        respx.post(f"{BASE_URL}/api/lessons").mock(return_value=httpx.Response(200, json=_LESSON))
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
                await client.create_lesson(CreateLessonInput(title="t", content="c"))

    @respx.mock
    @pytest.mark.anyio
    async def test_get_lessons(self) -> None:
        respx.get(f"{BASE_URL}/api/lessons").mock(
            return_value=httpx.Response(200, json={"lessons": [], "total": 0})
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
                await client.get_lessons()

    @respx.mock
    @pytest.mark.anyio
    async def test_delete_lesson(self) -> None:
        respx.delete(f"{BASE_URL}/api/lessons/les_001").mock(
            return_value=httpx.Response(200, json={"id": "les_001", "archived": True})
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            with pytest.warns(DeprecationWarning, match=_DEPRECATION_MSG):
                await client.delete_lesson("les_001")


class TestVersion:
    """__version__ matches pyproject.toml via importlib.metadata."""

    def test_version_is_not_hardcoded(self) -> None:
        import agentlensai

        # Should NOT be the old hardcoded value
        assert agentlensai.__version__ != "0.4.0"

    def test_version_matches_metadata(self) -> None:
        from importlib.metadata import version

        import agentlensai

        assert agentlensai.__version__ == version("agentlensai")

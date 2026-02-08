"""Synchronous HTTP client for the AgentLens API."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from agentlensai._utils import (
    build_context_query_params,
    build_event_query_params,
    build_lesson_query_params,
    build_llm_analytics_params,
    build_llm_call_events,
    build_recall_query_params,
    build_reflect_query_params,
    build_session_query_params,
    map_http_error,
)
from agentlensai.exceptions import AgentLensConnectionError
from agentlensai.models import (
    AgentLensEvent,
    ContextQuery,
    ContextResult,
    CreateLessonInput,
    DeleteLessonResult,
    EventQuery,
    EventQueryResult,
    HealthResult,
    Lesson,
    LessonListResult,
    LessonQuery,
    LlmAnalyticsParams,
    LlmAnalyticsResult,
    LogLlmCallParams,
    LogLlmCallResult,
    RecallQuery,
    RecallResult,
    ReflectQuery,
    ReflectResult,
    Session,
    SessionQuery,
    SessionQueryResult,
    TimelineResult,
)


class AgentLensClient:
    """Synchronous client for the AgentLens REST API.

    Usage::

        client = AgentLensClient("http://localhost:3400", api_key="als_xxx")
        events = client.query_events()

        # Or as context manager:
        with AgentLensClient("http://localhost:3400") as client:
            events = client.query_events()
    """

    def __init__(self, url: str, api_key: str | None = None) -> None:
        self._base_url = url.rstrip("/")
        self._api_key = api_key
        headers: dict[str, str] = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.Client(base_url=self._base_url, headers=headers)

    def __enter__(self) -> AgentLensClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    # ─── Internal ─────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        skip_auth: bool = False,
    ) -> Any:
        if skip_auth and "Authorization" in self._client.headers:
            # For health endpoint — exclude auth header.
            # Build the request manually so we can strip the header before sending.
            try:
                request = self._client.build_request(
                    method, path, params=params, json=json,
                )
                request.headers.pop("Authorization", None)
                response = self._client.send(request)
            except httpx.ConnectError as exc:
                raise AgentLensConnectionError(
                    f"Failed to connect to AgentLens at {self._base_url}: {exc}",
                    cause=exc,
                ) from exc
        else:
            try:
                response = self._client.request(method, path, params=params, json=json)
            except httpx.ConnectError as exc:
                raise AgentLensConnectionError(
                    f"Failed to connect to AgentLens at {self._base_url}: {exc}",
                    cause=exc,
                ) from exc

        if not response.is_success:
            raise map_http_error(response.status_code, response.text)

        return response.json()

    # ─── Events ───────────────────────────────────────────

    def query_events(self, query: EventQuery | None = None) -> EventQueryResult:
        """Query events with filters and pagination."""
        params = build_event_query_params(query)
        data = self._request("GET", "/api/events", params=params or None)
        return EventQueryResult.model_validate(data)

    def get_event(self, event_id: str) -> AgentLensEvent:
        """Get a single event by ID."""
        data = self._request("GET", f"/api/events/{event_id}")
        return AgentLensEvent.model_validate(data)

    # ─── Sessions ─────────────────────────────────────────

    def get_sessions(
        self, query: SessionQuery | None = None,
    ) -> SessionQueryResult:
        """Query sessions with filters and pagination."""
        params = build_session_query_params(query)
        data = self._request("GET", "/api/sessions", params=params or None)
        return SessionQueryResult.model_validate(data)

    def get_session(self, session_id: str) -> Session:
        """Get a single session by ID."""
        data = self._request("GET", f"/api/sessions/{session_id}")
        return Session.model_validate(data)

    def get_session_timeline(self, session_id: str) -> TimelineResult:
        """Get the full timeline for a session with hash chain verification."""
        data = self._request("GET", f"/api/sessions/{session_id}/timeline")
        return TimelineResult.model_validate(data)

    # ─── LLM Call Tracking ────────────────────────────────

    def log_llm_call(
        self,
        session_id: str,
        agent_id: str,
        params: LogLlmCallParams,
    ) -> LogLlmCallResult:
        """Log a complete LLM call (request + response) as paired events."""
        call_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        events = build_llm_call_events(session_id, agent_id, params, call_id, timestamp)
        self._request("POST", "/api/events", json={"events": events})
        return LogLlmCallResult(call_id=call_id)

    def get_llm_analytics(
        self, params: LlmAnalyticsParams | None = None,
    ) -> LlmAnalyticsResult:
        """Get LLM analytics (aggregate metrics)."""
        query_params = build_llm_analytics_params(params)
        data = self._request("GET", "/api/analytics/llm", params=query_params or None)
        return LlmAnalyticsResult.model_validate(data)

    # ─── Recall (Semantic Search) ─────────────────────────

    def recall(self, query: RecallQuery) -> RecallResult:
        """Semantic search over embeddings."""
        params = build_recall_query_params(query)
        data = self._request("GET", "/api/recall", params=params or None)
        return RecallResult.model_validate(data)

    # ─── Lessons ──────────────────────────────────────────

    def create_lesson(self, lesson: CreateLessonInput) -> Lesson:
        """Create a new lesson."""
        data = self._request(
            "POST",
            "/api/lessons",
            json=lesson.model_dump(by_alias=True, exclude_none=True),
        )
        return Lesson.model_validate(data)

    def get_lessons(
        self, query: LessonQuery | None = None,
    ) -> LessonListResult:
        """List lessons with optional filters."""
        params = build_lesson_query_params(query)
        data = self._request("GET", "/api/lessons", params=params or None)
        return LessonListResult.model_validate(data)

    def get_lesson(self, lesson_id: str) -> Lesson:
        """Get a single lesson by ID."""
        data = self._request("GET", f"/api/lessons/{lesson_id}")
        return Lesson.model_validate(data)

    def update_lesson(self, lesson_id: str, updates: dict) -> Lesson:
        """Update a lesson."""
        data = self._request("PUT", f"/api/lessons/{lesson_id}", json=updates)
        return Lesson.model_validate(data)

    def delete_lesson(self, lesson_id: str) -> DeleteLessonResult:
        """Delete (archive) a lesson."""
        data = self._request("DELETE", f"/api/lessons/{lesson_id}")
        return DeleteLessonResult.model_validate(data)

    # ─── Reflect (Pattern Analysis) ───────────────────────

    def reflect(self, query: ReflectQuery) -> ReflectResult:
        """Analyze patterns across sessions."""
        params = build_reflect_query_params(query)
        data = self._request("GET", "/api/reflect", params=params or None)
        return ReflectResult.model_validate(data)

    # ─── Context (Cross-Session) ──────────────────────────

    def get_context(self, query: ContextQuery) -> ContextResult:
        """Get cross-session context for a topic."""
        params = build_context_query_params(query)
        data = self._request("GET", "/api/context", params=params or None)
        return ContextResult.model_validate(data)

    # ─── Health ───────────────────────────────────────────

    def health(self) -> HealthResult:
        """Check server health (no auth required)."""
        data = self._request("GET", "/api/health", skip_auth=True)
        return HealthResult.model_validate(data)

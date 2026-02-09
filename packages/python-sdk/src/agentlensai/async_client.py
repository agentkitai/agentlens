"""Asynchronous HTTP client for the AgentLens API."""

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
    GuardrailDeleteResult,
    GuardrailRule,
    GuardrailRuleListResult,
    GuardrailStatusResult,
    GuardrailTriggerHistoryResult,
    HealthResult,
    HealthScore,
    Lesson,
    LessonListResult,
    LessonQuery,
    LlmAnalyticsParams,
    LlmAnalyticsResult,
    LogLlmCallParams,
    LogLlmCallResult,
    OptimizationResult,
    RecallQuery,
    RecallResult,
    ReflectQuery,
    ReflectResult,
    Session,
    SessionQuery,
    SessionQueryResult,
    TimelineResult,
)


class AsyncAgentLensClient:
    """Asynchronous client for the AgentLens REST API.

    Usage::

        client = AsyncAgentLensClient("http://localhost:3400", api_key="als_xxx")
        events = await client.query_events()
        await client.close()

        # Or as async context manager:
        async with AsyncAgentLensClient("http://localhost:3400") as client:
            events = await client.query_events()
    """

    def __init__(self, url: str, api_key: str | None = None) -> None:
        self._base_url = url.rstrip("/")
        self._api_key = api_key
        headers: dict[str, str] = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(base_url=self._base_url, headers=headers)

    async def __aenter__(self) -> AsyncAgentLensClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    # ─── Internal ─────────────────────────────────────────

    async def _request(
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
                response = await self._client.send(request)
            except httpx.ConnectError as exc:
                raise AgentLensConnectionError(
                    f"Failed to connect to AgentLens at {self._base_url}: {exc}",
                    cause=exc,
                ) from exc
        else:
            try:
                response = await self._client.request(
                    method, path, params=params, json=json
                )
            except httpx.ConnectError as exc:
                raise AgentLensConnectionError(
                    f"Failed to connect to AgentLens at {self._base_url}: {exc}",
                    cause=exc,
                ) from exc

        if not response.is_success:
            raise map_http_error(response.status_code, response.text)

        return response.json()

    # ─── Events ───────────────────────────────────────────

    async def query_events(
        self, query: EventQuery | None = None
    ) -> EventQueryResult:
        """Query events with filters and pagination."""
        params = build_event_query_params(query)
        data = await self._request("GET", "/api/events", params=params or None)
        return EventQueryResult.model_validate(data)

    async def get_event(self, event_id: str) -> AgentLensEvent:
        """Get a single event by ID."""
        data = await self._request("GET", f"/api/events/{event_id}")
        return AgentLensEvent.model_validate(data)

    # ─── Sessions ─────────────────────────────────────────

    async def get_sessions(
        self, query: SessionQuery | None = None
    ) -> SessionQueryResult:
        """Query sessions with filters and pagination."""
        params = build_session_query_params(query)
        data = await self._request("GET", "/api/sessions", params=params or None)
        return SessionQueryResult.model_validate(data)

    async def get_session(self, session_id: str) -> Session:
        """Get a single session by ID."""
        data = await self._request("GET", f"/api/sessions/{session_id}")
        return Session.model_validate(data)

    async def get_session_timeline(self, session_id: str) -> TimelineResult:
        """Get the full timeline for a session with hash chain verification."""
        data = await self._request("GET", f"/api/sessions/{session_id}/timeline")
        return TimelineResult.model_validate(data)

    # ─── LLM Call Tracking ────────────────────────────────

    async def log_llm_call(
        self,
        session_id: str,
        agent_id: str,
        params: LogLlmCallParams,
    ) -> LogLlmCallResult:
        """Log a complete LLM call (request + response) as paired events."""
        call_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        events = build_llm_call_events(
            session_id, agent_id, params, call_id, timestamp
        )
        await self._request("POST", "/api/events", json={"events": events})
        return LogLlmCallResult(call_id=call_id)

    async def get_llm_analytics(
        self, params: LlmAnalyticsParams | None = None
    ) -> LlmAnalyticsResult:
        """Get LLM analytics (aggregate metrics)."""
        query_params = build_llm_analytics_params(params)
        data = await self._request(
            "GET", "/api/analytics/llm", params=query_params or None
        )
        return LlmAnalyticsResult.model_validate(data)

    # ─── Recall (Semantic Search) ─────────────────────────

    async def recall(self, query: RecallQuery) -> RecallResult:
        """Semantic search over embeddings."""
        params = build_recall_query_params(query)
        data = await self._request("GET", "/api/recall", params=params or None)
        return RecallResult.model_validate(data)

    # ─── Lessons ──────────────────────────────────────────

    async def create_lesson(self, lesson: CreateLessonInput) -> Lesson:
        """Create a new lesson."""
        data = await self._request(
            "POST",
            "/api/lessons",
            json=lesson.model_dump(by_alias=True, exclude_none=True),
        )
        return Lesson.model_validate(data)

    async def get_lessons(
        self, query: LessonQuery | None = None,
    ) -> LessonListResult:
        """List lessons with optional filters."""
        params = build_lesson_query_params(query)
        data = await self._request("GET", "/api/lessons", params=params or None)
        return LessonListResult.model_validate(data)

    async def get_lesson(self, lesson_id: str) -> Lesson:
        """Get a single lesson by ID."""
        data = await self._request("GET", f"/api/lessons/{lesson_id}")
        return Lesson.model_validate(data)

    async def update_lesson(self, lesson_id: str, updates: dict) -> Lesson:
        """Update a lesson."""
        data = await self._request("PUT", f"/api/lessons/{lesson_id}", json=updates)
        return Lesson.model_validate(data)

    async def delete_lesson(self, lesson_id: str) -> DeleteLessonResult:
        """Delete (archive) a lesson."""
        data = await self._request("DELETE", f"/api/lessons/{lesson_id}")
        return DeleteLessonResult.model_validate(data)

    # ─── Reflect (Pattern Analysis) ───────────────────────

    async def reflect(self, query: ReflectQuery) -> ReflectResult:
        """Analyze patterns across sessions."""
        params = build_reflect_query_params(query)
        data = await self._request("GET", "/api/reflect", params=params or None)
        return ReflectResult.model_validate(data)

    # ─── Context (Cross-Session) ──────────────────────────

    async def get_context(self, query: ContextQuery) -> ContextResult:
        """Get cross-session context for a topic."""
        params = build_context_query_params(query)
        data = await self._request("GET", "/api/context", params=params or None)
        return ContextResult.model_validate(data)

    # ─── Health ───────────────────────────────────────────

    async def health(self) -> HealthResult:
        """Check server health (no auth required)."""
        data = await self._request("GET", "/api/health", skip_auth=True)
        return HealthResult.model_validate(data)

    # ─── Agent Health Scores (Story 3.2) ──────────────────

    async def get_health(self, agent_id: str, window: int = 7) -> HealthScore:
        """Get health score for a specific agent."""
        params = {"window": str(window)}
        data = await self._request(
            "GET", f"/api/agents/{agent_id}/health", params=params,
        )
        return HealthScore.model_validate(data)

    async def get_health_overview(self, window: int = 7) -> list[HealthScore]:
        """Get health overview for all agents."""
        params = {"window": str(window)}
        data = await self._request(
            "GET", "/api/health/overview", params=params,
        )
        return [HealthScore.model_validate(item) for item in data]

    # ─── Optimization Recommendations (Story 3.2) ────────

    async def get_optimization_recommendations(
        self,
        agent_id: str | None = None,
        period: int = 7,
        limit: int = 10,
    ) -> OptimizationResult:
        """Get cost-optimization recommendations."""
        params: dict[str, str] = {"period": str(period), "limit": str(limit)}
        if agent_id is not None:
            params["agentId"] = agent_id
        data = await self._request(
            "GET", "/api/optimize/recommendations", params=params,
        )
        return OptimizationResult.model_validate(data)

    # ─── Guardrails (v0.8.0 — Phase 3) ───────────────────────

    async def list_guardrails(
        self,
        agent_id: str | None = None,
    ) -> GuardrailRuleListResult:
        """List all guardrail rules, optionally filtered by agent."""
        params: dict[str, str] = {}
        if agent_id is not None:
            params["agentId"] = agent_id
        data = await self._request("GET", "/api/guardrails", params=params or None)
        return GuardrailRuleListResult.model_validate(data)

    async def get_guardrail(self, rule_id: str) -> GuardrailRule:
        """Get a single guardrail rule by ID."""
        data = await self._request("GET", f"/api/guardrails/{rule_id}")
        return GuardrailRule.model_validate(data)

    async def create_guardrail(
        self,
        *,
        name: str,
        condition_type: str,
        condition_config: dict[str, Any],
        action_type: str,
        action_config: dict[str, Any],
        description: str | None = None,
        agent_id: str | None = None,
        enabled: bool = False,
        dry_run: bool = True,
        cooldown_minutes: int = 5,
    ) -> GuardrailRule:
        """Create a new guardrail rule."""
        body: dict[str, Any] = {
            "name": name,
            "conditionType": condition_type,
            "conditionConfig": condition_config,
            "actionType": action_type,
            "actionConfig": action_config,
            "enabled": enabled,
            "dryRun": dry_run,
            "cooldownMinutes": cooldown_minutes,
        }
        if description is not None:
            body["description"] = description
        if agent_id is not None:
            body["agentId"] = agent_id
        data = await self._request("POST", "/api/guardrails", json=body)
        return GuardrailRule.model_validate(data)

    async def update_guardrail(self, rule_id: str, **kwargs: Any) -> GuardrailRule:
        """Update a guardrail rule. Pass camelCase or snake_case kwargs."""
        key_map = {
            "name": "name",
            "description": "description",
            "condition_type": "conditionType",
            "condition_config": "conditionConfig",
            "action_type": "actionType",
            "action_config": "actionConfig",
            "agent_id": "agentId",
            "enabled": "enabled",
            "dry_run": "dryRun",
            "cooldown_minutes": "cooldownMinutes",
        }
        body: dict[str, Any] = {}
        for k, v in kwargs.items():
            camel_key = key_map.get(k, k)
            body[camel_key] = v
        data = await self._request("PUT", f"/api/guardrails/{rule_id}", json=body)
        return GuardrailRule.model_validate(data)

    async def delete_guardrail(self, rule_id: str) -> GuardrailDeleteResult:
        """Delete a guardrail rule."""
        data = await self._request("DELETE", f"/api/guardrails/{rule_id}")
        return GuardrailDeleteResult.model_validate(data)

    async def enable_guardrail(self, rule_id: str) -> GuardrailRule:
        """Enable a guardrail rule."""
        return await self.update_guardrail(rule_id, enabled=True)

    async def disable_guardrail(self, rule_id: str) -> GuardrailRule:
        """Disable a guardrail rule."""
        return await self.update_guardrail(rule_id, enabled=False)

    async def get_guardrail_history(
        self,
        rule_id: str | None = None,
        limit: int = 50,
    ) -> GuardrailTriggerHistoryResult:
        """Get trigger history for guardrail rules."""
        params: dict[str, str] = {"limit": str(limit)}
        if rule_id is not None:
            params["ruleId"] = rule_id
        data = await self._request("GET", "/api/guardrails/history", params=params)
        return GuardrailTriggerHistoryResult.model_validate(data)

    async def get_guardrail_status(self, rule_id: str) -> GuardrailStatusResult:
        """Get status + recent triggers for a guardrail rule."""
        data = await self._request("GET", f"/api/guardrails/{rule_id}/status")
        return GuardrailStatusResult.model_validate(data)

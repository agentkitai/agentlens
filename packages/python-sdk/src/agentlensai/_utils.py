"""Shared utilities for sync and async clients."""

from __future__ import annotations

import contextlib
import json
from typing import Any

from agentlensai.exceptions import (
    AgentLensError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
)


def build_query_params(params: dict[str, Any]) -> dict[str, str]:
    """Convert a dict of query params to URL-ready string dict.

    - Skip None values
    - Join lists with commas
    - Convert ints/floats to strings
    """
    result: dict[str, str] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, list):
            result[key] = ",".join(str(v) for v in value)
        else:
            result[key] = str(value)
    return result


def map_http_error(status: int, body_text: str) -> AgentLensError:
    """Map HTTP status + body to the appropriate exception."""
    parsed: Any = None
    with contextlib.suppress(json.JSONDecodeError, ValueError):
        parsed = json.loads(body_text)

    message: str = ""
    details: Any = None
    if isinstance(parsed, dict):
        raw_error = parsed.get("error", "")
        message = str(raw_error) if raw_error else (body_text or f"HTTP {status}")
        details = parsed.get("details")
    else:
        message = body_text or f"HTTP {status}"

    if status == 401:
        return AuthenticationError(message)
    elif status == 404:
        return NotFoundError(message)
    elif status == 400:
        return ValidationError(message, details)
    else:
        return AgentLensError(message, status=status, code="API_ERROR", details=details)


def build_event_query_params(
    query: Any = None,
) -> dict[str, str]:
    """Build URL params from an EventQuery model."""
    from agentlensai.models import EventQuery

    if query is None:
        return {}
    if not isinstance(query, EventQuery):
        return {}

    params: dict[str, Any] = {}
    if query.session_id is not None:
        params["sessionId"] = query.session_id
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.event_type is not None:
        params["eventType"] = query.event_type
    if query.severity is not None:
        params["severity"] = query.severity
    if query.from_time is not None:
        params["from"] = query.from_time
    if query.to is not None:
        params["to"] = query.to
    if query.limit is not None:
        params["limit"] = query.limit
    if query.offset is not None:
        params["offset"] = query.offset
    if query.order is not None:
        params["order"] = query.order
    if query.search is not None:
        params["search"] = query.search
    return build_query_params(params)


def build_session_query_params(
    query: Any = None,
) -> dict[str, str]:
    """Build URL params from a SessionQuery model."""
    from agentlensai.models import SessionQuery

    if query is None:
        return {}
    if not isinstance(query, SessionQuery):
        return {}

    params: dict[str, Any] = {}
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.status is not None:
        params["status"] = query.status
    if query.from_time is not None:
        params["from"] = query.from_time
    if query.to is not None:
        params["to"] = query.to
    if query.limit is not None:
        params["limit"] = query.limit
    if query.offset is not None:
        params["offset"] = query.offset
    if query.tags is not None:
        params["tags"] = query.tags
    return build_query_params(params)


def build_llm_analytics_params(
    params: Any = None,
) -> dict[str, str]:
    """Build URL params from LlmAnalyticsParams."""
    from agentlensai.models import LlmAnalyticsParams

    if params is None:
        return {}
    if not isinstance(params, LlmAnalyticsParams):
        return {}

    p: dict[str, Any] = {}
    if params.from_time is not None:
        p["from"] = params.from_time
    if params.to_time is not None:
        p["to"] = params.to_time
    if params.agent_id is not None:
        p["agentId"] = params.agent_id
    if params.model is not None:
        p["model"] = params.model
    if params.provider is not None:
        p["provider"] = params.provider
    if params.granularity is not None:
        p["granularity"] = params.granularity
    return build_query_params(p)


def _build_message_data(
    messages: Any,
    redacted: bool,
) -> list[dict[str, Any]]:
    """Build serialized messages list for LLM call events."""
    messages_data: list[dict[str, Any]] = []
    for m in messages:
        msg: dict[str, Any] = {"role": m.role}
        msg["content"] = "[REDACTED]" if redacted else m.content
        if m.tool_call_id is not None:
            msg["toolCallId"] = m.tool_call_id
        if m.tool_calls is not None:
            msg["toolCalls"] = [tc.model_dump(by_alias=True) for tc in m.tool_calls]
        messages_data.append(msg)
    return messages_data


def build_recall_query_params(query: Any = None) -> dict[str, str]:
    """Build URL params from a RecallQuery model."""
    from agentlensai.models import RecallQuery

    if query is None:
        return {}
    if not isinstance(query, RecallQuery):
        return {}

    params: dict[str, Any] = {}
    params["query"] = query.query
    if query.scope is not None:
        params["scope"] = query.scope
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.from_time is not None:
        params["from"] = query.from_time
    if query.to is not None:
        params["to"] = query.to
    if query.limit is not None:
        params["limit"] = query.limit
    if query.min_score is not None:
        params["minScore"] = query.min_score
    return build_query_params(params)


def build_lesson_query_params(query: Any = None) -> dict[str, str]:
    """Build URL params from a LessonQuery model."""
    from agentlensai.models import LessonQuery

    if query is None:
        return {}
    if not isinstance(query, LessonQuery):
        return {}

    params: dict[str, Any] = {}
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.category is not None:
        params["category"] = query.category
    if query.importance is not None:
        params["importance"] = query.importance
    if query.search is not None:
        params["search"] = query.search
    if query.limit is not None:
        params["limit"] = query.limit
    if query.offset is not None:
        params["offset"] = query.offset
    if query.include_archived is not None:
        params["includeArchived"] = str(query.include_archived).lower()
    return build_query_params(params)


def build_reflect_query_params(query: Any = None) -> dict[str, str]:
    """Build URL params from a ReflectQuery model."""
    from agentlensai.models import ReflectQuery

    if query is None:
        return {}
    if not isinstance(query, ReflectQuery):
        return {}

    params: dict[str, Any] = {}
    params["analysis"] = query.analysis
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.from_time is not None:
        params["from"] = query.from_time
    if query.to is not None:
        params["to"] = query.to
    if query.limit is not None:
        params["limit"] = query.limit
    return build_query_params(params)


def build_context_query_params(query: Any = None) -> dict[str, str]:
    """Build URL params from a ContextQuery model."""
    from agentlensai.models import ContextQuery

    if query is None:
        return {}
    if not isinstance(query, ContextQuery):
        return {}

    params: dict[str, Any] = {}
    params["topic"] = query.topic
    if query.user_id is not None:
        params["userId"] = query.user_id
    if query.agent_id is not None:
        params["agentId"] = query.agent_id
    if query.limit is not None:
        params["limit"] = query.limit
    return build_query_params(params)


def build_llm_call_events(
    session_id: str,
    agent_id: str,
    params: Any,
    call_id: str,
    timestamp: str,
) -> list[dict[str, Any]]:
    """Build the two event payloads (llm_call + llm_response) for batch ingest."""
    redacted: bool = params.redact is True

    # Build messages (potentially redacted)
    messages_data = _build_message_data(params.messages, redacted)

    # llm_call payload
    call_payload: dict[str, Any] = {
        "callId": call_id,
        "provider": params.provider,
        "model": params.model,
        "messages": messages_data,
    }
    if params.system_prompt is not None:
        call_payload["systemPrompt"] = "[REDACTED]" if redacted else params.system_prompt
    if params.parameters is not None:
        call_payload["parameters"] = params.parameters
    if params.tools is not None:
        call_payload["tools"] = [t.model_dump(by_alias=True) for t in params.tools]
    if redacted:
        call_payload["redacted"] = True

    # llm_response payload
    resp_payload: dict[str, Any] = {
        "callId": call_id,
        "provider": params.provider,
        "model": params.model,
        "completion": "[REDACTED]" if redacted else params.completion,
        "finishReason": params.finish_reason,
        "usage": params.usage.model_dump(by_alias=True, exclude_none=True),
        "costUsd": params.cost_usd,
        "latencyMs": params.latency_ms,
    }
    if params.tool_calls is not None:
        resp_payload["toolCalls"] = [tc.model_dump(by_alias=True) for tc in params.tool_calls]
    if redacted:
        resp_payload["redacted"] = True

    return [
        {
            "sessionId": session_id,
            "agentId": agent_id,
            "eventType": "llm_call",
            "severity": "info",
            "payload": call_payload,
            "metadata": {},
            "timestamp": timestamp,
        },
        {
            "sessionId": session_id,
            "agentId": agent_id,
            "eventType": "llm_response",
            "severity": "info",
            "payload": resp_payload,
            "metadata": {},
            "timestamp": timestamp,
        },
    ]

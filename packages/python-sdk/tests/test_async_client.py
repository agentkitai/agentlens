"""Comprehensive tests for AsyncAgentLensClient."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensConnectionError,
    AgentLensError,
    AsyncAgentLensClient,
    AuthenticationError,
    EventQuery,
    EventQueryResult,
    LlmAnalyticsParams,
    LlmAnalyticsResult,
    LlmMessage,
    LogLlmCallParams,
    NotFoundError,
    Session,
    SessionQuery,
    SessionQueryResult,
    TimelineResult,
    TokenUsage,
    ToolCallDef,
    ToolDef,
    ValidationError,
)

BASE = "http://localhost:3400"

# ─── Fixtures / helpers ─────────────────────────────────────────────────────

SAMPLE_EVENT: dict[str, Any] = {
    "id": "evt-1",
    "timestamp": "2025-01-01T00:00:00Z",
    "sessionId": "sess-1",
    "agentId": "agent-1",
    "eventType": "tool_call",
    "severity": "info",
    "payload": {"tool": "search"},
    "metadata": {"foo": "bar"},
    "prevHash": None,
    "hash": "abc123",
}

SAMPLE_SESSION: dict[str, Any] = {
    "id": "sess-1",
    "agentId": "agent-1",
    "agentName": "TestAgent",
    "startedAt": "2025-01-01T00:00:00Z",
    "endedAt": None,
    "status": "active",
    "eventCount": 5,
    "toolCallCount": 2,
    "errorCount": 0,
    "totalCostUsd": 0.01,
    "llmCallCount": 1,
    "totalInputTokens": 100,
    "totalOutputTokens": 50,
    "tags": ["test"],
}

LLM_ANALYTICS_RESPONSE: dict[str, Any] = {
    "summary": {
        "totalCalls": 10,
        "totalCostUsd": 1.5,
        "totalInputTokens": 5000,
        "totalOutputTokens": 2000,
        "avgLatencyMs": 450.0,
        "avgCostPerCall": 0.15,
    },
    "byModel": [
        {
            "provider": "openai",
            "model": "gpt-4",
            "calls": 10,
            "costUsd": 1.5,
            "inputTokens": 5000,
            "outputTokens": 2000,
            "avgLatencyMs": 450.0,
        }
    ],
    "byTime": [
        {
            "bucket": "2025-01-01",
            "calls": 10,
            "costUsd": 1.5,
            "inputTokens": 5000,
            "outputTokens": 2000,
            "avgLatencyMs": 450.0,
        }
    ],
}


def _make_llm_params(**overrides: Any) -> LogLlmCallParams:
    """Create a minimal LogLlmCallParams for testing."""
    defaults: dict[str, Any] = {
        "provider": "openai",
        "model": "gpt-4",
        "messages": [LlmMessage(role="user", content="Hello")],
        "completion": "Hi there!",
        "finish_reason": "stop",
        "usage": TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15),
        "cost_usd": 0.001,
        "latency_ms": 200.0,
    }
    defaults.update(overrides)
    return LogLlmCallParams(**defaults)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Constructor tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_constructor_strips_trailing_slash():
    """Trailing slashes on the base URL are removed."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.0.0"})
    )
    async with AsyncAgentLensClient(f"{BASE}/", api_key="k") as client:
        assert client._base_url == BASE
        await client.health()


@respx.mock
async def test_constructor_sets_auth_header():
    """Authorization header is set when api_key is provided."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    async with AsyncAgentLensClient(BASE, api_key="als_test123") as client:
        await client.query_events()
    assert respx.calls[0].request.headers["authorization"] == "Bearer als_test123"


@respx.mock
async def test_constructor_no_auth_header_when_none():
    """No Authorization header when api_key is None."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    async with AsyncAgentLensClient(BASE, api_key=None) as client:
        await client.query_events()
    assert "authorization" not in respx.calls[0].request.headers


# ═══════════════════════════════════════════════════════════════════════════════
# 2. query_events tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_query_events_returns_typed_result():
    """query_events returns an EventQueryResult instance."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(
            200,
            json={"events": [SAMPLE_EVENT], "total": 1, "hasMore": False},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.query_events()
    assert isinstance(result, EventQueryResult)
    assert result.total == 1
    assert len(result.events) == 1
    assert result.events[0].id == "evt-1"


@respx.mock
async def test_query_events_sends_correct_params():
    """query_events passes query parameters through."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    query = EventQuery(session_id="sess-1", agent_id="ag-1", limit=10, offset=5, order="desc")
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.query_events(query)

    url = respx.calls[0].request.url
    assert url.params["sessionId"] == "sess-1"
    assert url.params["agentId"] == "ag-1"
    assert url.params["limit"] == "10"
    assert url.params["offset"] == "5"
    assert url.params["order"] == "desc"


@respx.mock
async def test_query_events_handles_array_event_type():
    """Array eventType is joined with commas."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    query = EventQuery(event_type=["tool_call", "llm_call"])
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.query_events(query)

    url = respx.calls[0].request.url
    assert url.params["eventType"] == "tool_call,llm_call"


@respx.mock
async def test_query_events_omits_none_params():
    """None parameters are not sent as query params."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    query = EventQuery(session_id="sess-1")  # everything else is None
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.query_events(query)

    url = respx.calls[0].request.url
    assert "agentId" not in dict(url.params)
    assert "limit" not in dict(url.params)
    assert "offset" not in dict(url.params)


@respx.mock
async def test_query_events_sends_authorization_header():
    """query_events sends Authorization header with API key."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    async with AsyncAgentLensClient(BASE, api_key="secret-key") as client:
        await client.query_events()
    assert respx.calls[0].request.headers["authorization"] == "Bearer secret-key"


@respx.mock
async def test_query_events_no_query():
    """query_events with no query sends no params."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.query_events()
    assert result.events == []
    # No query params besides what httpx adds
    assert len(dict(respx.calls[0].request.url.params)) == 0


@respx.mock
async def test_query_events_has_more_flag():
    """has_more flag is correctly parsed."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 100, "hasMore": True})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.query_events()
    assert result.has_more is True
    assert result.total == 100


@respx.mock
async def test_query_events_search_param():
    """EventQuery.search param is forwarded."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    query = EventQuery(search="error")
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.query_events(query)
    assert respx.calls[0].request.url.params["search"] == "error"


@respx.mock
async def test_query_events_from_to_params():
    """EventQuery from/to time params are forwarded."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    query = EventQuery(from_time="2025-01-01T00:00:00Z", to="2025-12-31T23:59:59Z")
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.query_events(query)
    url = respx.calls[0].request.url
    assert url.params["from"] == "2025-01-01T00:00:00Z"
    assert url.params["to"] == "2025-12-31T23:59:59Z"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. get_event tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_get_event_returns_typed_event():
    """get_event returns an AgentLensEvent."""
    respx.get(f"{BASE}/api/events/evt-1").mock(return_value=httpx.Response(200, json=SAMPLE_EVENT))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        event = await client.get_event("evt-1")
    assert event.id == "evt-1"
    assert event.session_id == "sess-1"
    assert event.event_type == "tool_call"


@respx.mock
async def test_get_event_404_raises_not_found():
    """get_event raises NotFoundError for 404."""
    respx.get(f"{BASE}/api/events/missing").mock(
        return_value=httpx.Response(404, json={"error": "Event not found"})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(NotFoundError):
            await client.get_event("missing")


# ═══════════════════════════════════════════════════════════════════════════════
# 4. get_sessions tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_get_sessions_returns_typed_result():
    """get_sessions returns SessionQueryResult."""
    respx.get(f"{BASE}/api/sessions").mock(
        return_value=httpx.Response(
            200,
            json={"sessions": [SAMPLE_SESSION], "total": 1, "hasMore": False},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_sessions()
    assert isinstance(result, SessionQueryResult)
    assert result.total == 1
    assert result.sessions[0].id == "sess-1"


@respx.mock
async def test_get_sessions_sends_filters():
    """get_sessions passes session query filters."""
    respx.get(f"{BASE}/api/sessions").mock(
        return_value=httpx.Response(
            200,
            json={"sessions": [], "total": 0, "hasMore": False},
        )
    )
    query = SessionQuery(agent_id="ag-1", status="active", limit=20, tags=["production"])
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.get_sessions(query)

    url = respx.calls[0].request.url
    assert url.params["agentId"] == "ag-1"
    assert url.params["status"] == "active"
    assert url.params["limit"] == "20"
    assert url.params["tags"] == "production"


@respx.mock
async def test_get_sessions_no_query():
    """get_sessions with no query sends no params."""
    respx.get(f"{BASE}/api/sessions").mock(
        return_value=httpx.Response(
            200,
            json={"sessions": [], "total": 0, "hasMore": False},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_sessions()
    assert result.sessions == []


# ═══════════════════════════════════════════════════════════════════════════════
# 5. get_session / get_session_timeline tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_get_session_returns_typed_session():
    """get_session returns a Session instance."""
    respx.get(f"{BASE}/api/sessions/sess-1").mock(
        return_value=httpx.Response(200, json=SAMPLE_SESSION)
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        session = await client.get_session("sess-1")
    assert isinstance(session, Session)
    assert session.id == "sess-1"
    assert session.agent_id == "agent-1"
    assert session.status == "active"


@respx.mock
async def test_get_session_404():
    """get_session raises NotFoundError for 404."""
    respx.get(f"{BASE}/api/sessions/nope").mock(
        return_value=httpx.Response(404, json={"error": "Session not found"})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(NotFoundError):
            await client.get_session("nope")


@respx.mock
async def test_get_session_timeline_returns_typed_result():
    """get_session_timeline returns TimelineResult."""
    respx.get(f"{BASE}/api/sessions/sess-1/timeline").mock(
        return_value=httpx.Response(
            200,
            json={"events": [SAMPLE_EVENT], "chainValid": True},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_session_timeline("sess-1")
    assert isinstance(result, TimelineResult)
    assert result.chain_valid is True
    assert len(result.events) == 1


@respx.mock
async def test_get_session_timeline_chain_invalid():
    """get_session_timeline correctly parses chainValid=false."""
    respx.get(f"{BASE}/api/sessions/sess-1/timeline").mock(
        return_value=httpx.Response(
            200,
            json={"events": [], "chainValid": False},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_session_timeline("sess-1")
    assert result.chain_valid is False


# ═══════════════════════════════════════════════════════════════════════════════
# 6. log_llm_call tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_log_llm_call_returns_call_id():
    """log_llm_call returns a LogLlmCallResult with a UUID call_id."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.log_llm_call("sess-1", "agent-1", _make_llm_params())
    assert result.call_id  # non-empty string
    # Validate UUID format (8-4-4-4-12)
    parts = result.call_id.split("-")
    assert len(parts) == 5


@respx.mock
async def test_log_llm_call_sends_two_events():
    """log_llm_call POSTs a batch of exactly 2 events."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", _make_llm_params())
    body = json.loads(respx.calls[0].request.content)
    assert len(body["events"]) == 2


@respx.mock
async def test_log_llm_call_events_share_call_id():
    """Both events in the batch share the same callId."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.log_llm_call("sess-1", "agent-1", _make_llm_params())
    body = json.loads(respx.calls[0].request.content)
    call_evt = body["events"][0]
    resp_evt = body["events"][1]
    assert call_evt["payload"]["callId"] == result.call_id
    assert resp_evt["payload"]["callId"] == result.call_id


@respx.mock
async def test_log_llm_call_event_types():
    """First event is llm_call, second is llm_response."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", _make_llm_params())
    body = json.loads(respx.calls[0].request.content)
    assert body["events"][0]["eventType"] == "llm_call"
    assert body["events"][1]["eventType"] == "llm_response"


@respx.mock
async def test_log_llm_call_request_details():
    """The llm_call event payload contains request details."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(
        system_prompt="You are helpful",
        parameters={"temperature": 0.7},
        tools=[ToolDef(name="search", description="Search the web")],
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    call_payload = body["events"][0]["payload"]
    assert call_payload["provider"] == "openai"
    assert call_payload["model"] == "gpt-4"
    assert call_payload["systemPrompt"] == "You are helpful"
    assert call_payload["parameters"]["temperature"] == 0.7
    assert call_payload["messages"][0]["role"] == "user"
    assert call_payload["messages"][0]["content"] == "Hello"
    assert len(call_payload["tools"]) == 1
    assert call_payload["tools"][0]["name"] == "search"


@respx.mock
async def test_log_llm_call_response_details():
    """The llm_response event payload contains response details."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(
        tool_calls=[ToolCallDef(id="tc-1", name="search", arguments={"q": "test"})],
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    resp_payload = body["events"][1]["payload"]
    assert resp_payload["completion"] == "Hi there!"
    assert resp_payload["finishReason"] == "stop"
    assert resp_payload["costUsd"] == 0.001
    assert resp_payload["latencyMs"] == 200.0
    assert resp_payload["usage"]["inputTokens"] == 10
    assert resp_payload["usage"]["outputTokens"] == 5
    assert resp_payload["usage"]["totalTokens"] == 15
    assert len(resp_payload["toolCalls"]) == 1
    assert resp_payload["toolCalls"][0]["name"] == "search"


@respx.mock
async def test_log_llm_call_null_completion():
    """Null completion is handled without error."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(completion=None)
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.log_llm_call("sess-1", "agent-1", params)
    assert result.call_id
    body = json.loads(respx.calls[0].request.content)
    assert body["events"][1]["payload"]["completion"] is None


@respx.mock
async def test_log_llm_call_session_agent_ids():
    """Session and agent IDs are set correctly on both events."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("my-sess", "my-agent", _make_llm_params())
    body = json.loads(respx.calls[0].request.content)
    for evt in body["events"]:
        assert evt["sessionId"] == "my-sess"
        assert evt["agentId"] == "my-agent"


@respx.mock
async def test_log_llm_call_redaction_strips_content():
    """With redact=True, message content is replaced with [REDACTED]."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(
        messages=[LlmMessage(role="user", content="Secret data")],
        system_prompt="Secret system prompt",
        completion="Secret response",
        redact=True,
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    call_payload = body["events"][0]["payload"]
    resp_payload = body["events"][1]["payload"]

    assert call_payload["messages"][0]["content"] == "[REDACTED]"
    assert call_payload["systemPrompt"] == "[REDACTED]"
    assert resp_payload["completion"] == "[REDACTED]"


@respx.mock
async def test_log_llm_call_redaction_preserves_metadata():
    """With redact=True, non-content metadata (provider, model, usage) is preserved."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(redact=True)
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    call_payload = body["events"][0]["payload"]
    resp_payload = body["events"][1]["payload"]

    # Metadata preserved
    assert call_payload["provider"] == "openai"
    assert call_payload["model"] == "gpt-4"
    assert resp_payload["usage"]["inputTokens"] == 10
    assert resp_payload["costUsd"] == 0.001
    assert resp_payload["latencyMs"] == 200.0


@respx.mock
async def test_log_llm_call_redaction_sets_flag():
    """With redact=True, both event payloads include redacted=true."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params(redact=True)
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    assert body["events"][0]["payload"]["redacted"] is True
    assert body["events"][1]["payload"]["redacted"] is True


@respx.mock
async def test_log_llm_call_no_redaction_by_default():
    """Without redact=True, content is sent in plaintext and no redacted flag is set."""
    respx.post(f"{BASE}/api/events").mock(return_value=httpx.Response(200, json={"ok": True}))
    params = _make_llm_params()
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.log_llm_call("sess-1", "agent-1", params)
    body = json.loads(respx.calls[0].request.content)
    call_payload = body["events"][0]["payload"]
    resp_payload = body["events"][1]["payload"]
    assert call_payload["messages"][0]["content"] == "Hello"
    assert resp_payload["completion"] == "Hi there!"
    assert "redacted" not in call_payload
    assert "redacted" not in resp_payload


# ═══════════════════════════════════════════════════════════════════════════════
# 7. get_llm_analytics tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_get_llm_analytics_returns_typed_result():
    """get_llm_analytics returns an LlmAnalyticsResult."""
    respx.get(f"{BASE}/api/analytics/llm").mock(
        return_value=httpx.Response(200, json=LLM_ANALYTICS_RESPONSE)
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.get_llm_analytics()
    assert isinstance(result, LlmAnalyticsResult)
    assert result.summary.total_calls == 10
    assert result.summary.total_cost_usd == 1.5
    assert len(result.by_model) == 1
    assert len(result.by_time) == 1


@respx.mock
async def test_get_llm_analytics_sends_params():
    """get_llm_analytics sends correct query parameters."""
    respx.get(f"{BASE}/api/analytics/llm").mock(
        return_value=httpx.Response(200, json=LLM_ANALYTICS_RESPONSE)
    )
    params = LlmAnalyticsParams(
        from_time="2025-01-01",
        to_time="2025-12-31",
        agent_id="ag-1",
        model="gpt-4",
        provider="openai",
        granularity="day",
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.get_llm_analytics(params)

    url = respx.calls[0].request.url
    assert url.params["from"] == "2025-01-01"
    assert url.params["to"] == "2025-12-31"
    assert url.params["agentId"] == "ag-1"
    assert url.params["model"] == "gpt-4"
    assert url.params["provider"] == "openai"
    assert url.params["granularity"] == "day"


@respx.mock
async def test_get_llm_analytics_no_params():
    """get_llm_analytics with no params sends no query params."""
    respx.get(f"{BASE}/api/analytics/llm").mock(
        return_value=httpx.Response(200, json=LLM_ANALYTICS_RESPONSE)
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        await client.get_llm_analytics()
    assert len(dict(respx.calls[0].request.url.params)) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 8. health tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_health_returns_typed_result():
    """health returns a HealthResult."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.2.3"})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        result = await client.health()
    assert result.status == "ok"
    assert result.version == "1.2.3"


@respx.mock
async def test_health_no_auth_header_without_key():
    """health without api_key sends no Authorization header."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.0.0"})
    )
    async with AsyncAgentLensClient(BASE, api_key=None) as client:
        await client.health()
    assert "authorization" not in respx.calls[0].request.headers


@respx.mock
async def test_health_skip_auth_flag():
    """health uses skip_auth=True internally (auth header stripped from headers_copy)."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.0.0"})
    )
    async with AsyncAgentLensClient(BASE, api_key="secret") as client:
        # Verify health still succeeds even with api_key configured
        result = await client.health()
    assert result.status == "ok"


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Error handling tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_error_401_raises_authentication_error():
    """401 response raises AuthenticationError."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(401, json={"error": "Unauthorized"})
    )
    async with AsyncAgentLensClient(BASE, api_key="bad") as client:
        with pytest.raises(AuthenticationError) as exc_info:
            await client.query_events()
    assert exc_info.value.status == 401
    assert exc_info.value.code == "AUTHENTICATION_ERROR"


@respx.mock
async def test_error_400_raises_validation_error():
    """400 response raises ValidationError."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(
            400,
            json={"error": "Invalid parameter", "details": {"field": "limit"}},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(ValidationError) as exc_info:
            await client.query_events()
    assert exc_info.value.status == 400
    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.details == {"field": "limit"}


@respx.mock
async def test_error_404_raises_not_found_error():
    """404 response raises NotFoundError."""
    respx.get(f"{BASE}/api/events/missing").mock(
        return_value=httpx.Response(404, json={"error": "Not found"})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(NotFoundError) as exc_info:
            await client.get_event("missing")
    assert exc_info.value.status == 404
    assert exc_info.value.code == "NOT_FOUND"


@respx.mock
async def test_error_500_raises_agentlens_error():
    """500 response raises AgentLensError."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(500, json={"error": "Internal server error"})
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(AgentLensError) as exc_info:
            await client.query_events()
    assert exc_info.value.status == 500


@respx.mock
async def test_connection_error_raises_connection_error():
    """Connection failure raises AgentLensConnectionError."""
    respx.get(f"{BASE}/api/health").mock(side_effect=httpx.ConnectError("ECONNREFUSED"))
    async with AsyncAgentLensClient(BASE) as client:
        with pytest.raises(AgentLensConnectionError) as exc_info:
            await client.health()
    assert "ECONNREFUSED" in str(exc_info.value)


@respx.mock
async def test_connection_error_on_post():
    """Connection failure on POST also raises AgentLensConnectionError."""
    respx.post(f"{BASE}/api/events").mock(side_effect=httpx.ConnectError("Connection refused"))
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(AgentLensConnectionError):
            await client.log_llm_call("sess-1", "agent-1", _make_llm_params())


@respx.mock
async def test_error_with_plain_text_body():
    """Non-JSON error body is used as message."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(503, text="Service Unavailable")
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        with pytest.raises(AgentLensError) as exc_info:
            await client.query_events()
    assert "Service Unavailable" in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════════════
# 10. Context manager tests
# ═══════════════════════════════════════════════════════════════════════════════


@respx.mock
async def test_async_context_manager():
    """Client works as an async context manager."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.0.0"})
    )
    async with AsyncAgentLensClient(BASE) as client:
        result = await client.health()
        assert result.status == "ok"


@respx.mock
async def test_async_context_manager_closes_client():
    """Client is closed after exiting async context manager."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "1.0.0"})
    )
    async with AsyncAgentLensClient(BASE) as client:
        await client.health()
    # After __aexit__, the underlying httpx client should be closed
    assert client._client.is_closed


@respx.mock
async def test_multiple_requests_same_client():
    """Multiple requests can be made with the same client instance."""
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [], "total": 0, "hasMore": False})
    )
    respx.get(f"{BASE}/api/sessions").mock(
        return_value=httpx.Response(
            200,
            json={"sessions": [], "total": 0, "hasMore": False},
        )
    )
    async with AsyncAgentLensClient(BASE, api_key="k") as client:
        events = await client.query_events()
        sessions = await client.get_sessions()
    assert events.total == 0
    assert sessions.total == 0
    assert len(respx.calls) == 2

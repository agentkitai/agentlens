"""Comprehensive tests for the synchronous AgentLensClient."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AgentLensConnectionError,
    AgentLensError,
    AuthenticationError,
    EventQuery,
    LlmAnalyticsParams,
    LlmMessage,
    LogLlmCallParams,
    NotFoundError,
    SessionQuery,
    TokenUsage,
    ValidationError,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"

# ─── Fixtures / Helpers ──────────────────────────────────────────────────────


def _make_event(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a minimal event dict for API responses."""
    event: dict[str, Any] = {
        "id": "evt_001",
        "timestamp": "2025-01-01T00:00:00Z",
        "sessionId": "sess_001",
        "agentId": "agent_001",
        "eventType": "custom",
        "severity": "info",
        "payload": {},
        "metadata": {},
        "prevHash": None,
        "hash": "abc123",
    }
    if overrides:
        event.update(overrides)
    return event


def _make_session(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a minimal session dict for API responses."""
    session: dict[str, Any] = {
        "id": "sess_001",
        "agentId": "agent_001",
        "agentName": "TestAgent",
        "startedAt": "2025-01-01T00:00:00Z",
        "endedAt": None,
        "status": "active",
        "eventCount": 5,
        "toolCallCount": 2,
        "errorCount": 0,
        "totalCostUsd": 0.05,
        "llmCallCount": 3,
        "totalInputTokens": 100,
        "totalOutputTokens": 50,
        "tags": ["test"],
    }
    if overrides:
        session.update(overrides)
    return session


def _make_llm_params(
    redact: bool | None = None,
    completion: str | None = "Hello world",
    system_prompt: str | None = None,
) -> LogLlmCallParams:
    """Build a minimal LogLlmCallParams for testing."""
    return LogLlmCallParams(
        provider="openai",
        model="gpt-4",
        messages=[
            LlmMessage(role="user", content="Say hello"),
        ],
        system_prompt=system_prompt,
        completion=completion,
        finish_reason="stop",
        usage=TokenUsage(
            input_tokens=10,
            output_tokens=5,
            total_tokens=15,
        ),
        cost_usd=0.001,
        latency_ms=200.0,
        redact=redact,
    )


def _analytics_response() -> dict[str, Any]:
    return {
        "summary": {
            "totalCalls": 10,
            "totalCostUsd": 0.5,
            "totalInputTokens": 1000,
            "totalOutputTokens": 500,
            "avgLatencyMs": 150.0,
            "avgCostPerCall": 0.05,
        },
        "byModel": [
            {
                "provider": "openai",
                "model": "gpt-4",
                "calls": 10,
                "costUsd": 0.5,
                "inputTokens": 1000,
                "outputTokens": 500,
                "avgLatencyMs": 150.0,
            },
        ],
        "byTime": [
            {
                "bucket": "2025-01-01T00:00:00Z",
                "calls": 10,
                "costUsd": 0.5,
                "inputTokens": 1000,
                "outputTokens": 500,
                "avgLatencyMs": 150.0,
            },
        ],
    }


# ─── 1. Constructor Tests ────────────────────────────────────────────────────


class TestConstructor:
    def test_strips_trailing_slash(self) -> None:
        client = AgentLensClient("http://localhost:3400/", api_key=API_KEY)
        assert client._base_url == BASE_URL
        client.close()

    def test_strips_multiple_trailing_slashes(self) -> None:
        client = AgentLensClient("http://localhost:3400///")
        # rstrip("/") removes all trailing slashes
        assert client._base_url == "http://localhost:3400"
        client.close()

    @respx.mock
    def test_sets_auth_header_when_api_key_provided(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.query_events()
        assert respx.calls[0].request.headers["authorization"] == f"Bearer {API_KEY}"
        client.close()

    @respx.mock
    def test_no_auth_header_when_api_key_is_none(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            return_value=httpx.Response(
                200, json={"status": "ok", "version": "1.0.0"}
            )
        )
        client = AgentLensClient(BASE_URL)
        client.health()
        assert "authorization" not in respx.calls[0].request.headers
        client.close()


# ─── 2. query_events Tests ───────────────────────────────────────────────────


class TestQueryEvents:
    @respx.mock
    def test_returns_event_query_result(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200,
                json={
                    "events": [_make_event()],
                    "total": 1,
                    "hasMore": False,
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.query_events()
        assert result.total == 1
        assert len(result.events) == 1
        assert result.has_more is False
        assert result.events[0].id == "evt_001"
        client.close()

    @respx.mock
    def test_sends_correct_query_params(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(
            session_id="sess_001",
            event_type="tool_call",
            limit=10,
            order="desc",
        )
        client.query_events(query)
        url = respx.calls[0].request.url
        assert url.params["sessionId"] == "sess_001"
        assert url.params["eventType"] == "tool_call"
        assert url.params["limit"] == "10"
        assert url.params["order"] == "desc"
        client.close()

    @respx.mock
    def test_handles_array_event_type(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(event_type=["tool_call", "llm_call"])
        client.query_events(query)
        url = respx.calls[0].request.url
        assert url.params["eventType"] == "tool_call,llm_call"
        client.close()

    @respx.mock
    def test_handles_array_severity(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(severity=["warn", "error"])
        client.query_events(query)
        url = respx.calls[0].request.url
        assert url.params["severity"] == "warn,error"
        client.close()

    @respx.mock
    def test_omits_none_params(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(session_id="sess_001")
        client.query_events(query)
        url = respx.calls[0].request.url
        assert "eventType" not in dict(url.params)
        assert "limit" not in dict(url.params)
        assert "order" not in dict(url.params)
        client.close()

    @respx.mock
    def test_sends_authorization_header(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.query_events()
        assert respx.calls[0].request.headers["authorization"] == f"Bearer {API_KEY}"
        client.close()

    @respx.mock
    def test_no_query_sends_no_params(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.query_events()
        url = respx.calls[0].request.url
        # Should have no query params
        assert dict(url.params) == {} or all(
            k not in dict(url.params)
            for k in ("sessionId", "eventType", "limit", "order")
        )
        client.close()


# ─── 3. get_event Tests ──────────────────────────────────────────────────────


class TestGetEvent:
    @respx.mock
    def test_returns_single_event(self) -> None:
        respx.get(f"{BASE_URL}/api/events/evt_001").mock(
            return_value=httpx.Response(200, json=_make_event())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        event = client.get_event("evt_001")
        assert event.id == "evt_001"
        assert event.event_type == "custom"
        assert event.session_id == "sess_001"
        client.close()

    @respx.mock
    def test_throws_not_found_for_404(self) -> None:
        respx.get(f"{BASE_URL}/api/events/evt_missing").mock(
            return_value=httpx.Response(
                404, json={"error": "Event not found"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(NotFoundError):
            client.get_event("evt_missing")
        client.close()


# ─── 4. get_sessions Tests ───────────────────────────────────────────────────


class TestGetSessions:
    @respx.mock
    def test_returns_session_query_result(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "sessions": [_make_session()],
                    "total": 1,
                    "hasMore": False,
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_sessions()
        assert result.total == 1
        assert len(result.sessions) == 1
        assert result.sessions[0].id == "sess_001"
        client.close()

    @respx.mock
    def test_sends_status_and_agent_filters(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions").mock(
            return_value=httpx.Response(
                200,
                json={"sessions": [], "total": 0, "hasMore": False},
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = SessionQuery(status="active", agent_id="agent_001")
        client.get_sessions(query)
        url = respx.calls[0].request.url
        assert url.params["status"] == "active"
        assert url.params["agentId"] == "agent_001"
        client.close()

    @respx.mock
    def test_handles_array_status(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions").mock(
            return_value=httpx.Response(
                200,
                json={"sessions": [], "total": 0, "hasMore": False},
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = SessionQuery(status=["active", "completed"])
        client.get_sessions(query)
        url = respx.calls[0].request.url
        assert url.params["status"] == "active,completed"
        client.close()


# ─── 5. get_session Tests ────────────────────────────────────────────────────


class TestGetSession:
    @respx.mock
    def test_returns_single_session(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions/sess_001").mock(
            return_value=httpx.Response(200, json=_make_session())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        session = client.get_session("sess_001")
        assert session.id == "sess_001"
        assert session.agent_id == "agent_001"
        assert session.status == "active"
        client.close()


# ─── 6. get_session_timeline Tests ───────────────────────────────────────────


class TestGetSessionTimeline:
    @respx.mock
    def test_returns_timeline_result_with_chain_valid(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions/sess_001/timeline").mock(
            return_value=httpx.Response(
                200,
                json={
                    "events": [_make_event()],
                    "chainValid": True,
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_session_timeline("sess_001")
        assert result.chain_valid is True
        assert len(result.events) == 1
        client.close()

    @respx.mock
    def test_chain_invalid(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions/sess_001/timeline").mock(
            return_value=httpx.Response(
                200,
                json={
                    "events": [_make_event()],
                    "chainValid": False,
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_session_timeline("sess_001")
        assert result.chain_valid is False
        client.close()


# ─── 7. log_llm_call Tests ───────────────────────────────────────────────────


class TestLogLlmCall:
    @respx.mock
    def test_returns_call_id(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        # call_id should be a UUID string
        assert len(result.call_id) == 36
        assert result.call_id.count("-") == 4
        client.close()

    @respx.mock
    def test_sends_single_post_with_two_events(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        assert len(respx.calls) == 1
        body = json.loads(respx.calls[0].request.content)
        assert len(body["events"]) == 2
        client.close()

    @respx.mock
    def test_both_events_share_same_call_id(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        events = body["events"]
        assert events[0]["payload"]["callId"] == result.call_id
        assert events[1]["payload"]["callId"] == result.call_id
        client.close()

    @respx.mock
    def test_llm_call_event_contains_request_details(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        call_event = body["events"][0]
        assert call_event["eventType"] == "llm_call"
        payload = call_event["payload"]
        assert payload["provider"] == "openai"
        assert payload["model"] == "gpt-4"
        assert len(payload["messages"]) == 1
        assert payload["messages"][0]["role"] == "user"
        assert payload["messages"][0]["content"] == "Say hello"
        client.close()

    @respx.mock
    def test_llm_response_event_contains_response_details(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        resp_event = body["events"][1]
        assert resp_event["eventType"] == "llm_response"
        payload = resp_event["payload"]
        assert payload["completion"] == "Hello world"
        assert payload["usage"]["inputTokens"] == 10
        assert payload["usage"]["outputTokens"] == 5
        assert payload["costUsd"] == 0.001
        assert payload["latencyMs"] == 200.0
        assert payload["finishReason"] == "stop"
        client.close()

    @respx.mock
    def test_handles_null_completion(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(completion=None)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        resp_payload = body["events"][1]["payload"]
        assert resp_payload["completion"] is None
        client.close()

    @respx.mock
    def test_sends_authorization_header(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        assert respx.calls[0].request.headers["authorization"] == f"Bearer {API_KEY}"
        client.close()

    @respx.mock
    def test_includes_system_prompt_in_call_payload(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(system_prompt="You are a helpful assistant")
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        assert call_payload["systemPrompt"] == "You are a helpful assistant"
        client.close()

    # ─── Redaction Tests ──────────────────────────────────

    @respx.mock
    def test_redact_strips_message_content(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=True)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        for msg in call_payload["messages"]:
            assert msg["content"] == "[REDACTED]"
        client.close()

    @respx.mock
    def test_redact_strips_completion(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=True)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        resp_payload = body["events"][1]["payload"]
        assert resp_payload["completion"] == "[REDACTED]"
        client.close()

    @respx.mock
    def test_redact_strips_system_prompt(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=True, system_prompt="Secret instructions")
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        assert call_payload["systemPrompt"] == "[REDACTED]"
        client.close()

    @respx.mock
    def test_redact_sets_redacted_true_on_both_payloads(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=True)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["payload"]["redacted"] is True
        assert body["events"][1]["payload"]["redacted"] is True
        client.close()

    @respx.mock
    def test_redact_preserves_metadata(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=True)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        resp_payload = body["events"][1]["payload"]
        # Provider and model preserved on call event
        assert call_payload["model"] == "gpt-4"
        assert call_payload["provider"] == "openai"
        # Usage, cost preserved on response event
        assert resp_payload["usage"]["inputTokens"] == 10
        assert resp_payload["costUsd"] == 0.001
        assert resp_payload["model"] == "gpt-4"
        assert resp_payload["provider"] == "openai"
        client.close()

    @respx.mock
    def test_no_redacted_flag_when_redact_false(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=False)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        assert "redacted" not in body["events"][0]["payload"]
        assert "redacted" not in body["events"][1]["payload"]
        client.close()

    @respx.mock
    def test_no_redacted_flag_when_redact_none(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=None)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        assert "redacted" not in body["events"][0]["payload"]
        assert "redacted" not in body["events"][1]["payload"]
        client.close()

    @respx.mock
    def test_not_redacted_preserves_content(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = _make_llm_params(redact=False)
        client.log_llm_call("sess_001", "agent_001", params)
        body = json.loads(respx.calls[0].request.content)
        call_payload = body["events"][0]["payload"]
        resp_payload = body["events"][1]["payload"]
        assert call_payload["messages"][0]["content"] == "Say hello"
        assert resp_payload["completion"] == "Hello world"
        client.close()


# ─── 8. get_llm_analytics Tests ──────────────────────────────────────────────


class TestGetLlmAnalytics:
    @respx.mock
    def test_calls_get_analytics_llm(self) -> None:
        respx.get(f"{BASE_URL}/api/analytics/llm").mock(
            return_value=httpx.Response(200, json=_analytics_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.get_llm_analytics()
        assert respx.calls[0].request.url.path == "/api/analytics/llm"
        client.close()

    @respx.mock
    def test_passes_query_params(self) -> None:
        respx.get(f"{BASE_URL}/api/analytics/llm").mock(
            return_value=httpx.Response(200, json=_analytics_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = LlmAnalyticsParams(
            from_time="2025-01-01",
            to_time="2025-01-31",
            agent_id="agent_001",
            model="gpt-4",
            provider="openai",
            granularity="day",
        )
        client.get_llm_analytics(params)
        url = respx.calls[0].request.url
        assert url.params["from"] == "2025-01-01"
        assert url.params["to"] == "2025-01-31"
        assert url.params["agentId"] == "agent_001"
        assert url.params["model"] == "gpt-4"
        assert url.params["provider"] == "openai"
        assert url.params["granularity"] == "day"
        client.close()

    @respx.mock
    def test_omits_empty_params(self) -> None:
        respx.get(f"{BASE_URL}/api/analytics/llm").mock(
            return_value=httpx.Response(200, json=_analytics_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        params = LlmAnalyticsParams(model="gpt-4")
        client.get_llm_analytics(params)
        url = respx.calls[0].request.url
        assert url.params["model"] == "gpt-4"
        assert "from" not in dict(url.params)
        assert "agentId" not in dict(url.params)
        client.close()

    @respx.mock
    def test_returns_llm_analytics_result(self) -> None:
        respx.get(f"{BASE_URL}/api/analytics/llm").mock(
            return_value=httpx.Response(200, json=_analytics_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_llm_analytics()
        assert result.summary.total_calls == 10
        assert result.summary.total_cost_usd == 0.5
        assert len(result.by_model) == 1
        assert result.by_model[0].model == "gpt-4"
        assert len(result.by_time) == 1
        client.close()


# ─── 9. Health Tests ─────────────────────────────────────────────────────────


class TestHealth:
    @respx.mock
    def test_returns_health_result(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            return_value=httpx.Response(
                200, json={"status": "ok", "version": "1.0.0"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.health()
        assert result.status == "ok"
        assert result.version == "1.0.0"
        client.close()

    @respx.mock
    def test_does_not_send_authorization_header(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            return_value=httpx.Response(
                200, json={"status": "ok", "version": "1.0.0"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.health()
        assert "authorization" not in respx.calls[0].request.headers
        client.close()


# ─── 10. Error Handling Tests ─────────────────────────────────────────────────


class TestErrorHandling:
    @respx.mock
    def test_authentication_error_for_401(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                401, json={"error": "Invalid API key"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key="bad_key")
        with pytest.raises(AuthenticationError) as exc_info:
            client.query_events()
        assert exc_info.value.status == 401
        client.close()

    @respx.mock
    def test_validation_error_for_400(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                400,
                json={
                    "error": "Invalid query",
                    "details": [{"field": "limit", "message": "must be positive"}],
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(ValidationError) as exc_info:
            client.query_events()
        assert exc_info.value.status == 400
        assert exc_info.value.details is not None
        assert exc_info.value.details[0]["field"] == "limit"
        client.close()

    @respx.mock
    def test_not_found_error_for_404(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions/missing").mock(
            return_value=httpx.Response(
                404, json={"error": "Session not found"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(NotFoundError) as exc_info:
            client.get_session("missing")
        assert exc_info.value.status == 404
        client.close()

    @respx.mock
    def test_agent_lens_error_for_500(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                500, json={"error": "Internal server error"}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(AgentLensError) as exc_info:
            client.query_events()
        assert exc_info.value.status == 500
        client.close()

    @respx.mock
    def test_connection_error_when_connection_fails(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        client = AgentLensClient(BASE_URL)
        with pytest.raises(AgentLensConnectionError):
            client.health()
        client.close()

    @respx.mock
    def test_connection_error_has_cause(self) -> None:
        original = httpx.ConnectError("ECONNREFUSED")
        respx.get(f"{BASE_URL}/api/health").mock(side_effect=original)
        client = AgentLensClient(BASE_URL)
        with pytest.raises(AgentLensConnectionError) as exc_info:
            client.health()
        assert exc_info.value.__cause__ is original
        client.close()

    @respx.mock
    def test_error_with_plain_text_body(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(500, text="Bad Gateway")
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(AgentLensError) as exc_info:
            client.query_events()
        assert "Bad Gateway" in str(exc_info.value)
        client.close()


# ─── 11. Context Manager Tests ───────────────────────────────────────────────


class TestContextManager:
    @respx.mock
    def test_works_with_with_statement(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            return_value=httpx.Response(
                200, json={"status": "ok", "version": "1.0.0"}
            )
        )
        with AgentLensClient(BASE_URL) as client:
            result = client.health()
            assert result.status == "ok"

    @respx.mock
    def test_closes_client_on_exit(self) -> None:
        respx.get(f"{BASE_URL}/api/health").mock(
            return_value=httpx.Response(
                200, json={"status": "ok", "version": "1.0.0"}
            )
        )
        with AgentLensClient(BASE_URL) as client:
            client.health()
        # After exiting context, the underlying client should be closed
        assert client._client.is_closed

    def test_close_method_closes_client(self) -> None:
        client = AgentLensClient(BASE_URL)
        assert not client._client.is_closed
        client.close()
        assert client._client.is_closed


# ─── 12. Additional edge-case Tests ──────────────────────────────────────────


class TestEdgeCases:
    @respx.mock
    def test_event_query_with_search_param(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(search="error")
        client.query_events(query)
        url = respx.calls[0].request.url
        assert url.params["search"] == "error"
        client.close()

    @respx.mock
    def test_event_query_with_from_and_to(self) -> None:
        respx.get(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0, "hasMore": False}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = EventQuery(from_time="2025-01-01", to="2025-01-31")
        client.query_events(query)
        url = respx.calls[0].request.url
        assert url.params["from"] == "2025-01-01"
        assert url.params["to"] == "2025-01-31"
        client.close()

    @respx.mock
    def test_session_query_with_tags(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions").mock(
            return_value=httpx.Response(
                200,
                json={"sessions": [], "total": 0, "hasMore": False},
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        query = SessionQuery(tags=["prod", "v2"])
        client.get_sessions(query)
        url = respx.calls[0].request.url
        assert url.params["tags"] == "prod,v2"
        client.close()

    @respx.mock
    def test_session_has_more_true(self) -> None:
        respx.get(f"{BASE_URL}/api/sessions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "sessions": [_make_session()],
                    "total": 100,
                    "hasMore": True,
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_sessions()
        assert result.has_more is True
        assert result.total == 100
        client.close()

    @respx.mock
    def test_llm_call_event_has_correct_session_and_agent(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_xyz", "agent_xyz", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        for event in body["events"]:
            assert event["sessionId"] == "sess_xyz"
            assert event["agentId"] == "agent_xyz"
        client.close()

    @respx.mock
    def test_llm_call_events_have_timestamp(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        for event in body["events"]:
            assert "timestamp" in event
            assert len(event["timestamp"]) > 0
        client.close()

    @respx.mock
    def test_llm_call_events_have_info_severity(self) -> None:
        respx.post(f"{BASE_URL}/api/events").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.log_llm_call("sess_001", "agent_001", _make_llm_params())
        body = json.loads(respx.calls[0].request.content)
        for event in body["events"]:
            assert event["severity"] == "info"
        client.close()

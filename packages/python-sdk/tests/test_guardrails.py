"""Tests for guardrail SDK methods (Story 4.1)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from agentlensai import (
    AgentLensClient,
    AsyncAgentLensClient,
    GuardrailDeleteResult,
    GuardrailRule,
    GuardrailRuleListResult,
    GuardrailState,
    GuardrailStatusResult,
    GuardrailTrigger,
    GuardrailTriggerHistoryResult,
    NotFoundError,
)

BASE_URL = "http://localhost:3400"
API_KEY = "als_test123"


# ─── Fixtures ────────────────────────────────────────────────────────


def _rule_response(rule_id: str = "rule_001", **overrides: Any) -> dict:
    base: dict[str, Any] = {
        "id": rule_id,
        "tenantId": "default",
        "name": "High Error Rate",
        "description": "Pause agent on high errors",
        "enabled": True,
        "conditionType": "error_rate_threshold",
        "conditionConfig": {"threshold": 50, "windowMinutes": 15},
        "actionType": "pause_agent",
        "actionConfig": {"reason": "Error rate exceeded"},
        "agentId": "agent_001",
        "cooldownMinutes": 10,
        "dryRun": False,
        "createdAt": "2026-02-08T10:00:00Z",
        "updatedAt": "2026-02-08T10:00:00Z",
    }
    base.update(overrides)
    return base


def _state_response(rule_id: str = "rule_001") -> dict:
    return {
        "ruleId": rule_id,
        "tenantId": "default",
        "lastTriggeredAt": "2026-02-08T11:00:00Z",
        "triggerCount": 3,
        "lastEvaluatedAt": "2026-02-08T12:00:00Z",
        "currentValue": 55.0,
    }


def _trigger_response(rule_id: str = "rule_001") -> dict:
    return {
        "id": "trig_001",
        "ruleId": rule_id,
        "tenantId": "default",
        "triggeredAt": "2026-02-08T11:00:00Z",
        "conditionValue": 55.0,
        "conditionThreshold": 50.0,
        "actionExecuted": True,
        "actionResult": "Agent paused",
        "metadata": {"sessionId": "sess_001"},
    }


# ─── Sync Client Tests ──────────────────────────────────────────────


class TestListGuardrails:
    @respx.mock
    def test_list_returns_rules(self) -> None:
        """list_guardrails returns a list of rules."""
        respx.get(f"{BASE_URL}/api/guardrails").mock(
            return_value=httpx.Response(
                200, json={"rules": [_rule_response()]}
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.list_guardrails()
        assert isinstance(result, GuardrailRuleListResult)
        assert len(result.rules) == 1
        assert result.rules[0].name == "High Error Rate"
        client.close()

    @respx.mock
    def test_list_with_agent_filter(self) -> None:
        """list_guardrails passes agentId param."""
        respx.get(f"{BASE_URL}/api/guardrails").mock(
            return_value=httpx.Response(200, json={"rules": []})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        client.list_guardrails(agent_id="agent_001")
        url = respx.calls[0].request.url
        assert url.params["agentId"] == "agent_001"
        client.close()


class TestGetGuardrail:
    @respx.mock
    def test_get_returns_rule(self) -> None:
        """get_guardrail returns a single rule."""
        respx.get(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(200, json=_rule_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_guardrail("rule_001")
        assert isinstance(result, GuardrailRule)
        assert result.id == "rule_001"
        assert result.condition_type == "error_rate_threshold"
        assert result.action_type == "pause_agent"
        assert result.cooldown_minutes == 10
        client.close()

    @respx.mock
    def test_get_404_raises(self) -> None:
        """get_guardrail raises NotFoundError for unknown rule."""
        respx.get(f"{BASE_URL}/api/guardrails/unknown").mock(
            return_value=httpx.Response(404, json={"error": "Not found"})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        with pytest.raises(NotFoundError):
            client.get_guardrail("unknown")
        client.close()


class TestCreateGuardrail:
    @respx.mock
    def test_create_sends_body(self) -> None:
        """create_guardrail sends correct JSON body."""
        respx.post(f"{BASE_URL}/api/guardrails").mock(
            return_value=httpx.Response(201, json=_rule_response())
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.create_guardrail(
            name="High Error Rate",
            condition_type="error_rate_threshold",
            condition_config={"threshold": 50},
            action_type="pause_agent",
            action_config={"reason": "Error rate exceeded"},
            agent_id="agent_001",
            enabled=True,
            dry_run=False,
            cooldown_minutes=10,
        )
        assert isinstance(result, GuardrailRule)
        assert result.name == "High Error Rate"
        # Verify the POST body
        import json
        body = json.loads(respx.calls[0].request.content)
        assert body["name"] == "High Error Rate"
        assert body["conditionType"] == "error_rate_threshold"
        assert body["actionType"] == "pause_agent"
        assert body["enabled"] is True
        client.close()


class TestUpdateGuardrail:
    @respx.mock
    def test_update_sends_kwargs(self) -> None:
        """update_guardrail converts snake_case kwargs to camelCase."""
        respx.put(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(
                200, json=_rule_response(name="Updated Rule")
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.update_guardrail("rule_001", name="Updated Rule", dry_run=True)
        assert isinstance(result, GuardrailRule)
        import json
        body = json.loads(respx.calls[0].request.content)
        assert body["name"] == "Updated Rule"
        assert body["dryRun"] is True
        client.close()


class TestDeleteGuardrail:
    @respx.mock
    def test_delete_returns_ok(self) -> None:
        """delete_guardrail returns ok result."""
        respx.delete(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.delete_guardrail("rule_001")
        assert isinstance(result, GuardrailDeleteResult)
        assert result.ok is True
        client.close()


class TestEnableDisableGuardrail:
    @respx.mock
    def test_enable_sets_enabled_true(self) -> None:
        """enable_guardrail sends enabled=true update."""
        respx.put(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(
                200, json=_rule_response(enabled=True)
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.enable_guardrail("rule_001")
        assert result.enabled is True
        import json
        body = json.loads(respx.calls[0].request.content)
        assert body["enabled"] is True
        client.close()

    @respx.mock
    def test_disable_sets_enabled_false(self) -> None:
        """disable_guardrail sends enabled=false update."""
        respx.put(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(
                200, json=_rule_response(enabled=False)
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.disable_guardrail("rule_001")
        assert result.enabled is False
        client.close()


class TestGuardrailHistory:
    @respx.mock
    def test_history_returns_triggers(self) -> None:
        """get_guardrail_history returns trigger history."""
        respx.get(f"{BASE_URL}/api/guardrails/history").mock(
            return_value=httpx.Response(
                200,
                json={"triggers": [_trigger_response()], "total": 1},
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_guardrail_history(rule_id="rule_001", limit=10)
        assert isinstance(result, GuardrailTriggerHistoryResult)
        assert result.total == 1
        assert len(result.triggers) == 1
        trig = result.triggers[0]
        assert isinstance(trig, GuardrailTrigger)
        assert trig.action_executed is True
        url = respx.calls[0].request.url
        assert url.params["ruleId"] == "rule_001"
        assert url.params["limit"] == "10"
        client.close()


class TestGuardrailStatus:
    @respx.mock
    def test_status_returns_rule_and_state(self) -> None:
        """get_guardrail_status returns rule, state, and recent triggers."""
        respx.get(f"{BASE_URL}/api/guardrails/rule_001/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rule": _rule_response(),
                    "state": _state_response(),
                    "recentTriggers": [_trigger_response()],
                },
            )
        )
        client = AgentLensClient(BASE_URL, api_key=API_KEY)
        result = client.get_guardrail_status("rule_001")
        assert isinstance(result, GuardrailStatusResult)
        assert result.rule.id == "rule_001"
        assert isinstance(result.state, GuardrailState)
        assert result.state.trigger_count == 3
        assert len(result.recent_triggers) == 1
        client.close()


# ─── Async Client Tests ─────────────────────────────────────────────


class TestAsyncListGuardrails:
    @respx.mock
    @pytest.mark.anyio
    async def test_async_list(self) -> None:
        """Async list_guardrails returns rules."""
        respx.get(f"{BASE_URL}/api/guardrails").mock(
            return_value=httpx.Response(
                200, json={"rules": [_rule_response()]}
            )
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.list_guardrails()
        assert len(result.rules) == 1


class TestAsyncCreateGuardrail:
    @respx.mock
    @pytest.mark.anyio
    async def test_async_create(self) -> None:
        """Async create_guardrail works."""
        respx.post(f"{BASE_URL}/api/guardrails").mock(
            return_value=httpx.Response(201, json=_rule_response())
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.create_guardrail(
                name="Test Rule",
                condition_type="error_rate_threshold",
                condition_config={"threshold": 50},
                action_type="pause_agent",
                action_config={},
            )
        assert isinstance(result, GuardrailRule)


class TestAsyncEnableGuardrail:
    @respx.mock
    @pytest.mark.anyio
    async def test_async_enable(self) -> None:
        """Async enable_guardrail sends correct update."""
        respx.put(f"{BASE_URL}/api/guardrails/rule_001").mock(
            return_value=httpx.Response(200, json=_rule_response(enabled=True))
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.enable_guardrail("rule_001")
        assert result.enabled is True


class TestAsyncGuardrailHistory:
    @respx.mock
    @pytest.mark.anyio
    async def test_async_history(self) -> None:
        """Async get_guardrail_history returns triggers."""
        respx.get(f"{BASE_URL}/api/guardrails/history").mock(
            return_value=httpx.Response(
                200, json={"triggers": [_trigger_response()], "total": 1}
            )
        )
        async with AsyncAgentLensClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.get_guardrail_history(rule_id="rule_001")
        assert result.total == 1
        assert len(result.triggers) == 1

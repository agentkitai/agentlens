"""Tests for BaseFrameworkPlugin (v0.8.0 — Story 4.1)"""

from unittest.mock import MagicMock, patch
import pytest

from agentlensai.integrations.base import BaseFrameworkPlugin


class ConcretePlugin(BaseFrameworkPlugin):
    """Concrete plugin for testing the base class."""
    framework_name = "test_framework"


class TestBaseFrameworkPlugin:
    """Test the base plugin class."""

    def test_standalone_mode_returns_config(self):
        """Should return constructor config when client is provided."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        config = plugin._get_client_and_config()
        assert config is not None
        assert config[0] is client
        assert config[1] == "agent-1"
        assert config[2] == "ses-1"
        assert config[3] is False  # redact

    def test_standalone_mode_default_agent_id(self):
        """Should use 'default' when no agent_id provided."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client)
        config = plugin._get_client_and_config()
        assert config[1] == "default"

    def test_no_client_no_state_returns_none(self):
        """Should return None when no client and no global state."""
        plugin = ConcretePlugin()
        with patch("agentlensai.integrations.base.BaseFrameworkPlugin._get_client_and_config", return_value=None):
            # Direct test: no client, mock state to None
            plugin._client = None
        config = plugin._get_client_and_config()
        assert config is None

    def test_send_event_never_raises(self):
        """_send_event should catch all exceptions."""
        client = MagicMock()
        client._request.side_effect = Exception("Network error")
        plugin = ConcretePlugin(client=client)
        # Should not raise
        plugin._send_event(client, {"sessionId": "s1", "agentId": "a1"})

    def test_send_custom_event_sends_correctly(self):
        """_send_custom_event should build and send a custom event."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        plugin._send_custom_event("test_type", {"key": "value"})

        client._request.assert_called_once()
        args = client._request.call_args
        event = args[1]["json"]["events"][0]
        assert event["eventType"] == "custom"
        assert event["payload"]["type"] == "test_type"
        assert event["payload"]["data"]["key"] == "value"
        assert event["metadata"]["source"] == "test_framework"

    def test_send_tool_call_sends_correctly(self):
        """_send_tool_call should build and send a tool_call event."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        plugin._send_tool_call("my_tool", "call-1", {"arg": "val"})

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_call"
        assert event["payload"]["toolName"] == "my_tool"
        assert event["payload"]["callId"] == "call-1"

    def test_send_tool_response_sends_correctly(self):
        """_send_tool_response should build a tool_response event."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        plugin._send_tool_response("my_tool", "call-1", "result data", 150.5)

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_response"
        assert event["payload"]["durationMs"] == 150.5

    def test_send_tool_error_sends_correctly(self):
        """_send_tool_error should build a tool_error event."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        plugin._send_tool_error("my_tool", "call-1", "Something broke", 200.0)

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_error"
        assert event["severity"] == "error"

    def test_now_returns_iso_timestamp(self):
        """_now should return a valid ISO 8601 timestamp."""
        ts = BaseFrameworkPlugin._now()
        assert "T" in ts
        assert "+" in ts or "Z" in ts or ts.endswith("+00:00")

    def test_send_custom_event_no_client_no_error(self):
        """_send_custom_event should silently do nothing when no client."""
        plugin = ConcretePlugin()
        # Should not raise
        plugin._send_custom_event("test_type", {"key": "value"})

    def test_tool_response_truncates_long_result(self):
        """_send_tool_response should truncate result to 1000 chars."""
        client = MagicMock()
        plugin = ConcretePlugin(client=client, agent_id="agent-1", session_id="ses-1")
        long_result = "x" * 5000
        plugin._send_tool_response("my_tool", "call-1", long_result, 100.0)

        event = client._request.call_args[1]["json"]["events"][0]
        assert len(event["payload"]["result"]) <= 1000

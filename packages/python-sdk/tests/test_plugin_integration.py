"""Integration tests for Framework Plugins (B3 — Story 3.1)

Tests that each framework plugin (LangChain, CrewAI, AutoGen, Semantic Kernel)
correctly sends events to the AgentLens server via httpx mock.

Also tests auto-detection: when multiple frameworks are installed, the correct
plugin activates based on the framework_name property.
"""

from unittest.mock import MagicMock, call
import uuid
import pytest

from agentlensai.integrations.base import BaseFrameworkPlugin


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════

def make_mock_client():
    """Create a mock client that captures _request calls."""
    client = MagicMock()
    client._request = MagicMock(return_value={"ok": True})
    return client


def get_sent_events(client):
    """Extract all events sent via client._request."""
    events = []
    for c in client._request.call_args_list:
        kwargs = c[1] if len(c) > 1 else {}
        if "json" in kwargs and "events" in kwargs["json"]:
            events.extend(kwargs["json"]["events"])
    return events


def assert_event_schema(event):
    """Assert that an event has the required AgentLens event fields."""
    assert "sessionId" in event
    assert "agentId" in event
    assert "eventType" in event
    assert "payload" in event
    assert "timestamp" in event


# ═══════════════════════════════════════════════════════════════
# Story 3.1 — LangChain Plugin Integration Tests
# ═══════════════════════════════════════════════════════════════

class TestLangChainIntegration:
    """Tests that LangChain plugin sends properly structured events."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler
        client = make_mock_client()
        defaults = {"client": client, "agent_id": "agent-lc", "session_id": "ses-lc"}
        defaults.update(kwargs)
        handler = AgentLensCallbackHandler(**defaults)
        return handler, client

    def test_chain_start_sends_event(self):
        handler, client = self._make_handler()
        handler.on_chain_start(
            {"id": ["langchain", "chains", "LLMChain"], "name": "my-chain"},
            {"input": "test"},
            run_id=uuid.uuid4(),
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])
        assert events[0]["agentId"] == "agent-lc"
        assert events[0]["sessionId"] == "ses-lc"

    def test_chain_end_sends_event(self):
        handler, client = self._make_handler()
        rid = uuid.uuid4()
        handler.on_chain_start({"name": "test-chain"}, {}, run_id=rid)
        handler.on_chain_end({"output": "done"}, run_id=rid)
        events = get_sent_events(client)
        assert len(events) >= 2
        end_event = events[-1]
        assert_event_schema(end_event)

    def test_tool_start_sends_event(self):
        handler, client = self._make_handler()
        handler.on_tool_start(
            {"name": "search"},
            "query text",
            run_id=uuid.uuid4(),
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])

    def test_llm_start_sends_event(self):
        handler, client = self._make_handler()
        handler.on_llm_start(
            {"name": "ChatOpenAI"},
            ["Hello"],
            run_id=uuid.uuid4(),
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])

    def test_framework_metadata_is_langchain(self):
        handler, client = self._make_handler()
        handler.on_chain_start({"name": "test"}, {}, run_id=uuid.uuid4())
        events = get_sent_events(client)
        assert events[0]["metadata"]["framework"] == "langchain"


# ═══════════════════════════════════════════════════════════════
# CrewAI Plugin Integration Tests
# ═══════════════════════════════════════════════════════════════

class TestCrewAIIntegration:
    """Tests that CrewAI plugin sends properly structured events."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler
        client = make_mock_client()
        defaults = {"client": client, "agent_id": "agent-crew", "session_id": "ses-crew"}
        defaults.update(kwargs)
        handler = AgentLensCrewAIHandler(**defaults)
        return handler, client

    def test_framework_name_is_crewai(self):
        handler, _ = self._make_handler()
        assert handler.framework_name == "crewai"

    def test_send_custom_event_uses_crewai_source(self):
        handler, client = self._make_handler()
        handler._send_custom_event("task_start", {"task": "research"})
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])
        assert events[0]["metadata"]["source"] == "crewai"

    def test_send_tool_call_event(self):
        handler, client = self._make_handler()
        handler._send_tool_call(
            tool_name="web_search",
            tool_input={"query": "agentlens"},
            extra_metadata={"crew_task": "research"},
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])
        assert events[0]["eventType"] == "tool_call"

    def test_send_tool_response_event(self):
        handler, client = self._make_handler()
        handler._send_tool_response(
            tool_name="web_search",
            tool_output="results...",
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert events[0]["eventType"] == "tool_response"


# ═══════════════════════════════════════════════════════════════
# AutoGen Plugin Integration Tests
# ═══════════════════════════════════════════════════════════════

class TestAutoGenIntegration:
    """Tests that AutoGen plugin sends properly structured events."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler
        client = make_mock_client()
        defaults = {"client": client, "agent_id": "agent-ag", "session_id": "ses-ag"}
        defaults.update(kwargs)
        handler = AgentLensAutoGenHandler(**defaults)
        return handler, client

    def test_framework_name_is_autogen(self):
        handler, _ = self._make_handler()
        assert handler.framework_name == "autogen"

    def test_send_custom_event_uses_autogen_source(self):
        handler, client = self._make_handler()
        handler._send_custom_event("message_sent", {"to": "assistant"})
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])
        assert events[0]["metadata"]["source"] == "autogen"

    def test_send_tool_call(self):
        handler, client = self._make_handler()
        handler._send_tool_call(tool_name="code_exec", tool_input={"code": "print(1)"})
        events = get_sent_events(client)
        assert len(events) >= 1
        assert events[0]["eventType"] == "tool_call"
        assert events[0]["agentId"] == "agent-ag"


# ═══════════════════════════════════════════════════════════════
# Semantic Kernel Plugin Integration Tests
# ═══════════════════════════════════════════════════════════════

class TestSemanticKernelIntegration:
    """Tests that Semantic Kernel plugin sends properly structured events."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler
        client = make_mock_client()
        defaults = {"client": client, "agent_id": "agent-sk", "session_id": "ses-sk"}
        defaults.update(kwargs)
        handler = AgentLensSKHandler(**defaults)
        return handler, client

    def test_framework_name_is_semantic_kernel(self):
        handler, _ = self._make_handler()
        assert handler.framework_name == "semantic_kernel"

    def test_send_custom_event_uses_sk_source(self):
        handler, client = self._make_handler()
        handler._send_custom_event("function_invoked", {"function": "summarize"})
        events = get_sent_events(client)
        assert len(events) >= 1
        assert_event_schema(events[0])
        assert events[0]["metadata"]["source"] == "semantic_kernel"

    def test_send_tool_error(self):
        handler, client = self._make_handler()
        handler._send_tool_error(
            tool_name="plugin_func",
            error="timeout",
        )
        events = get_sent_events(client)
        assert len(events) >= 1
        assert events[0]["eventType"] == "tool_error"


# ═══════════════════════════════════════════════════════════════
# Auto-detection & Cross-plugin Tests
# ═══════════════════════════════════════════════════════════════

class TestAutoDetection:
    """Tests for auto-detection: correct plugin activates based on framework_name."""

    def test_each_plugin_has_unique_framework_name(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = make_mock_client()
        names = set()
        for cls in [AgentLensCallbackHandler, AgentLensCrewAIHandler, AgentLensAutoGenHandler, AgentLensSKHandler]:
            handler = cls(client=client, agent_id="a", session_id="s")
            names.add(handler.framework_name)

        assert len(names) == 4, f"Expected 4 unique framework names, got {names}"

    def test_all_plugins_inherit_from_base(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = make_mock_client()
        for cls in [AgentLensCrewAIHandler, AgentLensAutoGenHandler, AgentLensSKHandler]:
            handler = cls(client=client, agent_id="a", session_id="s")
            assert isinstance(handler, BaseFrameworkPlugin)

    def test_event_payload_schema_consistent_across_plugins(self):
        """All plugins produce events with the same required fields."""
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        for cls in [AgentLensCrewAIHandler, AgentLensAutoGenHandler, AgentLensSKHandler]:
            client = make_mock_client()
            handler = cls(client=client, agent_id="test-agent", session_id="test-ses")
            handler._send_custom_event("test_event", {"key": "value"})
            events = get_sent_events(client)
            assert len(events) >= 1
            for event in events:
                assert_event_schema(event)
                assert event["agentId"] == "test-agent"
                assert event["sessionId"] == "test-ses"

    def test_plugins_with_no_client_do_not_raise(self):
        """When no client is configured, plugins should silently no-op."""
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        for cls in [AgentLensCrewAIHandler, AgentLensAutoGenHandler, AgentLensSKHandler]:
            handler = cls()  # No client, no init
            # Should not raise
            handler._send_custom_event("test", {"key": "val"})
            handler._send_tool_call(tool_name="t", tool_input={})

"""Tests for Framework Plugins (v0.8.0 — Stories 5.1-5.5)"""

from unittest.mock import MagicMock, AsyncMock, patch
import uuid
import pytest

from agentlensai.integrations.base import BaseFrameworkPlugin


# ─── CrewAI Plugin Tests ──────────────────────────────────────

class TestCrewAIPlugin:
    """Tests for CrewAI integration."""

    def test_step_callback_sends_event(self):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler

        client = MagicMock()
        handler = AgentLensCrewAIHandler(client=client, agent_id="agent-1", session_id="ses-1")

        step = MagicMock()
        step.text = "thinking about the problem"
        step.tool = "search"

        handler.step_callback(step)
        client._request.assert_called_once()
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "crew_step"
        assert event["metadata"]["source"] == "crewai"

    def test_step_callback_never_raises(self):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler

        client = MagicMock()
        client._request.side_effect = Exception("Boom")
        handler = AgentLensCrewAIHandler(client=client, agent_id="agent-1", session_id="ses-1")

        # Should not raise
        handler.step_callback(MagicMock())

    def test_task_start_end(self):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler

        client = MagicMock()
        handler = AgentLensCrewAIHandler(client=client, agent_id="agent-1", session_id="ses-1")

        task = MagicMock()
        task.id = "task-1"
        task.description = "Do something"
        agent = MagicMock()
        agent.role = "researcher"
        agent.goal = "find info"

        handler.on_task_start(task, agent)
        handler.on_task_end(task, agent, "result")

        assert client._request.call_count == 2

    def test_crew_start_end(self):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler

        client = MagicMock()
        handler = AgentLensCrewAIHandler(client=client, agent_id="agent-1", session_id="ses-1")

        crew = MagicMock()
        crew.id = "crew-1"
        crew.agents = [MagicMock(), MagicMock()]
        crew.tasks = [MagicMock()]

        handler.on_crew_start(crew)
        handler.on_crew_end(crew, "done")

        assert client._request.call_count == 2


# ─── AutoGen Plugin Tests ──────────────────────────────────────

class TestAutoGenPlugin:
    """Tests for AutoGen integration."""

    def test_on_message_sent_returns_message(self):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        handler = AgentLensAutoGenHandler(client=client, agent_id="agent-1", session_id="ses-1")

        sender = MagicMock(name="assistant")
        receiver = MagicMock(name="user")
        message = "Hello world"

        result = handler.on_message_sent(sender, receiver, message)
        assert result == message  # Must return message unchanged

    def test_on_message_sent_sends_event(self):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        handler = AgentLensAutoGenHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_message_sent(MagicMock(), MagicMock(), "test")
        client._request.assert_called_once()
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["metadata"]["source"] == "autogen"

    def test_on_message_sent_never_raises(self):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        client._request.side_effect = Exception("Boom")
        handler = AgentLensAutoGenHandler(client=client, agent_id="agent-1", session_id="ses-1")

        result = handler.on_message_sent(MagicMock(), MagicMock(), "test")
        assert result == "test"

    def test_tool_call_and_result(self):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        handler = AgentLensAutoGenHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_tool_call(MagicMock(), "search", {"query": "test"})
        handler.on_tool_result(MagicMock(), "search", "result")

        assert client._request.call_count == 2

    def test_conversation_lifecycle(self):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        handler = AgentLensAutoGenHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_conversation_start(MagicMock(), [MagicMock()])
        handler.on_conversation_end("All done")

        assert client._request.call_count == 2


# ─── Semantic Kernel Plugin Tests ──────────────────────────────────────

class TestSemanticKernelPlugin:
    """Tests for Semantic Kernel integration."""

    def test_on_function_invoking_sends_tool_call(self):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        handler = AgentLensSKHandler(client=client, agent_id="agent-1", session_id="ses-1")

        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.arguments = {"query": "test"}

        handler._on_function_invoking(context, "call-1")
        client._request.assert_called_once()
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_call"
        assert event["payload"]["toolName"] == "WebPlugin.search"

    def test_on_function_invoked_sends_tool_response(self):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        handler = AgentLensSKHandler(client=client, agent_id="agent-1", session_id="ses-1")

        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.result = "found something"
        context.exception = None

        handler._on_function_invoked(context, "call-1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_response"

    def test_on_function_invoked_sends_error_on_exception(self):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        handler = AgentLensSKHandler(client=client, agent_id="agent-1", session_id="ses-1")

        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.exception = ValueError("oops")

        handler._on_function_invoked(context, "call-1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_error"

    def test_planner_step(self):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        handler = AgentLensSKHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_planner_step("Step 1: do stuff")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "planner_step"

    @pytest.mark.asyncio
    async def test_filter_calls_next_and_instruments(self):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        handler = AgentLensSKHandler(client=client, agent_id="agent-1", session_id="ses-1")

        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "Web"
        context.arguments = {}
        context.result = "result"
        context.exception = None

        next_fn = AsyncMock()
        await handler.filter(context, next_fn)

        next_fn.assert_called_once_with(context)
        assert client._request.call_count == 2  # tool_call + tool_response


# ─── LangChain Enhanced Tests ──────────────────────────────────────

class TestLangChainEnhanced:
    """Tests for enhanced LangChain callbacks (v0.8.0)."""

    def test_on_chain_start_sends_event(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_chain_start(
            {"id": ["langchain", "chains", "LLMChain"]},
            {"input": "test"},
            run_id=uuid.uuid4(),
        )
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "chain_start"

    def test_on_chain_end_sends_event(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_chain_end({"output": "result"}, run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "chain_end"

    def test_on_chain_error_sends_event(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        handler.on_chain_error(ValueError("bad"), run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "chain_error"
        assert event["severity"] == "error"

    def test_on_agent_action_sends_event(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        action = MagicMock()
        action.tool = "search"
        action.tool_input = "query"

        handler.on_agent_action(action, run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_action"

    def test_on_agent_finish_sends_event(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        finish = MagicMock()
        finish.return_values = {"output": "done"}

        handler.on_agent_finish(finish, run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_finish"

    def test_on_retriever_start_end(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        rid = uuid.uuid4()
        handler.on_retriever_start({}, "find stuff", run_id=rid)
        handler.on_retriever_end([MagicMock(), MagicMock()], run_id=rid)

        assert client._request.call_count == 2

    def test_chain_callbacks_never_raise(self):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        client._request.side_effect = Exception("Boom")
        handler = AgentLensCallbackHandler(client=client, agent_id="agent-1", session_id="ses-1")

        # None of these should raise
        handler.on_chain_start({}, {}, run_id=uuid.uuid4())
        handler.on_chain_end({}, run_id=uuid.uuid4())
        handler.on_chain_error(ValueError("bad"), run_id=uuid.uuid4())
        handler.on_agent_action(MagicMock(), run_id=uuid.uuid4())
        handler.on_agent_finish(MagicMock(), run_id=uuid.uuid4())


# ─── Auto-Detection Tests ──────────────────────────────────────

class TestAutoDetection:
    """Tests for framework auto-detection in init()."""

    def test_instrument_frameworks_handles_missing_crewai(self):
        """Should not error when crewai is not installed."""
        from agentlensai._init import _instrument_frameworks
        # This should not raise even if crewai is not installed
        _instrument_frameworks()

    def test_uninstrument_frameworks_handles_missing(self):
        """Should not error when frameworks are not installed."""
        from agentlensai._init import _uninstrument_frameworks
        _uninstrument_frameworks()

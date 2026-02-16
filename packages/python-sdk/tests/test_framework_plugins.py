"""Tests for Framework Plugins (v0.8.0 — Stories 3.1-3.4)

Story 3.1 — Enhanced LangChain Plugin (10 tests)
Story 3.2 — CrewAI Plugin (10 tests)
Story 3.3 — AutoGen Plugin (8 tests)
Story 3.4 — Semantic Kernel Plugin (8 tests)
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

# ═══════════════════════════════════════════════════════════════
# Story 3.1 — Enhanced LangChain Plugin (10 tests)
# ═══════════════════════════════════════════════════════════════


class TestLangChainEnhanced:
    """Tests for enhanced LangChain callbacks (v0.8.0)."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.langchain import AgentLensCallbackHandler

        client = MagicMock()
        defaults = {"client": client, "agent_id": "agent-1", "session_id": "ses-1"}
        defaults.update(kwargs)
        handler = AgentLensCallbackHandler(**defaults)
        return handler, client

    # 1. chain_start
    def test_on_chain_start_sends_event_with_chain_name(self):
        handler, client = self._make_handler()
        handler.on_chain_start(
            {"id": ["langchain", "chains", "LLMChain"], "name": "my-chain"},
            {"input": "test"},
            run_id=uuid.uuid4(),
        )
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "chain_start"
        assert event["payload"]["data"]["chain_name"] == "my-chain"
        assert event["metadata"]["framework"] == "langchain"
        assert event["metadata"]["framework_component"] == "chain"

    # 2. chain_end
    def test_on_chain_end_sends_event_with_duration(self):
        handler, client = self._make_handler()
        rid = uuid.uuid4()
        handler.on_chain_start({"name": "test-chain"}, {}, run_id=rid)
        handler.on_chain_end({"output": "result"}, run_id=rid)
        events = [call[1]["json"]["events"][0] for call in client._request.call_args_list]
        end_event = events[1]
        assert end_event["payload"]["type"] == "chain_end"
        assert end_event["payload"]["data"]["duration_ms"] >= 0
        assert end_event["payload"]["data"]["chain_name"] == "test-chain"

    # 3. chain_error
    def test_on_chain_error_sends_event_with_severity(self):
        handler, client = self._make_handler()
        handler.on_chain_error(ValueError("bad input"), run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "chain_error"
        assert event["severity"] == "error"
        assert "bad input" in event["payload"]["data"]["error"]
        assert event["payload"]["data"]["error_type"] == "ValueError"

    # 4. agent_action
    def test_on_agent_action_sends_tool_and_reasoning(self):
        handler, client = self._make_handler()
        action = MagicMock()
        action.tool = "search"
        action.tool_input = "query about AI"
        action.log = "I need to search for information about AI"

        handler.on_agent_action(action, run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_action"
        assert event["payload"]["data"]["tool"] == "search"
        assert event["payload"]["data"]["tool_input"] == "query about AI"
        assert "search for information" in event["payload"]["data"]["reasoning"]
        assert event["metadata"]["framework_component"] == "agent"

    # 5. agent_finish
    def test_on_agent_finish_sends_output_and_reasoning(self):
        handler, client = self._make_handler()
        finish = MagicMock()
        finish.return_values = {"output": "done with task"}
        finish.log = "The task is complete"

        handler.on_agent_finish(finish, run_id=uuid.uuid4())
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_finish"
        assert "done with task" in event["payload"]["data"]["output"]
        assert "task is complete" in event["payload"]["data"]["reasoning"]

    # 6. retriever_start + retriever_end
    def test_on_retriever_start_end_with_sources(self):
        handler, client = self._make_handler()
        rid = uuid.uuid4()
        handler.on_retriever_start({}, "find documents about AI", run_id=rid)

        # Mock documents with metadata sources
        doc1 = MagicMock()
        doc1.metadata = {"source": "wiki.txt"}
        doc2 = MagicMock()
        doc2.metadata = {"source": "paper.pdf"}

        handler.on_retriever_end([doc1, doc2], run_id=rid)

        assert client._request.call_count == 2
        start_event = client._request.call_args_list[0][1]["json"]["events"][0]
        end_event = client._request.call_args_list[1][1]["json"]["events"][0]

        assert start_event["payload"]["type"] == "retriever_start"
        assert start_event["payload"]["data"]["query"] == "find documents about AI"
        assert start_event["metadata"]["framework_component"] == "retriever"

        assert end_event["payload"]["type"] == "retriever_end"
        assert end_event["payload"]["data"]["document_count"] == 2
        assert "wiki.txt" in end_event["payload"]["data"]["sources"]
        assert "paper.pdf" in end_event["payload"]["data"]["sources"]

    # 7. LangGraph detection
    def test_langgraph_detection_sets_is_graph_node(self):
        handler, client = self._make_handler(agent_id=None)
        handler.on_chain_start(
            {"id": ["langchain", "langgraph", "PregelNode"], "name": "process_input"},
            {"input": "test"},
            run_id=uuid.uuid4(),
            tags=["graph:my-graph"],
        )
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["data"]["is_graph_node"] is True
        assert event["metadata"].get("graph_name") == "my-graph"

    # 8. fail-safety: on_chain_start with bad client
    def test_chain_callbacks_never_raise_on_send_error(self):
        handler, client = self._make_handler()
        client._request.side_effect = Exception("Network error")

        # None of these should raise
        handler.on_chain_start({}, {}, run_id=uuid.uuid4())
        handler.on_chain_end({}, run_id=uuid.uuid4())
        handler.on_chain_error(ValueError("bad"), run_id=uuid.uuid4())
        handler.on_agent_action(MagicMock(), run_id=uuid.uuid4())
        handler.on_agent_finish(MagicMock(), run_id=uuid.uuid4())
        handler.on_retriever_start({}, "q", run_id=uuid.uuid4())
        handler.on_retriever_end([], run_id=uuid.uuid4())

    # 9. fail-safety: bad serialized input
    def test_chain_callbacks_never_raise_on_bad_input(self):
        handler, client = self._make_handler()

        # Pass totally wrong types — should not crash
        handler.on_chain_start(None, None, run_id=uuid.uuid4())  # type: ignore
        handler.on_chain_end(42, run_id=uuid.uuid4())  # type: ignore
        handler.on_retriever_end("not-a-list", run_id=uuid.uuid4())  # type: ignore

    # 10. backward compat: existing on_tool_start/end still works
    def test_backward_compat_tool_start_end(self):
        handler, client = self._make_handler()
        rid = uuid.uuid4()
        handler.on_tool_start({"name": "calculator"}, "2+2", run_id=rid)
        handler.on_tool_end("4", run_id=rid)

        assert client._request.call_count == 2
        tool_call = client._request.call_args_list[0][1]["json"]["events"][0]
        tool_resp = client._request.call_args_list[1][1]["json"]["events"][0]
        assert tool_call["eventType"] == "tool_call"
        assert tool_call["metadata"]["framework"] == "langchain"
        assert tool_resp["eventType"] == "tool_response"


# ═══════════════════════════════════════════════════════════════
# Story 3.2 — CrewAI Plugin (10 tests)
# ═══════════════════════════════════════════════════════════════


class TestCrewAIPlugin:
    """Tests for CrewAI integration (v0.8.0)."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.crewai import AgentLensCrewAIHandler

        client = MagicMock()
        defaults = {
            "client": client,
            "agent_id": "agent-1",
            "session_id": "ses-1",
            "crew_name": "research-crew",
        }
        defaults.update(kwargs)
        handler = AgentLensCrewAIHandler(**defaults)
        return handler, client

    # 1. crew kickoff → session_started
    def test_on_crew_start_emits_session_started(self):
        handler, client = self._make_handler()
        crew = MagicMock()
        crew.name = "research-crew"
        crew.agents = [MagicMock(role="researcher"), MagicMock(role="writer")]
        crew.tasks = [MagicMock()]

        handler.on_crew_start(crew)
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "session_started"
        assert event["payload"]["crew_name"] == "research-crew"
        assert event["payload"]["agent_count"] == 2
        assert "crew:research-crew" in event["tags"]
        assert event["metadata"]["framework"] == "crewai"

    # 2. crew completion → session_ended
    def test_on_crew_end_emits_session_ended(self):
        handler, client = self._make_handler()
        crew = MagicMock()
        handler.on_crew_start(crew)  # To track start time
        client.reset_mock()

        handler.on_crew_end(crew, "Final research report completed")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "session_ended"
        assert "Final research report" in event["payload"]["result_summary"]
        assert event["payload"]["duration_ms"] >= 0

    # 3. agent start
    def test_on_agent_start_emits_role_goal_backstory(self):
        handler, client = self._make_handler()
        agent = MagicMock()
        agent.role = "researcher"
        agent.goal = "Find relevant papers"
        agent.backstory = "Expert in AI research"

        handler.on_agent_start(agent)
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_start"
        assert event["payload"]["data"]["role"] == "researcher"
        assert event["payload"]["data"]["goal"] == "Find relevant papers"
        assert event["payload"]["data"]["backstory"] == "Expert in AI research"
        assert event["agentId"] == "research-crew/researcher"

    # 4. agent end
    def test_on_agent_end_emits_output(self):
        handler, client = self._make_handler()
        agent = MagicMock()
        agent.role = "writer"
        agent.id = "writer-id"

        handler.on_agent_start(agent)
        client.reset_mock()
        handler.on_agent_end(agent, "Article draft completed")

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "agent_end"
        assert event["payload"]["data"]["role"] == "writer"
        assert "Article draft" in event["payload"]["data"]["output"]

    # 5. task start
    def test_on_task_start_emits_description_expected_output(self):
        handler, client = self._make_handler()
        task = MagicMock()
        task.id = "task-1"
        task.description = "Research AI safety papers"
        task.expected_output = "List of 10 papers with summaries"
        agent = MagicMock()
        agent.role = "researcher"

        handler.on_task_start(task, agent)
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "task_start"
        assert event["payload"]["data"]["description"] == "Research AI safety papers"
        assert event["payload"]["data"]["expected_output"] == "List of 10 papers with summaries"
        assert event["payload"]["data"]["assigned_agent"] == "researcher"

    # 6. task end
    def test_on_task_end_emits_output_with_duration(self):
        handler, client = self._make_handler()
        task = MagicMock()
        task.id = "task-1"
        agent = MagicMock()
        agent.role = "researcher"

        handler.on_task_start(task, agent)
        client.reset_mock()
        handler.on_task_end(task, agent, "Found 10 relevant papers")

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "task_end"
        assert "Found 10" in event["payload"]["data"]["output"]
        assert event["payload"]["data"]["duration_ms"] >= 0

    # 7. task delegation
    def test_on_task_delegation_emits_delegator_delegatee(self):
        handler, client = self._make_handler()
        delegator = MagicMock(role="manager")
        delegatee = MagicMock(role="researcher")
        task = MagicMock(description="Do research")

        handler.on_task_delegation(delegator, delegatee, task, reason="Expert needed")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["payload"]["type"] == "task_delegation"
        assert event["payload"]["data"]["delegator"] == "manager"
        assert event["payload"]["data"]["delegatee"] == "researcher"
        assert event["payload"]["data"]["reason"] == "Expert needed"

    # 8. tool usage with calling agent
    def test_on_tool_use_emits_tool_call_with_agent(self):
        handler, client = self._make_handler()
        agent = MagicMock(role="researcher")

        call_id = handler.on_tool_use(agent, "web_search", "AI safety papers")
        assert call_id != ""
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_call"
        assert event["payload"]["toolName"] == "web_search"
        assert event["metadata"]["calling_agent"] == "researcher"
        assert event["agentId"] == "research-crew/researcher"

    # 9. tool response
    def test_on_tool_result_emits_tool_response(self):
        handler, client = self._make_handler()
        agent = MagicMock(role="researcher")

        call_id = handler.on_tool_use(agent, "web_search", "query")
        client.reset_mock()
        handler.on_tool_result(agent, "web_search", "Results found", call_id)

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_response"
        assert event["payload"]["toolName"] == "web_search"

    # 10. fail-safety
    def test_all_methods_never_raise(self):
        handler, client = self._make_handler()
        client._request.side_effect = Exception("Boom")

        # None of these should raise
        handler.on_crew_start(MagicMock())
        handler.on_crew_end(MagicMock(), "result")
        handler.on_agent_start(MagicMock())
        handler.on_agent_end(MagicMock(), "output")
        handler.on_task_start(MagicMock(), MagicMock())
        handler.on_task_end(MagicMock(), MagicMock(), "output")
        handler.on_task_delegation(MagicMock(), MagicMock(), MagicMock())
        handler.on_tool_use(MagicMock(), "tool", "input")
        handler.on_tool_result(MagicMock(), "tool", "result")
        handler.step_callback(MagicMock())


# ═══════════════════════════════════════════════════════════════
# Story 3.3 — AutoGen Plugin (8 tests)
# ═══════════════════════════════════════════════════════════════


class TestAutoGenPlugin:
    """Tests for AutoGen integration (v0.8.0)."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.autogen import AgentLensAutoGenHandler

        client = MagicMock()
        defaults = {"client": client, "agent_id": "agent-1", "session_id": "ses-1"}
        defaults.update(kwargs)
        handler = AgentLensAutoGenHandler(**defaults)
        return handler, client

    # 1. initiate_chat → session_started
    def test_on_conversation_start_emits_session_started(self):
        handler, client = self._make_handler()
        initiator = MagicMock(name="assistant")
        initiator.name = "assistant"
        participants = [MagicMock(name="user_proxy")]
        participants[0].name = "user_proxy"

        handler.on_conversation_start(initiator, participants)
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "session_started"
        assert event["payload"]["initiator"] == "assistant"
        assert event["metadata"]["framework"] == "autogen"
        assert event["metadata"]["framework_component"] == "conversation"

    # 2. message exchange with agent name as agentId
    def test_on_message_sent_uses_sender_as_agent_id(self):
        handler, client = self._make_handler()
        sender = MagicMock()
        sender.name = "coder"
        receiver = MagicMock()
        receiver.name = "reviewer"

        result = handler.on_message_sent(sender, receiver, "Here's the code")
        assert result == "Here's the code"  # Must return unchanged

        event = client._request.call_args[1]["json"]["events"][0]
        assert event["agentId"] == "coder"
        assert event["payload"]["data"]["sender"] == "coder"
        assert event["payload"]["data"]["receiver"] == "reviewer"
        assert event["payload"]["data"]["message_type"] == "str"

    # 3. LLM call/response
    def test_on_llm_call_and_response(self):
        handler, client = self._make_handler()
        agent = MagicMock()
        agent.name = "assistant"

        messages = [{"role": "user", "content": "Hello"}]
        call_id = handler.on_llm_call(agent, messages=messages, model="gpt-4")
        assert call_id != ""

        call_event = client._request.call_args[1]["json"]["events"][0]
        assert call_event["eventType"] == "llm_call"
        assert call_event["agentId"] == "assistant"
        assert call_event["payload"]["model"] == "gpt-4"
        assert call_event["metadata"]["calling_agent"] == "assistant"

        handler.on_llm_response(agent, response="Hi there!", call_id=call_id, model="gpt-4")
        resp_event = client._request.call_args[1]["json"]["events"][0]
        assert resp_event["eventType"] == "llm_response"
        assert resp_event["payload"]["durationMs"] >= 0

    # 4. code execution
    def test_on_code_execution_and_result(self):
        handler, client = self._make_handler()
        agent = MagicMock()
        agent.name = "coder"

        call_id = handler.on_code_execution(agent, "print('hello')", language="python")
        assert call_id != ""
        exec_event = client._request.call_args[1]["json"]["events"][0]
        assert exec_event["payload"]["type"] == "code_execution"
        assert exec_event["payload"]["data"]["language"] == "python"
        assert exec_event["agentId"] == "coder"

        handler.on_code_result(agent, call_id=call_id, result="hello", exit_code=0)
        result_event = client._request.call_args[1]["json"]["events"][0]
        assert result_event["payload"]["type"] == "code_result"
        assert result_event["payload"]["data"]["exit_code"] == 0

    # 5. tool_call/tool_response
    def test_tool_call_and_result(self):
        handler, client = self._make_handler()
        agent = MagicMock()
        agent.name = "assistant"

        call_id = handler.on_tool_call(agent, "search", {"query": "test"})
        assert call_id != ""
        handler.on_tool_result(agent, "search", "result found", call_id)

        assert client._request.call_count == 2
        tool_call = client._request.call_args_list[0][1]["json"]["events"][0]
        assert tool_call["eventType"] == "tool_call"
        assert tool_call["payload"]["arguments"]["agent"] == "assistant"

    # 6. conversation end → session_ended
    def test_on_conversation_end_emits_session_ended(self):
        handler, client = self._make_handler()
        handler.on_conversation_end("All tasks completed successfully")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "session_ended"
        assert "All tasks completed" in event["payload"]["summary"]

    # 7. message sent never raises and returns message
    def test_on_message_sent_never_raises(self):
        handler, client = self._make_handler()
        client._request.side_effect = Exception("Boom")

        result = handler.on_message_sent(
            MagicMock(), MagicMock(), {"content": "test", "role": "user"}
        )
        assert result == {"content": "test", "role": "user"}  # Must return unchanged

    # 8. all methods fail-safe
    def test_all_methods_never_raise(self):
        handler, client = self._make_handler()
        client._request.side_effect = Exception("Boom")

        handler.on_conversation_start(MagicMock(), [MagicMock()])
        handler.on_conversation_end("done")
        handler.on_message_sent(MagicMock(), MagicMock(), "msg")
        handler.on_message_received(MagicMock(), MagicMock(), "msg")
        handler.on_llm_call(MagicMock(), model="gpt-4")
        handler.on_llm_response(MagicMock(), response="hi")
        handler.on_code_execution(MagicMock(), "print(1)")
        handler.on_code_result(MagicMock(), result="1")
        handler.on_tool_call(MagicMock(), "tool", {"a": 1})
        handler.on_tool_result(MagicMock(), "tool", "result")


# ═══════════════════════════════════════════════════════════════
# Story 3.4 — Semantic Kernel Plugin (8 tests)
# ═══════════════════════════════════════════════════════════════


class TestSemanticKernelPlugin:
    """Tests for Semantic Kernel integration (v0.8.0)."""

    def _make_handler(self, **kwargs):
        from agentlensai.integrations.semantic_kernel import AgentLensSKHandler

        client = MagicMock()
        defaults = {"client": client, "agent_id": "agent-1", "session_id": "ses-1"}
        defaults.update(kwargs)
        handler = AgentLensSKHandler(**defaults)
        return handler, client

    # 1. function invoking → tool_call
    def test_on_function_invoking_sends_tool_call_with_params(self):
        handler, client = self._make_handler()
        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.arguments = {"query": "test", "limit": "10"}

        handler._on_function_invoking(context, "call-1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_call"
        assert event["payload"]["toolName"] == "WebPlugin.search"
        assert event["payload"]["function_name"] == "search"
        assert event["payload"]["plugin_name"] == "WebPlugin"
        assert event["payload"]["arguments"]["query"] == "test"
        assert event["metadata"]["framework"] == "semantic_kernel"
        assert event["metadata"]["framework_component"] == "function"

    # 2. function invoked → tool_response
    def test_on_function_invoked_sends_tool_response(self):
        handler, client = self._make_handler()
        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.result = "found something"
        context.exception = None

        handler._on_function_invoked(context, "call-1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_response"
        assert event["payload"]["function_name"] == "search"

    # 3. function error → tool_error
    def test_on_function_invoked_sends_error_on_exception(self):
        handler, client = self._make_handler()
        context = MagicMock()
        context.function.name = "search"
        context.function.plugin_name = "WebPlugin"
        context.exception = ValueError("oops")

        handler._on_function_invoked(context, "call-1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["eventType"] == "tool_error"
        assert "oops" in event["payload"]["error"]

    # 4. AI service call → llm_call/llm_response
    def test_on_ai_call_and_response(self):
        handler, client = self._make_handler(agent_id=None, kernel_name="my-kernel")
        messages = [{"role": "user", "content": "Hello"}]
        call_id = handler.on_ai_call(service_id="azure-gpt4", model="gpt-4", messages=messages)
        assert call_id != ""

        call_event = client._request.call_args[1]["json"]["events"][0]
        assert call_event["eventType"] == "llm_call"
        assert call_event["payload"]["service_id"] == "azure-gpt4"
        assert call_event["payload"]["model"] == "gpt-4"
        assert call_event["agentId"] == "my-kernel"
        assert call_event["metadata"]["service_id"] == "azure-gpt4"

        handler.on_ai_response(
            call_id=call_id,
            response="Hi there!",
            service_id="azure-gpt4",
            model="gpt-4",
            input_tokens=10,
            output_tokens=5,
        )
        resp_event = client._request.call_args[1]["json"]["events"][0]
        assert resp_event["eventType"] == "llm_response"
        assert resp_event["payload"]["durationMs"] >= 0
        assert resp_event["payload"]["inputTokens"] == 10
        assert resp_event["payload"]["outputTokens"] == 5

    # 5. agentId from kernel name
    def test_agent_id_from_kernel_name(self):
        handler, client = self._make_handler(agent_id=None, kernel_name="my-kernel")
        context = MagicMock()
        context.function.name = "fn"
        context.function.plugin_name = "Plugin"
        context.arguments = {}

        handler._on_function_invoking(context, "c1")
        event = client._request.call_args[1]["json"]["events"][0]
        assert event["agentId"] == "my-kernel"

    # 6. filter async lifecycle
    @pytest.mark.asyncio
    async def test_filter_calls_next_and_instruments(self):
        handler, client = self._make_handler()
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

    # 7. init helper wires filter
    def test_init_adds_filter_to_kernel(self):
        from agentlensai.integrations.semantic_kernel import init

        kernel = MagicMock()
        kernel.name = "test-kernel"
        handler = init(kernel, client=MagicMock(), session_id="ses-1")

        kernel.add_filter.assert_called_once_with("function_invocation", handler.filter)

    # 8. all methods fail-safe
    def test_all_methods_never_raise(self):
        handler, client = self._make_handler()
        client._request.side_effect = Exception("Boom")

        handler._on_function_invoking(MagicMock(), "c1")
        handler._on_function_invoked(MagicMock(), "c1")
        handler.on_ai_call(service_id="svc")
        handler.on_ai_response(call_id="c1", response="hi")
        handler.on_planner_step("step")


# ═══════════════════════════════════════════════════════════════
# Auto-Detection Tests (shared)
# ═══════════════════════════════════════════════════════════════


class TestAutoDetection:
    """Tests for framework auto-detection in init()."""

    def test_instrument_frameworks_handles_missing_crewai(self):
        """Should not error when crewai is not installed."""
        from agentlensai._init import _instrument_frameworks

        _instrument_frameworks()

    def test_uninstrument_frameworks_handles_missing(self):
        """Should not error when frameworks are not installed."""
        from agentlensai._init import _uninstrument_frameworks

        _uninstrument_frameworks()

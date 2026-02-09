# Framework Plugins

AgentLens provides optional framework plugins that automatically instrument popular AI agent frameworks. Each plugin captures LLM calls, tool invocations, and agent lifecycle events with zero manual logging code.

## Installation

Install the base package with the framework extra you need:

```bash
# LangChain
pip install agentlensai[langchain]

# CrewAI
pip install agentlensai[crewai]

# AutoGen
pip install agentlensai[autogen]

# Semantic Kernel
pip install agentlensai[semantic-kernel]

# All frameworks
pip install agentlensai[all]
```

## LangChain

AgentLens ships a LangChain callback handler that captures every LLM call, tool invocation, and chain event.

### Setup

```python
import agentlensai
from agentlensai.integrations.langchain import AgentLensCallbackHandler

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-langchain-agent",
)

handler = AgentLensCallbackHandler()

# Use with any chain, agent, or LLM
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(model="gpt-4o")
response = llm.invoke(
    [HumanMessage(content="Hello!")],
    config={"callbacks": [handler]},
)

# Or attach globally
from langchain_core.globals import set_llm_cache
llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])
```

### What's Captured

- `llm_call` / `llm_response` — every LLM invocation with model, tokens, cost
- `tool_call` / `tool_response` — tool/function calls within agents
- `session_started` / `session_ended` — chain execution lifecycle

## CrewAI

The CrewAI plugin hooks into Crew's task execution pipeline.

### Setup

```python
import agentlensai
from agentlensai.integrations.crewai import AgentLensCrewAIHandler

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-crew",
)

handler = AgentLensCrewAIHandler(crew_name="my-crew")

from crewai import Agent, Task, Crew

researcher = Agent(role="Researcher", goal="Find information", backstory="...")
task = Task(description="Research AI trends", agent=researcher)
crew = Crew(
    agents=[researcher],
    tasks=[task],
    step_callback=handler.step_callback,  # capture each agent step
)

# Lifecycle hooks for session tracking
handler.on_crew_start(crew)
result = crew.kickoff()
handler.on_crew_end(crew, result)
```

### What's Captured

- Task start/end with agent assignments
- LLM calls made by each crew member
- Tool usage and delegation events
- Crew-level session with cost rollup

## AutoGen

The AutoGen plugin instruments multi-agent conversations.

### Setup

```python
import agentlensai
from agentlensai.integrations.autogen import AgentLensAutoGenHandler

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-autogen-group",
)

handler = AgentLensAutoGenHandler()

import autogen

assistant = autogen.AssistantAgent("assistant", llm_config={"model": "gpt-4o"})
user_proxy = autogen.UserProxyAgent("user", code_execution_config=False)

# Register hook to capture message exchanges
assistant.register_hook("process_message_before_send", handler.on_message_sent)

# Lifecycle hooks for session tracking
handler.on_conversation_start(user_proxy, [assistant])
user_proxy.initiate_chat(assistant, message="Write a poem about AI")
handler.on_conversation_end("Done")
```

### What's Captured

- Message exchanges between agents
- LLM calls with full prompt/completion
- Code execution events (if enabled)
- Multi-agent session timeline

## Semantic Kernel

The Semantic Kernel plugin integrates via SK's filter/hook system.

### Setup

```python
import agentlensai
from agentlensai.integrations.semantic_kernel import AgentLensSKHandler, init as sk_init

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-sk-agent",
)

import semantic_kernel as sk

kernel = sk.Kernel()

# Option 1: Use the convenience init helper (adds filter automatically)
sk_init(kernel)

# Option 2: Add filter manually
# handler = AgentLensSKHandler(kernel_name="my-kernel")
# kernel.add_filter("function_invocation", handler.filter)

# All kernel function calls and LLM invocations are now captured
result = await kernel.invoke_prompt("Tell me a joke about {{$topic}}", topic="programming")
```

### What's Captured

- Kernel function invocations
- LLM completions with token usage
- Plugin/skill calls
- Planner steps (if using a planner)

## Auto-Detection

When you call `agentlensai.init()`, the SDK automatically detects which frameworks are installed and enables the corresponding plugins. No extra configuration is needed — if a framework package is importable, it will be instrumented.

## Fail-Safe Guarantees

All framework plugins follow these safety principles:

1. **Non-blocking** — Event capture runs in a background thread. Your agent's performance is unaffected.
2. **Fail-silent** — If the AgentLens server is unreachable, your agent continues working normally. No exceptions are raised.
3. **Graceful degradation** — If a framework API changes, the plugin disables itself rather than crashing your application.
4. **No monkey-patching globals** — Plugins use official extension points (callbacks, hooks, filters) rather than patching internal APIs.

## Configuration Options

The `init()` function accepts these parameters:

```python
agentlensai.init(
    url="http://localhost:3400",       # AgentLens server URL (required)
    api_key="als_your_key",            # API key for authentication
    agent_id="my-agent",               # Agent identifier (default: "default")
    session_id=None,                   # Session ID (auto-generated if omitted)
    redact=True,                       # Strip prompt/completion content, keep metadata
    sync_mode=False,                   # Send events synchronously (useful for testing)
)
```

## Combining Frameworks

You can use multiple frameworks in the same application. AgentLens deduplicates events and maintains a single session timeline:

```python
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-hybrid-agent",
)

# LangChain chain calls and CrewAI tasks both appear
# in the same AgentLens session timeline
```

## Troubleshooting

**Events not appearing?**
- Check that `agentlensai.init()` is called before creating framework objects
- Verify the API key and server URL
- Call `agentlensai.shutdown()` before exit to flush pending events

**Performance concerns?**
- Events are batched and sent asynchronously — overhead is typically <1ms per event
- Use `redact=True` to reduce payload size
- Adjust `batch_size` and `flush_interval` for your workload

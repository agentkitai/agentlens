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
from agentlensai.integrations.crewai import AgentLensCrewPlugin

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-crew",
)

plugin = AgentLensCrewPlugin()

from crewai import Agent, Task, Crew

researcher = Agent(role="Researcher", goal="Find information", backstory="...")
task = Task(description="Research AI trends", agent=researcher)
crew = Crew(agents=[researcher], tasks=[task])

# Plugin auto-detects and instruments the crew
result = crew.kickoff()
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
from agentlensai.integrations.autogen import AgentLensAutoGenPlugin

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-autogen-group",
)

plugin = AgentLensAutoGenPlugin()

import autogen

assistant = autogen.AssistantAgent("assistant", llm_config={"model": "gpt-4o"})
user_proxy = autogen.UserProxyAgent("user", code_execution_config=False)

# Plugin instruments message exchanges
user_proxy.initiate_chat(assistant, message="Write a poem about AI")
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
from agentlensai.integrations.semantic_kernel import AgentLensSemanticKernelPlugin

agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-sk-agent",
)

import semantic_kernel as sk

kernel = sk.Kernel()
plugin = AgentLensSemanticKernelPlugin(kernel)

# All kernel function calls and LLM invocations are now captured
result = await kernel.invoke_prompt("Tell me a joke about {{$topic}}", topic="programming")
```

### What's Captured

- Kernel function invocations
- LLM completions with token usage
- Plugin/skill calls
- Planner steps (if using a planner)

## Auto-Detection

When you call `agentlensai.init()`, the SDK automatically detects which frameworks are installed and enables the corresponding plugins. You can disable auto-detection:

```python
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-agent",
    auto_instrument=False,  # disable auto-detection
)
```

Or selectively enable/disable specific frameworks:

```python
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-agent",
    frameworks=["langchain", "crewai"],  # only these two
)
```

## Fail-Safe Guarantees

All framework plugins follow these safety principles:

1. **Non-blocking** — Event capture runs in a background thread. Your agent's performance is unaffected.
2. **Fail-silent** — If the AgentLens server is unreachable, your agent continues working normally. No exceptions are raised.
3. **Graceful degradation** — If a framework API changes, the plugin disables itself rather than crashing your application.
4. **No monkey-patching globals** — Plugins use official extension points (callbacks, hooks, filters) rather than patching internal APIs.

## Configuration Options

All plugins accept these common options:

```python
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_your_key",
    agent_id="my-agent",

    # Privacy
    redact=True,              # strip prompt/completion content, keep metadata

    # Batching
    batch_size=50,            # events per batch (default: 50)
    flush_interval=5.0,       # seconds between flushes (default: 5.0)

    # Filtering
    capture_prompts=True,     # include full prompt text (default: True)
    capture_completions=True, # include full completion text (default: True)
    min_severity="info",      # minimum severity to capture (default: "info")

    # Connection
    timeout=10,               # HTTP timeout in seconds (default: 10)
    retries=3,                # retry count for failed sends (default: 3)
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

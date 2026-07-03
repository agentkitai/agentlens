# Agent Memory — Integration Guide

AgentLens provides three memory capabilities that turn stateless AI agents into self-improving systems: **Recall**, **Reflect**, and **Context**. This guide covers when and how to use each one.

> **Note:** Lesson capture (the former **Learn** capability) moved to [Lore](/migration/lore-integration). Use `lore-sdk` or the Lore MCP server for saving and managing distilled insights.

## Overview

| Capability | MCP Tool | API Endpoint | Purpose |
|---|---|---|---|
| **Recall** | — | `GET /api/recall` | Semantic search over past events and sessions |
| **Reflect** | `agentlens_reflect` | `GET /api/reflect` | Analyze behavioral patterns (errors, costs, tool usage, performance) |
| **Context** | `agentlens_context` | `GET /api/context` | Retrieve cross-session context for a topic |

Together, these give agents the ability to:
- **Remember** what happened in past sessions
- **Analyze** their own behavioral patterns
- **Carry context** across session boundaries

## Setup

### MCP Configuration

Add the AgentLens MCP server to your agent's config. The memory tools are automatically registered alongside the core observability tools.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentkitai/agentlens-mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here",
        "AGENTLENS_AGENT_NAME": "my-agent"
      }
    }
  }
}
```

### API Key

Create an API key if you haven't already:

```bash
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

### Embedding Backend

Recall uses vector embeddings for semantic search. Configure the embedding backend via environment variables on the server:

| Variable | Default | Description |
|---|---|---|
| `AGENTLENS_EMBEDDING_BACKEND` | `openai` | Embedding backend (`openai`) |
| `AGENTLENS_EMBEDDING_MODEL` | varies | Model name override |
| `OPENAI_API_KEY` | — | Required for the `openai` backend |

- **`openai`** — Uses OpenAI's embedding API. Requires `OPENAI_API_KEY`.

> The former bundled `local` (ONNX) and `none` backends were removed. For local or
> alternative embeddings, use [Lore](/migration/lore-integration) for semantic search.

## Recall — Semantic Search

Use `agentlens_recall` when the agent needs to search its memory for relevant past experience.

### When to Use

- Before starting a task, check if similar work was done before
- When encountering an error, search for past occurrences
- To find relevant context for decision-making
- To locate related sessions or events

### Query Strategies

**Broad search** — cast a wide net:
```
agentlens_recall({ query: "authentication", scope: "all" })
```

**Scoped search** — narrow to a specific source type:
```
agentlens_recall({ query: "deployment failures", scope: "events" })
```

**High-confidence only** — filter by similarity score:
```
agentlens_recall({ query: "API timeout", minScore: 0.8 })
```

**Time-bounded** — recent history only:
```
agentlens_recall({ query: "database errors", from: "2026-02-01", to: "2026-02-08" })
```

### What It Returns

Results are ranked by cosine similarity. Each result includes:
- **sourceType** — `event` or `session`
- **score** — similarity from 0 to 1
- **text** — the matching content
- **metadata** — source-specific context (sessionId, category, etc.)

## Learn — Moved to Lore

Lesson capture and management (the former `agentlens_learn` tool and `/api/lessons`
endpoints) have moved to [Lore](/migration/lore-integration). Use `lore-sdk` or the
Lore MCP server to save, list, update, and search distilled insights.

## Reflect — Pattern Analysis

Use `agentlens_reflect` to analyze behavioral patterns across sessions. This is the agent's self-awareness capability.

### Analysis Types

#### error_patterns

Identifies recurring errors across sessions. Useful for detecting systemic issues.

Returns: error patterns with count, first/last seen, affected sessions, and preceding tool calls.

```
agentlens_reflect({ analysis: "error_patterns", agentId: "my-agent" })
```

#### cost_analysis

Breaks down costs by model and agent. Helps optimize model selection and usage patterns.

Returns: total cost, per-session averages, model breakdown, agent breakdown, and cost trend direction.

```
agentlens_reflect({ analysis: "cost_analysis", from: "2026-01-01" })
```

#### tool_sequences

Identifies common tool usage patterns — which tools are called together and in what order.

Returns: tool chains with frequency, session count, and error rate.

```
agentlens_reflect({ analysis: "tool_sequences", limit: 20 })
```

#### performance_trends

Tracks success rate, duration, and error trends over time.

Returns: current metrics, trend buckets, and an overall assessment (`improving`, `stable`, `degrading`).

```
agentlens_reflect({ analysis: "performance_trends" })
```

### Scheduling Reflection

Consider running reflection:
- At the start of each session (to load current patterns)
- Periodically (daily/weekly) for trend monitoring
- After a series of errors (to identify systemic issues)
- Before major changes (to establish baselines)

## Context — Cross-Session History

Use `GET /api/context` (or the SDK's `getContext`) to retrieve a topic-focused view of past sessions and lessons. This is ideal for building system prompts or grounding decisions in historical context.

### When to Use

- Building a system prompt with relevant history
- Starting work on a topic the agent has handled before
- Providing context to a new agent about previous work
- Auditing what happened with a specific topic

### How It Works

The context endpoint:
1. Finds sessions semantically related to the topic
2. Extracts key events from each session
3. Finds relevant lessons
4. Returns everything ranked by relevance score

```typescript
const context = await client.getContext({
  topic: 'database migrations',
  agentId: 'my-agent',
  limit: 5,
});

// Use in a system prompt
const systemPrompt = `
You are a database migration assistant.

Previous experience with this topic:
${context.sessions.map(s => `- ${s.summary}`).join('\n')}

Lessons learned:
${context.lessons.map(l => `- ${l.title}: ${l.content}`).join('\n')}
`;
```

## Patterns for Self-Improving Agents

### Pattern 1: Pre-Task Recall

Before starting a task, search for relevant past experience:

```
1. Receive task from user
2. agentlens_recall({ query: "<task description>" })
3. Use recall results to inform approach
4. Execute task
5. If successful, save a lesson to Lore (lore-sdk / Lore MCP)
```

### Pattern 2: Error Recovery with Learning

When an error occurs, check if it's happened before:

```
1. Error occurs
2. agentlens_recall({ query: "<error message>", scope: "events" })
3. Search Lore for a matching lesson → apply known fix
4. If no lesson → debug and solve
5. Save the fix as a lesson in Lore (lore-sdk / Lore MCP)
```

### Pattern 3: Periodic Self-Reflection

Schedule periodic analysis to identify trends:

```
1. agentlens_reflect({ analysis: "error_patterns" })
2. If recurring errors found → create preventive lessons
3. agentlens_reflect({ analysis: "performance_trends" })
4. If degrading → investigate and adjust behavior
```

### Pattern 4: Context-Aware Sessions

Start sessions with historical context:

```
1. User asks about topic X
2. GET /api/context?topic=X
3. Include relevant sessions and lessons in system prompt
4. Proceed with full historical awareness
```

### Pattern 5: Knowledge Distillation

After complex tasks, distill learnings:

```
1. Complete complex multi-step task
2. Review what worked and what didn't
3. Save a lesson to Lore (lore-sdk / Lore MCP) with `importance: "high"`
4. Future runs start with these lessons pre-loaded
```

## Configuration

### Embedding Backends

| Backend | Quality | Latency | Cost | Best For |
|---|---|---|---|---|
| `openai` | Excellent | Medium | Per-token | Semantic search over events and sessions |

Set the backend via `AGENTLENS_EMBEDDING_BACKEND=openai` (with `OPENAI_API_KEY`), and
optionally override the model with `AGENTLENS_EMBEDDING_MODEL`. Higher `minScore`
values return fewer but more relevant results.

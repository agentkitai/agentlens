# Agent Memory — Integration Guide

AgentLens provides four memory capabilities that turn stateless AI agents into self-improving systems: **Recall**, **Learn**, **Reflect**, and **Context**. This guide covers when and how to use each one.

## Overview

| Capability | MCP Tool | API Endpoint | Purpose |
|---|---|---|---|
| **Recall** | `agentlens_recall` | `GET /api/recall` | Semantic search over past events, sessions, and lessons |
| **Learn** | `agentlens_learn` | `POST/GET/PUT/DELETE /api/lessons` | Save, retrieve, update, and delete distilled insights |
| **Reflect** | `agentlens_reflect` | `GET /api/reflect` | Analyze behavioral patterns (errors, costs, tool usage, performance) |
| **Context** | — | `GET /api/context` | Retrieve cross-session context for a topic |

Together, these give agents the ability to:
- **Remember** what happened in past sessions
- **Learn** from mistakes and successes
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
      "args": ["@agentlensai/mcp"],
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
| `EMBEDDING_BACKEND` | `local` | Backend: `local`, `openai`, or `none` |
| `EMBEDDING_MODEL` | varies | Model name (backend-specific) |
| `OPENAI_API_KEY` | — | Required for `openai` backend |

- **`local`** — Uses a bundled embedding model. No external dependencies. Good for development.
- **`openai`** — Uses OpenAI's embedding API. Better quality for production.
- **`none`** — Disables embeddings. Recall won't work, but all other features still function.

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
- **sourceType** — `event`, `session`, or `lesson`
- **score** — similarity from 0 to 1
- **text** — the matching content
- **metadata** — source-specific context (sessionId, category, etc.)

## Learn — Lesson Lifecycle

Use `agentlens_learn` to save and manage distilled insights. Lessons are the agent's long-term knowledge base.

### When to Save a Lesson

- After successfully solving a difficult problem
- After encountering (and resolving) a recurring error
- When discovering a better approach to a task
- After user feedback on agent behavior

### Lesson Structure

| Field | Required | Description |
|---|---|---|
| `title` | ✅ | Short, descriptive title |
| `content` | ✅ | Full lesson content |
| `category` | — | Grouping category (e.g., `deployment`, `security`, `debugging`) |
| `importance` | — | `low`, `normal`, `high`, `critical` |

### Actions

```
# Save a new lesson
agentlens_learn({ action: "save", title: "...", content: "...", category: "..." })

# List all lessons
agentlens_learn({ action: "list", category: "deployment" })

# Get a specific lesson
agentlens_learn({ action: "get", id: "lesson_abc123" })

# Update a lesson
agentlens_learn({ action: "update", id: "lesson_abc123", content: "new content" })

# Search lessons
agentlens_learn({ action: "search", search: "deployment best practices" })

# Archive a lesson
agentlens_learn({ action: "delete", id: "lesson_abc123" })
```

### Categories

Use consistent categories across agents for better organization. Recommended:

| Category | Use for |
|---|---|
| `general` | Miscellaneous insights |
| `debugging` | Error resolution strategies |
| `deployment` | Deployment process learnings |
| `security` | Security-related insights |
| `performance` | Performance optimization |
| `integration` | Third-party integration tips |
| `user-feedback` | User preference insights |

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
5. If successful, save lesson
```

### Pattern 2: Error Recovery with Learning

When an error occurs, check if it's happened before:

```
1. Error occurs
2. agentlens_recall({ query: "<error message>", scope: "lessons" })
3. If lesson found → apply known fix
4. If no lesson → debug and solve
5. agentlens_learn({ action: "save", title: "Fix for <error>", content: "<solution>" })
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
3. agentlens_learn({ action: "save", title: "...", content: "...", importance: "high" })
4. Future runs start with these lessons pre-loaded
```

## Configuration

### Embedding Backends

| Backend | Quality | Latency | Cost | Best For |
|---|---|---|---|---|
| `local` | Good | Low | Free | Development, small datasets |
| `openai` | Excellent | Medium | Per-token | Production, large datasets |
| `none` | N/A | N/A | Free | When semantic search isn't needed |

### Tuning Parameters

| Parameter | Default | Description |
|---|---|---|
| `RECALL_DEFAULT_LIMIT` | `10` | Default number of recall results |
| `RECALL_MIN_SCORE` | `0` | Default minimum similarity score |
| `CONTEXT_DEFAULT_LIMIT` | `5` | Default number of context sessions |
| `LESSON_MAX_PER_AGENT` | `1000` | Maximum lessons per agent |

Adjust these based on your use case. Higher `minScore` values return fewer but more relevant results. Lower limits reduce token usage when results are included in prompts.

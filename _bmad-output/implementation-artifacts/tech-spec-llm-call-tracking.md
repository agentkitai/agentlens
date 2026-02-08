# Tech Spec: LLM Call Tracking (v0.3.0)

## Overview
Add first-class `llm_call` and `llm_response` event types to AgentLens for full prompt/completion observability. This enables users to see what was sent to each model and what came back — the #1 missing feature for AI agent observability.

## Design Principles
- **Two events, not one**: `llm_call` (request sent) + `llm_response` (completion received) — mirrors the tool_call/tool_response pattern for consistency and enables latency measurement
- **Paired in timeline**: Dashboard pairs them like tool_call→tool_response with duration badge
- **Enriches existing cost tracking**: `llm_response` carries token counts + cost, replacing the need for separate `cost_tracked` events (though `cost_tracked` remains valid for backward compat)
- **Prompt content is searchable**: Full-text search indexes prompt/completion content
- **Privacy-aware**: Optional `redactContent` flag strips prompt/completion from storage while keeping metadata

---

## Epic 1: Core Schema & Validation (3 stories)

### Story 1.1: Add `llm_call` and `llm_response` event types
**File:** `packages/core/src/types.ts`

Add to `EventType` union:
```typescript
| 'llm_call'
| 'llm_response'
```

Add to `EVENT_TYPES` array.

Add typed payloads:
```typescript
export interface LlmCallPayload {
  /** Correlation ID to match with llm_response */
  callId: string;
  /** Provider name (e.g., "anthropic", "openai", "google") */
  provider: string;
  /** Model identifier (e.g., "claude-opus-4-6", "gpt-4o") */
  model: string;
  /** The messages/prompt sent to the model */
  messages: LlmMessage[];
  /** System prompt (if separate from messages) */
  systemPrompt?: string;
  /** Model parameters */
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
    [key: string]: unknown;
  };
  /** Tool/function definitions provided to the model */
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  /** If true, prompt content was redacted for privacy */
  redacted?: boolean;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  /** For tool role: which tool call this responds to */
  toolCallId?: string;
  /** For assistant role: tool calls the model wants to make */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface LlmResponsePayload {
  /** Correlation ID matching the llm_call */
  callId: string;
  /** Provider name */
  provider: string;
  /** Model used (may differ from requested if auto-routed) */
  model: string;
  /** The completion content */
  completion: string | null;
  /** Tool calls requested by the model */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Stop reason */
  finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error' | string;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Thinking/reasoning tokens if applicable */
    thinkingTokens?: number;
    /** Cache read/write tokens if applicable */
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** Cost in USD */
  costUsd: number;
  /** Latency in milliseconds (time from request to full response) */
  latencyMs: number;
  /** If true, completion content was redacted for privacy */
  redacted?: boolean;
}
```

Add to `EventPayload` union.

**Acceptance Criteria:**
- `llm_call` and `llm_response` are valid `EventType` values
- TypeScript compilation succeeds with new types
- `EVENT_TYPES` array includes both new types
- Payloads are part of `EventPayload` union

### Story 1.2: Add Zod validation schemas for LLM payloads
**File:** `packages/core/src/schemas.ts`

Add:
```typescript
export const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
});

export const llmCallPayloadSchema = z.object({
  callId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(llmMessageSchema).min(1),
  systemPrompt: z.string().optional(),
  parameters: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
  }).catchall(z.unknown()).optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  })).optional(),
  redacted: z.boolean().optional(),
});

export const llmResponsePayloadSchema = z.object({
  callId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  completion: z.string().nullable(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
  finishReason: z.string().min(1),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    thinkingTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
  }),
  costUsd: z.number(),
  latencyMs: z.number(),
  redacted: z.boolean().optional(),
});
```

Register in `payloadSchemasByEventType`:
```typescript
llm_call: llmCallPayloadSchema,
llm_response: llmResponsePayloadSchema,
```

**Acceptance Criteria:**
- Valid llm_call payloads pass validation
- Invalid payloads (missing callId, empty messages) fail with descriptive errors
- Schema map includes both new types

### Story 1.3: Update existing tests for new event types
**File:** `packages/core/src/__tests__/`

- Add test cases for `llm_call` and `llm_response` in schema validation tests
- Add test cases for event creation with LLM payloads
- Verify hash chain works with LLM events
- Test payload truncation for large prompts

**Acceptance Criteria:**
- All existing tests still pass
- New tests cover: valid payloads, invalid payloads, hash chain, truncation
- At least 10 new test cases

---

## Epic 2: Server Ingest & Storage (3 stories)

### Story 2.1: Update session materialization for LLM events
**File:** `packages/server/src/db/sqlite-store.ts`

When an `llm_response` event is ingested:
- Add `costUsd` to session's `totalCostUsd` (same as `cost_tracked`)
- Increment a new `llmCallCount` counter on the session

Add to sessions table:
```sql
llm_call_count INTEGER NOT NULL DEFAULT 0
total_input_tokens INTEGER NOT NULL DEFAULT 0
total_output_tokens INTEGER NOT NULL DEFAULT 0
```

Update `insertEvents()` to handle `llm_response`:
- Increment `llmCallCount`
- Accumulate `totalInputTokens` and `totalOutputTokens`
- Add cost to `totalCostUsd`

**Acceptance Criteria:**
- `llm_response` events update session cost and token counts
- New columns exist in sessions table
- Session query results include token counts
- Backward compatible: old sessions without LLM events show 0

### Story 2.2: Add LLM-specific analytics queries
**File:** `packages/server/src/routes/analytics.ts`

Add endpoint: `GET /api/analytics/llm`

Response:
```json
{
  "summary": {
    "totalCalls": 42,
    "totalCostUsd": 12.34,
    "totalInputTokens": 150000,
    "totalOutputTokens": 50000,
    "avgLatencyMs": 1250,
    "avgCostPerCall": 0.29
  },
  "byModel": [
    {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "calls": 20,
      "costUsd": 8.50,
      "inputTokens": 100000,
      "outputTokens": 30000,
      "avgLatencyMs": 1500
    }
  ],
  "byTime": [
    {
      "bucket": "2026-02-08T10:00:00Z",
      "calls": 5,
      "costUsd": 1.20,
      "inputTokens": 15000,
      "outputTokens": 5000,
      "avgLatencyMs": 900
    }
  ]
}
```

Query params: `from`, `to`, `granularity`, `agentId`, `model`, `provider`

**Acceptance Criteria:**
- Endpoint returns aggregated LLM metrics
- Filters by agent, model, provider work
- Time bucketing matches existing analytics granularity

### Story 2.3: Server-side tests for LLM ingest and analytics
**Files:** `packages/server/src/__tests__/`

- Test ingesting `llm_call` and `llm_response` events
- Test session materialization (cost, tokens)
- Test LLM analytics endpoint with filters
- Test pairing (callId correlation)
- Test payload search on prompt content

**Acceptance Criteria:**
- All existing server tests still pass
- New tests cover: ingest, session update, analytics, search
- At least 15 new test cases

---

## Epic 3: MCP & SDK Integration (3 stories)

### Story 3.1: Add `agentlens_log_llm_call` MCP tool
**File:** `packages/mcp/src/tools.ts`

New MCP tool for agents to log LLM calls in one shot (combines call + response):
```
agentlens_log_llm_call:
  sessionId: string
  provider: string
  model: string
  messages: array (the prompt messages)
  systemPrompt?: string
  completion: string | null
  toolCalls?: array
  finishReason: string
  usage: { inputTokens, outputTokens, totalTokens }
  costUsd: number
  latencyMs: number
  parameters?: object
  tools?: array
```

This tool emits TWO events internally:
1. `llm_call` with the request details
2. `llm_response` with the response details
Both share the same auto-generated `callId`.

**Acceptance Criteria:**
- Tool registers and appears in MCP tool list
- Emits paired events with matching callId
- Validates all required fields
- Returns confirmation with callId and event count

### Story 3.2: Add SDK methods for LLM tracking
**File:** `packages/sdk/src/client.ts`

Add to `AgentLensClient`:
```typescript
async logLlmCall(sessionId: string, params: {
  provider: string;
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  completion: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; thinkingTokens?: number };
  costUsd: number;
  latencyMs: number;
  parameters?: Record<string, unknown>;
  tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  redact?: boolean;
}): Promise<{ callId: string }>

async getLlmAnalytics(params?: {
  from?: string;
  to?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  granularity?: 'hour' | 'day' | 'week';
}): Promise<LlmAnalyticsResult>
```

**Acceptance Criteria:**
- SDK method sends paired llm_call + llm_response events
- Auto-generates callId (UUID v4)
- Redact option strips prompt/completion content
- Analytics method calls GET /api/analytics/llm
- TypeScript types are correct

### Story 3.3: SDK and MCP tests
**Files:** `packages/sdk/src/__tests__/`, `packages/mcp/src/__tests__/`

- Test MCP tool registration and invocation
- Test SDK `logLlmCall` method
- Test redaction mode
- Test analytics SDK method

**Acceptance Criteria:**
- All existing tests pass
- At least 10 new test cases across SDK + MCP

---

## Epic 4: Dashboard UI (4 stories)

### Story 4.1: LLM event timeline rendering
**File:** `packages/dashboard/src/components/Timeline.tsx`

- Add event styles for `llm_call` and `llm_response`:
  - `llm_call`: 🧠 icon, indigo palette
  - `llm_response`: 💬 icon, indigo palette
- Pair `llm_call` → `llm_response` by `callId` (same pattern as tool_call pairing)
- Show duration badge (latencyMs from response)
- Expandable node shows:
  - Model + provider badge
  - Message count + token summary
  - Cost badge
  - Expand to see full prompt/completion (with syntax highlighting for code blocks)

**Acceptance Criteria:**
- LLM events render with distinct icon/color
- Paired events show as single expandable node
- Duration badge shows latency
- Full prompt/completion viewable on expand
- Long prompts truncated with "show more"

### Story 4.2: LLM Analytics dashboard page
**File:** `packages/dashboard/src/pages/LlmAnalytics.tsx` (new)

Dashboard page showing:
- **Summary cards**: Total LLM calls, total cost, avg latency, tokens used
- **Cost by model chart**: Stacked bar chart (reuse existing chart pattern)
- **Latency distribution**: Histogram or line chart of p50/p90/p99
- **Model comparison table**: Provider | Model | Calls | Tokens | Cost | Avg Latency
- **Time series**: LLM calls over time with cost overlay
- Filters: date range, agent, model, provider

**Acceptance Criteria:**
- Page accessible via sidebar navigation ("LLM" or "Prompts")
- Summary cards show correct aggregates
- Charts render with real data
- Filters work correctly
- Responsive layout

### Story 4.3: Prompt/Completion detail viewer
**File:** `packages/dashboard/src/components/EventDetailPanel.tsx`

When clicking an `llm_call` or paired `llm_call`→`llm_response` event:
- Show **Prompt** tab: System prompt (if any) + messages in chat-bubble style
  - User messages: left-aligned, blue
  - Assistant messages: right-aligned, green
  - Tool messages: monospaced, gray
- Show **Completion** tab: Model response with syntax highlighting
- Show **Metadata** tab: Provider, model, parameters, token breakdown, cost, latency
- Show **Tools** tab (if tools were provided): List of tool definitions

**Acceptance Criteria:**
- Chat-bubble style prompt rendering
- Syntax highlighting for code in prompts/completions
- Token breakdown with input/output/thinking/cache
- Cost displayed prominently
- Copy-to-clipboard for prompt/completion

### Story 4.4: Update sidebar navigation and event filters
**Files:** `packages/dashboard/src/components/Layout.tsx`, filter components

- Add "Prompts" link to sidebar (route: `/llm`)
- Add `llm_call` and `llm_response` to event type filter dropdowns
- Update overview page to show LLM call count + cost metrics if data exists

**Acceptance Criteria:**
- Sidebar shows "Prompts" / "LLM" navigation link
- Event explorer can filter by llm_call / llm_response
- Overview includes LLM metrics when available
- No regressions in existing pages

---

## Epic 5: Documentation & CLI (2 stories)

### Story 5.1: Update documentation
**Files:** `docs/`

- Add "LLM Call Tracking" guide page
- Update API reference with new event types and endpoints
- Update SDK reference with new methods
- Update MCP tools reference
- Add examples for common providers (OpenAI, Anthropic, Google)

**Acceptance Criteria:**
- New doc page explains concept, setup, and usage
- API reference is complete and accurate
- Examples are copy-pasteable

### Story 5.2: Add CLI `llm` subcommand
**File:** `packages/cli/src/`

Add `agentlens llm` subcommand:
- `agentlens llm stats` — Show LLM usage summary (calls, cost, tokens)
- `agentlens llm models` — List models used with cost breakdown
- `agentlens llm recent` — Show recent LLM calls with latency/cost

**Acceptance Criteria:**
- All 3 subcommands work
- Output is formatted nicely (table output)
- Filters: --from, --to, --agent, --model

---

## Execution Plan

| Batch | Epics | Stories | Parallel Agents |
|-------|-------|---------|----------------|
| 1 | Epic 1 (Core) | 3 | 1 agent (foundational, must be first) |
| 2 | Epic 2 (Server) + Epic 3 (MCP/SDK) | 6 | 2-3 agents |
| 3 | Epic 4 (Dashboard) | 4 | 2 agents |
| 4 | Epic 5 (Docs/CLI) | 2 | 1 agent |

**Total: 5 epics, 15 stories**

Pipeline: Dev (Opus) → Review (Opus) → Fix → Commit → Next batch

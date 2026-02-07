# AgentLens — Architecture Design Document

**Version:** 1.0  
**Date:** 2026-02-07  
**Status:** Draft  
**Author:** BMAD Software Architect  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Design Principles](#2-design-principles)
3. [Package Structure](#3-package-structure)
4. [Event Architecture](#4-event-architecture)
5. [MCP Server Design](#5-mcp-server-design)
6. [Storage Layer](#6-storage-layer)
7. [API Design](#7-api-design)
8. [Dashboard Architecture](#8-dashboard-architecture)
9. [Integration Architecture](#9-integration-architecture)
10. [Security](#10-security)
11. [Performance Considerations](#11-performance-considerations)
12. [Technology Stack](#12-technology-stack)
13. [Architecture Decision Records](#13-architecture-decision-records)

---

## 1. System Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Hosts                                    │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                                  │
│  │ Claude   │  │ GPT-4    │  │ Custom   │    (AI Agents using MCP)          │
│  │ Desktop  │  │ Agent    │  │ Agent    │                                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                                  │
│       │              │              │                                        │
│       └──────────────┼──────────────┘                                       │
│                      │ MCP Protocol (stdio/SSE)                             │
│                      ▼                                                      │
│  ┌──────────────────────────────────────────┐                               │
│  │         @agentlens/mcp                    │                              │
│  │   MCP Server (Dedicated Tools Approach)   │                              │
│  │                                           │                              │
│  │  Tools:                                   │                              │
│  │   • agentlens_session_start               │                              │
│  │   • agentlens_log_event                   │                              │
│  │   • agentlens_session_end                 │                              │
│  │   • agentlens_query_events                │                              │
│  └──────────────┬───────────────────────────┘                               │
│                  │                                                           │
└──────────────────┼───────────────────────────────────────────────────────────┘
                   │  HTTP POST (events)
                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         @agentlens/server                                    │
│                      Hono HTTP API Server                                    │
│                                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐                   │
│  │  Event Ingest  │  │  Query Engine  │  │  SSE Hub     │                   │
│  │  POST /api/    │  │  GET /api/     │  │  /api/stream │                   │
│  │  events        │  │  events|       │  │              │                   │
│  │                │  │  sessions|     │  │  Real-time   │                   │
│  │  Webhook       │  │  analytics|    │  │  fan-out     │                   │
│  │  Receiver      │  │  alerts        │  │              │                   │
│  └───────┬────────┘  └───────┬────────┘  └──────┬───────┘                   │
│          │                   │                   │                            │
│          ▼                   ▼                   │                            │
│  ┌─────────────────────────────────┐             │                           │
│  │       @agentlens/core           │             │                           │
│  │    Storage Interface Layer      │             │                           │
│  │                                 │             │                           │
│  │  ┌───────────┐ ┌─────────────┐  │             │                           │
│  │  │  SQLite   │ │ PostgreSQL  │  │             │                           │
│  │  │ (default) │ │  (team)     │  │             │                           │
│  │  └───────────┘ └─────────────┘  │             │                           │
│  └─────────────────────────────────┘             │                           │
│                                                  │                           │
│  ┌─────────────────────────────────────┐         │                           │
│  │       @agentlens/dashboard          │◄────────┘                           │
│  │     React SPA (Vite build)          │    SSE                              │
│  │                                     │                                     │
│  │  ┌──────────┐ ┌────────────────┐    │                                     │
│  │  │ Overview │ │ Session Detail │    │                                     │
│  │  │  Page    │ │   Timeline     │    │                                     │
│  │  ├──────────┤ ├────────────────┤    │                                     │
│  │  │ Events   │ │  Analytics     │    │                                     │
│  │  │ Explorer │ │  & Alerts      │    │                                     │
│  │  └──────────┘ └────────────────┘    │                                     │
│  └─────────────────────────────────────┘                                     │
└──────────────────────────────────────────────────────────────────────────────┘

External Integrations (via webhooks):
  ┌──────────┐  ┌────────────┐  ┌──────────────┐
  │AgentGate │  │ FormBridge │  │  Third-party │
  │ webhooks │  │  webhooks  │  │  webhooks    │
  └─────┬────┘  └─────┬──────┘  └──────┬───────┘
        │              │                │
        └──────────────┼────────────────┘
                       ▼
               POST /api/events/ingest
```

### 1.2 Data Flow

```
Agent Action
     │
     ▼
MCP Tool Call (agentlens_log_event)
     │
     ▼
@agentlens/mcp ─── HTTP POST ──► @agentlens/server
                                       │
                         ┌─────────────┼──────────────┐
                         ▼             ▼              ▼
                    Validate      Persist         SSE Broadcast
                    & Enrich      to Storage      to Dashboard
                         │             │
                         ▼             ▼
                    Assign ID    events table
                    Add hash     sessions table
                    Timestamp    (materialized)
```

### 1.3 Component Relationships

| Component | Depends On | Consumed By |
|-----------|-----------|-------------|
| `@agentlens/core` | — | All other packages |
| `@agentlens/mcp` | `@agentlens/core` | AI agent hosts |
| `@agentlens/server` | `@agentlens/core` | Dashboard, SDK, CLI, webhooks |
| `@agentlens/dashboard` | `@agentlens/core` | Browser (human users) |
| `@agentlens/sdk` | `@agentlens/core` | External applications |
| `@agentlens/cli` | `@agentlens/sdk` | Developers (terminal) |

---

## 2. Design Principles

### 2.1 Event Sourcing / Append-Only

All data in AgentLens is modeled as an immutable, append-only event log. There are no UPDATE or DELETE operations on the primary event store. This guarantees:

- **Complete audit trail** — Every action is recorded and retrievable
- **Temporal queries** — Reconstruct system state at any point in time
- **Tamper evidence** — Hash chain makes modifications detectable
- **Compliance** — Satisfies audit requirements for regulated industries

### 2.2 MCP-Native

AgentLens ships as an MCP server that agents add to their tool configuration. This means:

- **Zero code changes** in the agent — just add AgentLens to the MCP config
- **Works with any MCP client** — Claude Desktop, Cursor, custom agents
- **Natural integration** — Agents call `agentlens_log_event` like any other tool
- **Ecosystem alignment** — Follows the MCP standard, not a proprietary protocol

### 2.3 Interface-Based / Pluggable

All major subsystems are defined by TypeScript interfaces, not concrete implementations:

- Storage backends are pluggable (SQLite, PostgreSQL, future: S3, ClickHouse)
- Event processing pipeline supports middleware/plugins
- Dashboard components are composable and replaceable
- Integrations use a standard webhook format

### 2.4 Local-First, Cloud-Ready

- SQLite is the default — works out of the box, no external dependencies
- PostgreSQL is available for teams that need shared access
- The same codebase and API contract works in both modes
- Self-hosting is a first-class citizen, not an afterthought

### 2.5 Consistent with AgentKit Suite

- Same tech stack as AgentGate and FormBridge (TypeScript, Hono, React, Drizzle ORM)
- Same monorepo structure (pnpm workspaces)
- Same authentication pattern (API keys)
- Same MCP server pattern (StdioServerTransport)
- Shared event format for cross-product integration

---

## 3. Package Structure

### 3.1 Monorepo Layout

```
agentlens/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml       # pnpm workspace definition
├── tsconfig.json             # Base TypeScript config
├── vitest.workspace.ts       # Shared test config
├── .eslintrc.js
├── .prettierrc
├── .changeset/               # Changesets for versioning
│
├── packages/
│   ├── core/                 # @agentlens/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts           # Event types, enums, interfaces
│   │       ├── storage.ts         # IEventStore interface
│   │       ├── events.ts          # Event creation helpers, validation
│   │       ├── hash.ts            # Hash chain utilities
│   │       ├── schemas.ts         # Zod validation schemas
│   │       └── constants.ts       # Shared constants
│   │
│   ├── mcp/                  # @agentlens/mcp
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # MCP server entrypoint
│   │       ├── tools.ts           # Tool definitions & handlers
│   │       ├── session.ts         # Session management
│   │       └── transport.ts       # HTTP client for server comm
│   │
│   ├── server/               # @agentlens/server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # Hono app bootstrap
│   │       ├── config.ts          # Environment config
│   │       ├── db/
│   │       │   ├── index.ts       # DB dialect selector
│   │       │   ├── schema.ts      # Re-export (like AgentGate)
│   │       │   ├── schema.sqlite.ts
│   │       │   ├── schema.pg.ts
│   │       │   └── migrate.ts     # Migration runner
│   │       ├── routes/
│   │       │   ├── events.ts      # /api/events
│   │       │   ├── sessions.ts    # /api/sessions
│   │       │   ├── analytics.ts   # /api/analytics
│   │       │   ├── alerts.ts      # /api/alerts
│   │       │   ├── ingest.ts      # /api/events/ingest (webhooks)
│   │       │   ├── stream.ts      # /api/stream (SSE)
│   │       │   └── api-keys.ts    # /api/keys
│   │       ├── middleware/
│   │       │   ├── auth.ts        # API key verification
│   │       │   ├── cors.ts
│   │       │   └── rate-limit.ts
│   │       ├── lib/
│   │       │   ├── event-bus.ts   # In-process event bus (EventEmitter)
│   │       │   ├── sse.ts         # SSE connection manager
│   │       │   ├── retention.ts   # Retention policy engine
│   │       │   └── analytics.ts   # Aggregation queries
│   │       └── bootstrap.ts       # DB init, migrations
│   │
│   ├── dashboard/            # @agentlens/dashboard
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── tailwind.config.js
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── api/               # API client (fetch wrappers)
│   │       ├── hooks/             # React hooks (useEvents, useSSE, etc.)
│   │       ├── pages/
│   │       │   ├── Overview.tsx
│   │       │   ├── SessionDetail.tsx
│   │       │   ├── EventsExplorer.tsx
│   │       │   ├── Analytics.tsx
│   │       │   ├── Alerts.tsx
│   │       │   └── Settings.tsx
│   │       ├── components/
│   │       │   ├── Timeline.tsx
│   │       │   ├── EventCard.tsx
│   │       │   ├── SessionList.tsx
│   │       │   ├── MetricsGrid.tsx
│   │       │   ├── AlertRule.tsx
│   │       │   └── Layout.tsx
│   │       └── lib/
│   │           ├── sse.ts         # SSE client
│   │           └── format.ts      # Formatters (dates, durations, etc.)
│   │
│   ├── sdk/                  # @agentlens/sdk
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts         # AgentLensClient class
│   │       ├── errors.ts         # Typed errors
│   │       └── types.ts          # Re-exports from core
│   │
│   └── cli/                  # @agentlens/cli
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts           # CLI entrypoint (bin)
│           ├── commands/
│           │   ├── events.ts      # agentlens events [query]
│           │   ├── sessions.ts    # agentlens sessions [list|show]
│           │   ├── tail.ts        # agentlens tail (live stream)
│           │   ├── config.ts      # agentlens config [get|set]
│           │   └── export.ts      # agentlens export [format]
│           └── lib/
│               ├── output.ts      # Table/JSON formatters
│               └── config.ts      # Config file management
│
└── docs/                     # VitePress documentation
    ├── .vitepress/
    ├── index.md
    ├── guide/
    └── reference/
```

### 3.2 Package Dependencies

```json
// pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```
@agentlens/core        →  (no internal deps)
@agentlens/mcp         →  @agentlens/core
@agentlens/server      →  @agentlens/core
@agentlens/dashboard   →  @agentlens/core
@agentlens/sdk         →  @agentlens/core
@agentlens/cli         →  @agentlens/sdk
```

### 3.3 Build Configuration

All packages use `tsc` for compilation (consistent with AgentGate), with the dashboard using Vite for bundling. The root `package.json` scripts:

```json
{
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "dev": "pnpm --filter @agentlens/server --filter @agentlens/dashboard -r --parallel run dev",
    "lint": "eslint .",
    "typecheck": "pnpm -r run typecheck",
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs"
  }
}
```

---

## 4. Event Architecture

### 4.1 Core Event Types

```typescript
// packages/core/src/types.ts

/**
 * Unique identifier (ULID for time-sortability)
 */
export type EventId = string;

/**
 * ISO 8601 timestamp string
 */
export type Timestamp = string;

/**
 * All supported event types
 */
export type EventType =
  // Agent lifecycle
  | 'session_started'
  | 'session_ended'
  // Tool calls
  | 'tool_call'
  | 'tool_response'
  | 'tool_error'
  // Approval flow (from AgentGate)
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  // Form flow (from FormBridge)
  | 'form_submitted'
  | 'form_completed'
  | 'form_expired'
  // Cost tracking
  | 'cost_tracked'
  // Alerting
  | 'alert_triggered'
  | 'alert_resolved'
  // Custom / extension
  | 'custom';

/**
 * Severity levels for events
 */
export type EventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * The core event record — the fundamental unit of data in AgentLens
 */
export interface AgentLensEvent {
  /** ULID — unique, time-sortable identifier */
  id: EventId;

  /** ISO 8601 timestamp of when the event occurred */
  timestamp: Timestamp;

  /** Session this event belongs to */
  sessionId: string;

  /** Agent that produced this event */
  agentId: string;

  /** Type discriminator */
  eventType: EventType;

  /** Severity level */
  severity: EventSeverity;

  /** Event-type-specific payload (see typed payloads below) */
  payload: EventPayload;

  /** Arbitrary metadata (tags, labels, correlation IDs) */
  metadata: Record<string, unknown>;

  /** SHA-256 hash of previous event in session (hash chain) */
  prevHash: string | null;

  /** SHA-256 hash of this event (computed on ingest) */
  hash: string;
}

// ─── Typed Payloads ─────────────────────────────────────────────────

export interface ToolCallPayload {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  /** Correlation ID to match with tool_response/tool_error */
  callId: string;
}

export interface ToolResponsePayload {
  callId: string;
  toolName: string;
  result: unknown;
  durationMs: number;
}

export interface ToolErrorPayload {
  callId: string;
  toolName: string;
  error: string;
  errorCode?: string;
  durationMs: number;
}

export interface SessionStartedPayload {
  agentName?: string;
  agentVersion?: string;
  mcpClientInfo?: Record<string, unknown>;
  tags?: string[];
}

export interface SessionEndedPayload {
  reason: 'completed' | 'error' | 'timeout' | 'manual';
  summary?: string;
  totalToolCalls?: number;
  totalDurationMs?: number;
}

export interface ApprovalRequestedPayload {
  /** AgentGate request ID for cross-reference */
  requestId: string;
  action: string;
  params: Record<string, unknown>;
  urgency: string;
}

export interface ApprovalDecisionPayload {
  requestId: string;
  action: string;
  decidedBy: string;
  reason?: string;
}

export interface FormSubmittedPayload {
  /** FormBridge submission ID */
  submissionId: string;
  formId: string;
  formName?: string;
  fieldCount: number;
}

export interface FormCompletedPayload {
  submissionId: string;
  formId: string;
  completedBy: string;
  durationMs: number;
}

export interface CostTrackedPayload {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** What triggered this cost (tool call, completion, etc.) */
  trigger?: string;
}

export interface AlertTriggeredPayload {
  alertRuleId: string;
  alertName: string;
  condition: string;
  currentValue: number;
  threshold: number;
  message: string;
}

export interface AlertResolvedPayload {
  alertRuleId: string;
  alertName: string;
  resolvedBy?: string;
}

export interface CustomPayload {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Discriminated union of all payload types
 */
export type EventPayload =
  | ToolCallPayload
  | ToolResponsePayload
  | ToolErrorPayload
  | SessionStartedPayload
  | SessionEndedPayload
  | ApprovalRequestedPayload
  | ApprovalDecisionPayload
  | FormSubmittedPayload
  | FormCompletedPayload
  | CostTrackedPayload
  | AlertTriggeredPayload
  | AlertResolvedPayload
  | CustomPayload;

// ─── Session & Agent ────────────────────────────────────────────────

/**
 * Agent session — materialized from session_started/session_ended events
 */
export interface Session {
  id: string;
  agentId: string;
  agentName?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: 'active' | 'completed' | 'error';
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  totalCostUsd: number;
  tags: string[];
}

/**
 * Registered agent
 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  sessionCount: number;
}

// ─── Query Types ────────────────────────────────────────────────────

export interface EventQuery {
  sessionId?: string;
  agentId?: string;
  eventType?: EventType | EventType[];
  severity?: EventSeverity | EventSeverity[];
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  /** Sort direction (default: desc — newest first) */
  order?: 'asc' | 'desc';
  /** Full-text search on payload */
  search?: string;
}

export interface EventQueryResult {
  events: AgentLensEvent[];
  total: number;
  hasMore: boolean;
}

export interface SessionQuery {
  agentId?: string;
  status?: Session['status'];
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  tags?: string[];
}

// ─── Alert Rules ────────────────────────────────────────────────────

export type AlertCondition =
  | 'error_rate_exceeds'
  | 'cost_exceeds'
  | 'latency_exceeds'
  | 'event_count_exceeds'
  | 'no_events_for';

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: AlertCondition;
  threshold: number;
  windowMinutes: number;
  /** Scope: all agents, specific agent, specific session tag */
  scope: {
    agentId?: string;
    tags?: string[];
  };
  /** Notification channels (webhook URLs, email, etc.) */
  notifyChannels: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.2 Event Validation (Zod Schemas)

```typescript
// packages/core/src/schemas.ts
import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'session_started', 'session_ended',
  'tool_call', 'tool_response', 'tool_error',
  'approval_requested', 'approval_granted', 'approval_denied', 'approval_expired',
  'form_submitted', 'form_completed', 'form_expired',
  'cost_tracked',
  'alert_triggered', 'alert_resolved',
  'custom',
]);

export const severitySchema = z.enum(['debug', 'info', 'warn', 'error', 'critical']);

export const ingestEventSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  eventType: eventTypeSchema,
  severity: severitySchema.default('info'),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({}),
  /** Optional client-side timestamp; server will validate and may override */
  timestamp: z.string().datetime().optional(),
});

export type IngestEventInput = z.infer<typeof ingestEventSchema>;
```

### 4.3 Hash Chain

Each event's `hash` field is computed as:

```typescript
// packages/core/src/hash.ts
import { createHash } from 'node:crypto';

export function computeEventHash(event: {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  payload: unknown;
  prevHash: string | null;
}): string {
  const canonical = JSON.stringify({
    id: event.id,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    agentId: event.agentId,
    eventType: event.eventType,
    payload: event.payload,
    prevHash: event.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyChain(events: { hash: string; prevHash: string | null }[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (events[i].prevHash !== events[i - 1].hash) {
      return false;
    }
  }
  return true;
}
```

### 4.4 Event Flow Diagram

```
┌──────────┐     ┌──────────────┐     ┌────────────────────┐
│  Agent   │────▶│ @agentlens/  │────▶│  @agentlens/server │
│  (MCP)   │     │    mcp       │     │                    │
└──────────┘     └──────────────┘     │  1. Validate (Zod) │
                                      │  2. Assign ULID    │
  ┌──────────┐                        │  3. Compute hash   │
  │AgentGate │───webhook──────────▶   │  4. Persist to DB  │
  └──────────┘                        │  5. Emit to bus    │
                                      │                    │
  ┌──────────┐                        │     EventBus       │
  │FormBridge│───webhook──────────▶   │       │            │
  └──────────┘                        └───────┼────────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                               ┌────────┐ ┌──────┐ ┌─────────┐
                               │  SSE   │ │Alert │ │Analytics│
                               │Clients │ │Engine│ │Updater  │
                               └────────┘ └──────┘ └─────────┘
```

---

## 5. MCP Server Design

### 5.1 Approach Evaluation

Two approaches were evaluated for the MCP server. See [ADR-001](#adr-001-mcp-dedicated-tools-vs-proxy-pattern) for full analysis.

**Approach A: Proxy Pattern** — AgentLens sits between the agent and downstream MCP servers, intercepting all tool calls transparently.

**Approach B: Dedicated Tools** — AgentLens exposes its own MCP tools (`agentlens_log_event`, etc.) that agents call explicitly.

**Decision: Approach B — Dedicated Tools** (with a hybrid path for future proxy support).

### 5.2 MCP Server Implementation

```typescript
// packages/mcp/src/tools.ts
import { type Tool } from '@modelcontextprotocol/sdk/types.js';

export const toolDefinitions: Tool[] = [
  {
    name: 'agentlens_session_start',
    description: 'Start a new observability session. Call this at the beginning of a task. Returns a sessionId to use in subsequent calls.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Unique identifier for this agent',
        },
        agentName: {
          type: 'string',
          description: 'Human-readable name for this agent',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to categorize this session',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'agentlens_log_event',
    description:
      'Log an event to the AgentLens observability timeline. Use this to record tool calls, decisions, errors, costs, or any notable action.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID from agentlens_session_start',
        },
        eventType: {
          type: 'string',
          enum: [
            'tool_call', 'tool_response', 'tool_error',
            'cost_tracked', 'custom',
          ],
          description: 'Type of event to log',
        },
        severity: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error', 'critical'],
          description: 'Event severity (default: info)',
        },
        payload: {
          type: 'object',
          description: 'Event-specific data',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata (tags, correlation IDs, etc.)',
        },
      },
      required: ['sessionId', 'eventType', 'payload'],
    },
  },
  {
    name: 'agentlens_session_end',
    description: 'End an observability session. Call this when the task is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID to end',
        },
        reason: {
          type: 'string',
          enum: ['completed', 'error', 'timeout', 'manual'],
          description: 'Why the session ended',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what happened in this session',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'agentlens_query_events',
    description: 'Query logged events. Useful for agents that need to review their own history or check for patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Filter by session',
        },
        eventType: {
          type: 'string',
          description: 'Filter by event type',
        },
        limit: {
          type: 'number',
          description: 'Max events to return (default: 50)',
        },
      },
    },
  },
];
```

### 5.3 MCP Server Entrypoint

```typescript
// packages/mcp/src/index.ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, handleToolCall } from './tools.js';

interface McpConfig {
  serverUrl: string;
  apiKey: string;
}

const config: McpConfig = {
  serverUrl: process.env.AGENTLENS_URL ?? 'http://localhost:3400',
  apiKey: process.env.AGENTLENS_API_KEY ?? '',
};

const server = new Server(
  { name: 'agentlens', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(config, name, args ?? {});
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentLens MCP server running');
}

main().catch(console.error);
```

### 5.4 Agent Configuration Example

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlens/mcp"],
      "env": {
        "AGENTLENS_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_xxxxxxxxxxxx"
      }
    }
  }
}
```

---

## 6. Storage Layer

### 6.1 Storage Interface

```typescript
// packages/core/src/storage.ts
import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  AlertRule,
  IngestEventInput,
} from './types.js';

/**
 * Core storage interface — all backends implement this
 */
export interface IEventStore {
  // ─── Events ──────────────────────────────────────────────
  /** Persist one or more events (already validated & hashed) */
  insertEvents(events: AgentLensEvent[]): Promise<void>;
  /** Query events with filters */
  queryEvents(query: EventQuery): Promise<EventQueryResult>;
  /** Get a single event by ID */
  getEvent(id: string): Promise<AgentLensEvent | null>;
  /** Get all events in a session, ordered by timestamp */
  getSessionTimeline(sessionId: string): Promise<AgentLensEvent[]>;
  /** Count events matching a query (for pagination) */
  countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number>;

  // ─── Sessions ────────────────────────────────────────────
  /** Upsert session (materialized from events) */
  upsertSession(session: Partial<Session> & { id: string }): Promise<void>;
  /** Query sessions */
  querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }>;
  /** Get a single session by ID */
  getSession(id: string): Promise<Session | null>;

  // ─── Agents ──────────────────────────────────────────────
  /** Upsert agent (materialized from events) */
  upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void>;
  /** List all agents */
  listAgents(): Promise<Agent[]>;
  /** Get agent by ID */
  getAgent(id: string): Promise<Agent | null>;

  // ─── Analytics ───────────────────────────────────────────
  /** Get aggregated metrics for a time range */
  getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
  }): Promise<AnalyticsResult>;

  // ─── Alert Rules ─────────────────────────────────────────
  /** CRUD for alert rules */
  createAlertRule(rule: AlertRule): Promise<void>;
  updateAlertRule(id: string, updates: Partial<AlertRule>): Promise<void>;
  deleteAlertRule(id: string): Promise<void>;
  listAlertRules(): Promise<AlertRule[]>;
  getAlertRule(id: string): Promise<AlertRule | null>;

  // ─── Maintenance ─────────────────────────────────────────
  /** Apply retention policy — delete events older than given date */
  applyRetention(olderThan: string): Promise<{ deletedCount: number }>;
  /** Get storage statistics */
  getStats(): Promise<StorageStats>;
}

export interface AnalyticsResult {
  buckets: Array<{
    timestamp: string;
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    uniqueSessions: number;
  }>;
  totals: {
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    uniqueSessions: number;
    uniqueAgents: number;
  };
}

export interface StorageStats {
  totalEvents: number;
  totalSessions: number;
  totalAgents: number;
  oldestEvent?: string;
  newestEvent?: string;
  storageSizeBytes?: number;
}
```

### 6.2 SQLite Schema (Drizzle ORM)

```typescript
// packages/server/src/db/schema.sqlite.ts
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ─── Events Table ──────────────────────────────────────────
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),                              // ULID
  timestamp: text('timestamp').notNull(),                   // ISO 8601
  sessionId: text('session_id').notNull(),
  agentId: text('agent_id').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  payload: text('payload').notNull(),                       // JSON
  metadata: text('metadata').notNull().default('{}'),       // JSON
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
});

// Events indexes — optimized for common query patterns
export const idxEventsTimestamp = index('idx_events_timestamp')
  .on(events.timestamp);
export const idxEventsSessionId = index('idx_events_session_id')
  .on(events.sessionId);
export const idxEventsAgentId = index('idx_events_agent_id')
  .on(events.agentId);
export const idxEventsType = index('idx_events_type')
  .on(events.eventType);
export const idxEventsSessionTimestamp = index('idx_events_session_ts')
  .on(events.sessionId, events.timestamp);
// Composite index for the most common dashboard query:
// "recent events for agent X of type Y"
export const idxEventsAgentTypeTs = index('idx_events_agent_type_ts')
  .on(events.agentId, events.eventType, events.timestamp);

// ─── Sessions Table (materialized) ────────────────────────
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name'),
  startedAt: text('started_at').notNull(),                  // ISO 8601
  endedAt: text('ended_at'),
  status: text('status', {
    enum: ['active', 'completed', 'error'],
  }).notNull().default('active'),
  eventCount: integer('event_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  tags: text('tags').notNull().default('[]'),               // JSON array
});

export const idxSessionsAgentId = index('idx_sessions_agent_id')
  .on(sessions.agentId);
export const idxSessionsStartedAt = index('idx_sessions_started_at')
  .on(sessions.startedAt);
export const idxSessionsStatus = index('idx_sessions_status')
  .on(sessions.status);

// ─── Agents Table (materialized) ──────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  sessionCount: integer('session_count').notNull().default(0),
});

// ─── Alert Rules Table ────────────────────────────────────
export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  condition: text('condition').notNull(),
  threshold: real('threshold').notNull(),
  windowMinutes: integer('window_minutes').notNull(),
  scope: text('scope').notNull().default('{}'),              // JSON
  notifyChannels: text('notify_channels').notNull().default('[]'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Alert History ────────────────────────────────────────
export const alertHistory = sqliteTable('alert_history', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull().references(() => alertRules.id),
  triggeredAt: text('triggered_at').notNull(),
  resolvedAt: text('resolved_at'),
  currentValue: real('current_value').notNull(),
  threshold: real('threshold').notNull(),
  message: text('message').notNull(),
});

export const idxAlertHistoryRuleId = index('idx_alert_history_rule_id')
  .on(alertHistory.ruleId);

// ─── API Keys ─────────────────────────────────────────────
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  name: text('name').notNull(),
  scopes: text('scopes').notNull(),                          // JSON array
  createdAt: integer('created_at').notNull(),                // unix timestamp
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at'),
  rateLimit: integer('rate_limit'),
});

export const idxApiKeysHash = index('idx_api_keys_hash')
  .on(apiKeys.keyHash);
```

### 6.3 PostgreSQL Schema

```typescript
// packages/server/src/db/schema.pg.ts
import { pgTable, text, integer, real, timestamp, index, jsonb } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  sessionId: text('session_id').notNull(),
  agentId: text('agent_id').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  payload: jsonb('payload').notNull(),                   // Native JSONB
  metadata: jsonb('metadata').notNull().default({}),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
});

// PostgreSQL gets the same indexes plus GIN index on payload for JSON queries
export const idxEventsPgPayload = index('idx_events_payload')
  .on(events.payload)
  .using('gin');

// ... (sessions, agents, alert_rules — identical structure, pg types)
```

### 6.4 Schema Selection (Runtime)

```typescript
// packages/server/src/db/index.ts
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import pg from 'pg';
import { getConfig } from '../config.js';

export function createDb() {
  const config = getConfig();

  if (config.dbDialect === 'postgresql') {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    return drizzlePg(pool);
  }

  // Default: SQLite
  const sqlite = new Database(config.databasePath ?? 'agentlens.db');
  sqlite.pragma('journal_mode = WAL');       // Better concurrent read performance
  sqlite.pragma('synchronous = NORMAL');     // Good durability/performance balance
  sqlite.pragma('cache_size = -64000');      // 64MB cache
  sqlite.pragma('busy_timeout = 5000');      // 5s wait on locks
  return drizzleSqlite(sqlite);
}
```

### 6.5 Retention Policies

```typescript
// packages/server/src/lib/retention.ts

export interface RetentionPolicy {
  /** Keep events for this many days (0 = keep forever) */
  retentionDays: number;
  /** Archive to file before deleting (SQLite only) */
  archiveBeforeDelete: boolean;
  /** Archive path pattern (e.g., "./archives/events-{date}.db") */
  archivePath?: string;
}

const DEFAULT_POLICY: RetentionPolicy = {
  retentionDays: 90,
  archiveBeforeDelete: false,
};
```

Retention is enforced by a daily cron job (configurable interval) that calls `IEventStore.applyRetention()`.

---

## 7. API Design

### 7.1 REST API Routes

All routes are prefixed with `/api` and served by Hono.

#### Events

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events` | Query events with filters |
| `GET` | `/api/events/:id` | Get a single event by ID |
| `POST` | `/api/events` | Ingest one or more events |
| `POST` | `/api/events/ingest` | Webhook ingestion (AgentGate, FormBridge, generic) |

**GET /api/events** — Query parameters:

```
sessionId?:  string     — Filter by session
agentId?:    string     — Filter by agent
eventType?:  string     — Filter by type (comma-separated for multiple)
severity?:   string     — Filter by severity (comma-separated)
from?:       string     — ISO 8601 start timestamp
to?:         string     — ISO 8601 end timestamp
search?:     string     — Full-text search on payload
limit?:      number     — Results per page (default: 50, max: 500)
offset?:     number     — Pagination offset
order?:      asc|desc   — Sort order (default: desc)
```

Response:

```json
{
  "events": [{ "id": "01HXY...", "timestamp": "...", ... }],
  "total": 1234,
  "hasMore": true
}
```

**POST /api/events** — Ingest events:

```json
{
  "events": [
    {
      "sessionId": "sess_abc123",
      "agentId": "agent_main",
      "eventType": "tool_call",
      "severity": "info",
      "payload": {
        "toolName": "web_search",
        "arguments": { "query": "weather today" },
        "callId": "call_xyz"
      },
      "metadata": { "source": "mcp" }
    }
  ]
}
```

Response:

```json
{
  "ingested": 1,
  "events": [{ "id": "01HXY...", "hash": "a3f2..." }]
}
```

#### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List sessions with filters |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/timeline` | Get full session timeline |
| `GET` | `/api/sessions/:id/summary` | Get session summary & stats |

**GET /api/sessions/:id/timeline** — Returns the complete decision timeline:

```json
{
  "session": {
    "id": "sess_abc123",
    "agentId": "agent_main",
    "startedAt": "2026-02-07T10:00:00Z",
    "status": "completed",
    "eventCount": 42,
    "totalCostUsd": 0.15
  },
  "timeline": [
    {
      "id": "01HXY001...",
      "timestamp": "2026-02-07T10:00:00Z",
      "eventType": "session_started",
      "severity": "info",
      "payload": { "agentName": "Research Agent", "tags": ["research"] },
      "hash": "a3f2..."
    },
    {
      "id": "01HXY002...",
      "timestamp": "2026-02-07T10:00:01Z",
      "eventType": "tool_call",
      "severity": "info",
      "payload": { "toolName": "web_search", "callId": "call_1", "arguments": {} },
      "hash": "b4c3..."
    }
  ],
  "chainValid": true
}
```

#### Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/analytics` | Aggregated metrics |
| `GET` | `/api/analytics/agents` | Per-agent breakdown |
| `GET` | `/api/analytics/tools` | Tool usage statistics |
| `GET` | `/api/analytics/costs` | Cost breakdown over time |

**GET /api/analytics** — Query parameters:

```
from?:         string     — ISO 8601 start (default: 24h ago)
to?:           string     — ISO 8601 end (default: now)
agentId?:      string     — Filter by agent
granularity?:  hour|day|week  — Bucket size (default: hour)
```

#### Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts` | List active alerts |
| `GET` | `/api/alerts/rules` | List alert rules |
| `POST` | `/api/alerts/rules` | Create alert rule |
| `PUT` | `/api/alerts/rules/:id` | Update alert rule |
| `DELETE` | `/api/alerts/rules/:id` | Delete alert rule |
| `GET` | `/api/alerts/history` | Alert trigger history |

#### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/keys` | Create API key |
| `GET` | `/api/keys` | List API keys |
| `DELETE` | `/api/keys/:id` | Revoke API key |

#### Health & Meta

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/stats` | Storage statistics |

### 7.2 SSE Endpoint

```
GET /api/stream
```

Query parameters:
```
sessionId?:  string   — Subscribe to specific session events
agentId?:    string   — Subscribe to specific agent events
eventType?:  string   — Filter event types (comma-separated)
```

SSE message format:

```
event: event
data: {"id":"01HXY...","eventType":"tool_call","sessionId":"sess_abc",...}

event: session_update
data: {"id":"sess_abc","status":"active","eventCount":15,...}

event: alert
data: {"ruleId":"rule_1","name":"High error rate","currentValue":0.15,...}

event: heartbeat
data: {"time":"2026-02-07T10:00:00Z"}
```

### 7.3 Hono Server Setup

```typescript
// packages/server/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/serve-static';
import { eventsRouter } from './routes/events.js';
import { sessionsRouter } from './routes/sessions.js';
import { analyticsRouter } from './routes/analytics.js';
import { alertsRouter } from './routes/alerts.js';
import { streamRouter } from './routes/stream.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { authMiddleware } from './middleware/auth.js';
import { bootstrap } from './bootstrap.js';
import { getConfig } from './config.js';

const app = new Hono();
const config = getConfig();

// Global middleware
app.use('*', logger());
app.use('/api/*', cors({ origin: config.corsOrigin ?? '*' }));
app.use('/api/*', authMiddleware());

// API routes
app.route('/api/events', eventsRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/analytics', analyticsRouter);
app.route('/api/alerts', alertsRouter);
app.route('/api/stream', streamRouter);
app.route('/api/keys', apiKeysRouter);

// Health (no auth)
app.get('/api/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Serve dashboard (production)
app.use('/*', serveStatic({ root: './public' }));
app.get('/*', serveStatic({ path: './public/index.html' }));

// Bootstrap and start
await bootstrap();
export default app;
```

### 7.4 Webhook Ingestion

The `/api/events/ingest` endpoint accepts events from external systems using a standard webhook format:

```typescript
// packages/server/src/routes/ingest.ts

/**
 * Generic webhook ingestion.
 * Transforms incoming webhooks from AgentGate, FormBridge, or generic sources
 * into AgentLensEvents.
 */

interface WebhookPayload {
  source: 'agentgate' | 'formbridge' | 'generic';
  event: string;           // e.g., "request.approved", "submission.completed"
  data: Record<string, unknown>;
  timestamp?: string;
}

// AgentGate webhook → AgentLens event mapping:
// "request.created"   → approval_requested
// "request.approved"  → approval_granted
// "request.denied"    → approval_denied
// "request.expired"   → approval_expired

// FormBridge webhook → AgentLens event mapping:
// "submission.created"   → form_submitted
// "submission.completed" → form_completed
// "submission.expired"   → form_expired
```

---

## 8. Dashboard Architecture

### 8.1 Page Structure

```
┌─────────────────────────────────────────────┐
│  AgentLens Dashboard                         │
│                                              │
│  ┌──────────┐                               │
│  │ Sidebar  │  ┌────────────────────────┐   │
│  │          │  │                        │   │
│  │ Overview │  │    Main Content Area    │   │
│  │ Sessions │  │                        │   │
│  │ Events   │  │    (per-page content)  │   │
│  │ Analytics│  │                        │   │
│  │ Alerts   │  │                        │   │
│  │ Settings │  │                        │   │
│  │          │  │                        │   │
│  └──────────┘  └────────────────────────┘   │
│                                              │
└─────────────────────────────────────────────┘
```

### 8.2 Pages

| Page | Route | Description |
|------|-------|-------------|
| **Overview** | `/` | Real-time activity feed, key metrics (events/min, active sessions, error rate, total cost today), agent status grid |
| **Sessions** | `/sessions` | Filterable list of agent sessions with status, duration, event count, cost |
| **Session Detail** | `/sessions/:id` | Full session timeline (vertical timeline), event details, hash chain verification, cost breakdown |
| **Events Explorer** | `/events` | Advanced event table with filtering, full-text search, JSON payload viewer, export |
| **Analytics** | `/analytics` | Charts: events over time, tool usage breakdown, error rates, cost trends, latency percentiles |
| **Alerts** | `/alerts` | Active alerts, alert rule management (CRUD), alert history |
| **Settings** | `/settings` | API key management, retention policy, integration config, appearance |

### 8.3 Real-Time Updates

```typescript
// packages/dashboard/src/hooks/useSSE.ts
import { useState, useEffect, useRef } from 'react';

interface UseSSEOptions {
  url: string;
  params?: Record<string, string>;
  onEvent?: (event: MessageEvent) => void;
}

export function useSSE({ url, params, onEvent }: UseSSEOptions) {
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(params);
    const fullUrl = `${url}?${searchParams.toString()}`;
    const source = new EventSource(fullUrl);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => {
      setConnected(false);
      // Auto-reconnect is built into EventSource
    };

    source.addEventListener('event', (e) => onEvent?.(e));
    source.addEventListener('session_update', (e) => onEvent?.(e));
    source.addEventListener('alert', (e) => onEvent?.(e));

    return () => {
      source.close();
      setConnected(false);
    };
  }, [url, JSON.stringify(params)]);

  return { connected };
}
```

### 8.4 Key Components

**Timeline Component** — The centerpiece of session detail:

```tsx
// packages/dashboard/src/components/Timeline.tsx
interface TimelineProps {
  events: AgentLensEvent[];
  chainValid: boolean;
}

// Renders a vertical timeline with:
// - Time markers on the left
// - Event cards on the right
// - Color-coded by event type (green=success, red=error, blue=info, yellow=warning)
// - Expandable payload viewer (JSON tree)
// - Duration markers between tool_call → tool_response pairs
// - Hash chain status indicator (✓ valid / ✗ broken)
```

**MetricsGrid** — Overview dashboard widgets:

```tsx
// packages/dashboard/src/components/MetricsGrid.tsx
interface MetricCard {
  label: string;
  value: string | number;
  change?: number;     // Percentage change from previous period
  trend?: 'up' | 'down' | 'flat';
  icon?: React.ReactNode;
}

// Displays: Events Today, Active Sessions, Error Rate, Total Cost, Avg Latency
```

### 8.5 Technology Choices

- **React 18** with functional components and hooks
- **React Router v6** for client-side routing
- **Tailwind CSS** for styling (consistent with AgentGate dashboard)
- **Vite** for development and bundling
- **Recharts** or **lightweight charting** for analytics (no heavy deps)
- **date-fns** for timestamp formatting

The dashboard is built as a static SPA and served by the Hono server from the `public/` directory.

---

## 9. Integration Architecture

### 9.1 AgentGate Integration

```
┌──────────────┐                    ┌──────────────┐
│  AgentGate   │   Webhook POST     │  AgentLens   │
│  Server      │ ──────────────────▶│  Server      │
│              │  /api/events/ingest│              │
│  Events:     │                    │  Maps to:    │
│  request.*   │                    │  approval_*  │
└──────────────┘                    └──────────────┘
```

**Configuration in AgentGate:**

```json
// AgentGate webhook config
{
  "url": "http://localhost:3400/api/events/ingest",
  "secret": "webhook_secret_xxx",
  "events": ["request.created", "request.approved", "request.denied", "request.expired"]
}
```

**Event Mapping:**

| AgentGate Event | AgentLens EventType | Key Fields Mapped |
|----------------|--------------------|--------------------|
| `request.created` | `approval_requested` | requestId, action, params, urgency |
| `request.approved` | `approval_granted` | requestId, decidedBy, reason |
| `request.denied` | `approval_denied` | requestId, decidedBy, reason |
| `request.expired` | `approval_expired` | requestId |

The `sessionId` and `agentId` are extracted from the webhook payload's context field (AgentGate requests include an optional `context` object where agents can store the AgentLens session ID).

### 9.2 FormBridge Integration

```
┌──────────────┐                    ┌──────────────┐
│  FormBridge  │   Webhook POST     │  AgentLens   │
│  Server      │ ──────────────────▶│  Server      │
│              │  /api/events/ingest│              │
│  Events:     │                    │  Maps to:    │
│  submission.*│                    │  form_*      │
└──────────────┘                    └──────────────┘
```

**Event Mapping:**

| FormBridge Event | AgentLens EventType | Key Fields |
|-----------------|--------------------|-----------  |
| `submission.created` | `form_submitted` | submissionId, formId, fieldCount |
| `submission.completed` | `form_completed` | submissionId, completedBy, durationMs |
| `submission.expired` | `form_expired` | submissionId |

### 9.3 Generic Webhook Format

Third-party integrations can send events using this standard format:

```json
POST /api/events/ingest
Content-Type: application/json
X-Webhook-Secret: xxx

{
  "source": "generic",
  "sessionId": "optional-session-id",
  "agentId": "optional-agent-id",
  "events": [
    {
      "eventType": "custom",
      "severity": "info",
      "payload": {
        "type": "deployment",
        "data": { "service": "api", "version": "1.2.3" }
      },
      "metadata": { "environment": "production" }
    }
  ]
}
```

### 9.4 Shared Event Format (AgentKit Cross-Product)

All three AgentKit products can share a common event envelope for correlation:

```typescript
interface AgentKitEvent {
  /** Source product */
  source: 'agentlens' | 'agentgate' | 'formbridge';
  /** Event type (product-specific) */
  event: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Correlation IDs for cross-product tracing */
  correlation: {
    sessionId?: string;
    agentId?: string;
    requestId?: string;      // AgentGate request
    submissionId?: string;   // FormBridge submission
  };
  /** Event-specific data */
  data: Record<string, unknown>;
}
```

---

## 10. Security

### 10.1 Authentication

**API Key Authentication** (consistent with AgentGate):

```typescript
// packages/server/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { createHash } from 'node:crypto';

export function authMiddleware() {
  return createMiddleware(async (c, next) => {
    // Skip auth for health check
    if (c.req.path === '/api/health') return next();
    
    // Skip auth if no keys are configured (development mode)
    const config = getConfig();
    if (config.authDisabled) return next();

    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing API key' }, 401);
    }

    const key = header.slice(7);
    const keyHash = createHash('sha256').update(key).digest('hex');
    
    const apiKey = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash),
    });

    if (!apiKey || apiKey.revokedAt) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    // Update last used timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
      .where(eq(apiKeys.id, apiKey.id))
      .execute()
      .catch(() => {});

    // Attach key info to context for scope checking
    c.set('apiKey', apiKey);
    return next();
  });
}
```

**API Key Format:** `als_` prefix followed by 32 random hex characters (e.g., `als_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`).

### 10.2 Webhook Verification

Incoming webhooks from AgentGate/FormBridge are verified using HMAC-SHA256:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### 10.3 Data Protection

- **Hash chain integrity** — Every event is part of a per-session hash chain. Tampering with any event invalidates the chain for that session. The dashboard shows chain verification status.
- **Append-only enforcement** — The API has no UPDATE or DELETE endpoints for events. Retention cleanup is the only path for event deletion, and it's audited.
- **Sensitive data** — Event payloads may contain sensitive data (tool arguments, API responses). AgentLens provides:
  - Configurable payload redaction rules (regex patterns for secrets, PII)
  - Optional encryption at rest for the payload column (AES-256-GCM with a server-managed key)

### 10.4 RBAC (Future)

The API key scopes field supports future role-based access:

```typescript
type ApiKeyScope =
  | 'events:read'
  | 'events:write'
  | 'sessions:read'
  | 'analytics:read'
  | 'alerts:read'
  | 'alerts:write'
  | 'keys:manage'
  | 'admin';
```

For MVP, all keys have full access. Scope enforcement is added in a later release.

---

## 11. Performance Considerations

### 11.1 Ingestion Performance

**Target: 1,000+ events/sec sustained ingestion**

SQLite with WAL mode can handle 10,000+ inserts/sec on modern hardware. Key optimizations:

1. **Batch inserts** — The `POST /api/events` endpoint accepts arrays. The MCP server batches events and flushes periodically (configurable, default: every 100ms or 50 events).

2. **WAL mode** — SQLite's Write-Ahead Logging allows concurrent reads while writing. Critical for simultaneous dashboard queries + event ingestion.

3. **Prepared statements** — All SQL is prepared once and reused.

4. **Async event bus** — After persistence, the event bus emits asynchronously. SSE broadcast and alert evaluation don't block the ingest response.

```typescript
// packages/server/src/lib/event-bus.ts
import { EventEmitter } from 'node:events';

class AgentLensEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(1000); // Support many SSE clients
  }

  emitEvent(event: AgentLensEvent): void {
    this.emit('event', event);
    this.emit(`session:${event.sessionId}`, event);
    this.emit(`agent:${event.agentId}`, event);
  }
}

export const eventBus = new AgentLensEventBus();
```

### 11.2 Query Performance

**Target: < 200ms for recent event queries**

1. **Composite indexes** — The `idx_events_agent_type_ts` index covers the most common dashboard query pattern.

2. **Materialized sessions** — Session aggregates (event count, error count, cost) are maintained incrementally on each event insert, avoiding expensive GROUP BY queries.

3. **Pagination** — All list endpoints use offset/limit pagination. Large result sets are never loaded in full.

4. **Time-range partitioning** — Queries always include a time range (enforced by the API — default window is last 24 hours). This keeps index scans bounded.

5. **SQLite cache** — 64MB page cache keeps hot data in memory.

### 11.3 SSE Fan-Out

```typescript
// packages/server/src/lib/sse.ts
import type { Context } from 'hono';
import { eventBus } from './event-bus.js';

export function createSSEStream(c: Context, filters: {
  sessionId?: string;
  agentId?: string;
  eventTypes?: string[];
}) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      const send = (eventName: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        send('heartbeat', { time: new Date().toISOString() });
      }, 30_000);

      // Subscribe to event bus with filters
      const handler = (event: AgentLensEvent) => {
        if (filters.sessionId && event.sessionId !== filters.sessionId) return;
        if (filters.agentId && event.agentId !== filters.agentId) return;
        if (filters.eventTypes?.length && !filters.eventTypes.includes(event.eventType)) return;
        send('event', event);
      };

      eventBus.on('event', handler);

      // Cleanup on disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        eventBus.off('event', handler);
        controller.close();
      });
    },
  });
}
```

### 11.4 Performance Budget

| Operation | Target | Notes |
|-----------|--------|-------|
| Single event ingest | < 2ms | SQLite WAL, prepared statement |
| Batch ingest (100 events) | < 50ms | Transaction batched |
| Recent events query (50 results) | < 50ms | Indexed, bounded time range |
| Session timeline (500 events) | < 100ms | Session index + timestamp |
| Analytics (24h, hourly) | < 200ms | Bounded aggregation |
| SSE event delivery | < 10ms | In-process event bus |
| Dashboard initial load | < 1s | Static SPA + initial data fetch |

---

## 12. Technology Stack

### 12.1 Complete Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| **Runtime** | Node.js | ≥ 20 | LTS |
| **Language** | TypeScript | ≥ 5.7 | Strict mode |
| **HTTP Framework** | Hono | ^4.x | Consistent with AgentGate |
| **Frontend** | React | ^18.x | Functional components |
| **Frontend Build** | Vite | ^6.x | |
| **Frontend Styling** | Tailwind CSS | ^3.x | Consistent with AgentGate |
| **Frontend Routing** | React Router | ^6.x | |
| **ORM** | Drizzle ORM | ^0.39.x | Schema-first, type-safe |
| **SQLite** | better-sqlite3 | ^11.x | Synchronous, fast |
| **PostgreSQL** | pg | ^8.x | Node.js Postgres driver |
| **MCP SDK** | @modelcontextprotocol/sdk | ^1.x | Official SDK |
| **ID Generation** | ulid | ^2.x | Time-sortable unique IDs |
| **Validation** | Zod | ^3.x | Runtime schema validation |
| **Package Manager** | pnpm | ^9.x | Workspace support |
| **Build** | tsc | (TypeScript) | All packages except dashboard |
| **Testing** | Vitest | ^2.x | |
| **Linting** | ESLint | ^9.x | Flat config |
| **Formatting** | Prettier | ^3.x | |
| **Versioning** | Changesets | ^2.x | |
| **Documentation** | VitePress | ^1.x | |
| **CLI Framework** | Commander.js | ^12.x | For @agentlens/cli |
| **Charting** | Recharts (or lightweight alternative) | | For analytics page |

### 12.2 Development Tools

```json
// Root devDependencies
{
  "@changesets/cli": "^2.29.x",
  "@eslint/js": "^9.x",
  "@types/node": "^22.x",
  "@vitest/coverage-v8": "^2.x",
  "eslint": "^9.x",
  "prettier": "^3.x",
  "typescript": "^5.7.x",
  "typescript-eslint": "^8.x",
  "vitepress": "^1.x"
}
```

### 12.3 Environment Configuration

```typescript
// packages/server/src/config.ts
export interface AgentLensConfig {
  // Server
  port: number;                    // PORT, default: 3400
  host: string;                    // HOST, default: '0.0.0.0'
  corsOrigin: string;              // CORS_ORIGIN, default: '*'

  // Database
  dbDialect: 'sqlite' | 'postgresql';  // DB_DIALECT, default: 'sqlite'
  databasePath: string;                  // DATABASE_PATH, default: './agentlens.db'
  databaseUrl: string;                   // DATABASE_URL (for PostgreSQL)

  // Auth
  authDisabled: boolean;           // AUTH_DISABLED, default: false (true in dev)

  // Retention
  retentionDays: number;           // RETENTION_DAYS, default: 90

  // Alerts
  alertCheckIntervalMs: number;    // ALERT_CHECK_INTERVAL_MS, default: 60000

  // Integrations
  agentgateWebhookSecret: string;  // AGENTGATE_WEBHOOK_SECRET
  formbridgeWebhookSecret: string; // FORMBRIDGE_WEBHOOK_SECRET
}
```

---

## 13. Architecture Decision Records

### ADR-001: MCP Dedicated Tools vs Proxy Pattern

**Status:** Accepted  
**Date:** 2026-02-07

**Context:**  
AgentLens needs to capture events from AI agents via MCP. Two approaches exist:

- **Proxy pattern:** AgentLens MCP server sits between the agent and downstream MCP servers, transparently intercepting all tool calls.
- **Dedicated tools:** AgentLens exposes its own MCP tools that agents call explicitly.

**Analysis:**

| Factor | Proxy | Dedicated Tools |
|--------|-------|-----------------|
| **Transparency** | Agent doesn't need to know about logging | Agent explicitly logs events |
| **Completeness** | Captures all tool calls automatically | Only captures what agent calls |
| **Complexity** | High — must handle MCP server discovery, config passthrough, error handling, streaming | Low — standard MCP server |
| **Configuration** | Requires reconfiguring all MCP servers to route through proxy | Additive — just add one more MCP server |
| **MCP spec compatibility** | Fragile — breaks if MCP spec changes | Robust — uses standard tool interface |
| **Agent autonomy** | Agent has no control over what's logged | Agent chooses what to log |
| **Deployment** | Complex — must manage downstream server lifecycle | Simple — standalone process |
| **Error isolation** | Proxy failure takes down all tools | AgentLens failure only affects logging |
| **Rich context** | Only sees raw tool calls | Agent can add context, summaries, metadata |

**Decision:** **Dedicated Tools** for the initial release.

**Rationale:**
1. The proxy pattern is architecturally fragile — it couples AgentLens to the internals of MCP server management and any spec changes break it.
2. Dedicated tools are the standard MCP pattern (consistent with AgentGate's MCP server) and are much simpler to implement, test, and debug.
3. Agents calling explicit tools can add richer context (tags, metadata, cost info) that a transparent proxy cannot infer.
4. Error isolation is critical — a logging tool failure should not break the agent's actual work.
5. The proxy pattern can be added as an optional advanced feature in a future release.

**Consequences:**
- Agents must be instructed (via system prompt or configuration) to use AgentLens tools
- Not all tool calls are automatically captured — agents may skip logging
- Lower barrier to entry for self-hosted users (no proxy configuration)

---

### ADR-002: SQLite-First vs PostgreSQL-First

**Status:** Accepted  
**Date:** 2026-02-07

**Context:**  
AgentLens needs a storage backend. The choice between SQLite-first and PostgreSQL-first affects the development experience, deployment model, and feature surface.

**Decision:** **SQLite-first** with PostgreSQL as a supported alternative.

**Rationale:**
1. **Zero-dependency setup** — `npx @agentlens/server` should work with no external services. SQLite is embedded.
2. **Consistent with AgentGate** — AgentGate uses the same dual-dialect approach with SQLite as default.
3. **Performance** — SQLite in WAL mode handles 10K+ writes/sec, far exceeding our 1K events/sec target for single-node deployments.
4. **Developer experience** — SQLite is a single file. Easy to inspect, backup, copy, and reset.
5. **PostgreSQL for teams** — Teams needing shared access, replication, or existing Postgres infrastructure can switch with a single env var change.

**Consequences:**
- JSON payload storage in SQLite uses TEXT + `JSON()` functions instead of native JSONB
- No concurrent write scaling (SQLite is single-writer) — sufficient for intended use case but not for massive multi-agent deployments
- Schema defined twice (SQLite + Postgres Drizzle schemas) — mitigated by keeping them structurally identical

---

### ADR-003: Event Schema Design — Flat with JSON Payload

**Status:** Accepted  
**Date:** 2026-02-07

**Context:**  
Events could be stored as:
- **Flat columns:** Every possible field gets a column (toolName, errorCode, costUsd, etc.)
- **Fully nested JSON:** Entire event is a single JSON blob
- **Hybrid:** Common fields as columns, event-specific data in a JSON payload column

**Decision:** **Hybrid — typed columns for query fields, JSON for payload.**

**Rationale:**
1. **Queryable dimensions as columns** — `id`, `timestamp`, `sessionId`, `agentId`, `eventType`, `severity` are columns with indexes. These are the dimensions every query filters on.
2. **Payload as JSON** — Event-type-specific data (tool arguments, error details, cost info) varies widely. A JSON column avoids schema-per-event-type complexity.
3. **Type safety in code** — TypeScript discriminated unions provide compile-time type safety for payloads even though storage is JSON.
4. **PostgreSQL bonus** — When using Postgres, the `payload` column uses native JSONB with GIN indexing, enabling deep JSON queries.

**Consequences:**
- Full-text search on payload requires JSON extraction (SQLite: `json_extract()`, Postgres: JSONB operators)
- Schema migration is simpler — new event types don't require schema changes
- Slight overhead for JSON parse/serialize on read/write

---

### ADR-004: Real-Time Updates — SSE

**Status:** Accepted  
**Date:** 2026-02-07

**Context:**  
The dashboard needs real-time updates. Options:
- **SSE (Server-Sent Events)** — Server pushes events over HTTP
- **WebSocket** — Full-duplex connection
- **Polling** — Client fetches periodically

**Decision:** **SSE (Server-Sent Events)**

**Rationale:**
1. **Unidirectional** — Dashboard only needs server→client updates. SSE is purpose-built for this.
2. **HTTP-native** — Works through proxies, load balancers, and CDNs without special configuration. WebSocket requires upgrade handling.
3. **Auto-reconnect** — The `EventSource` browser API handles reconnection automatically with `Last-Event-ID` for resumption.
4. **Simpler server** — No connection upgrade, no ping/pong frames, no state machine. Just write to a stream.
5. **Hono support** — Hono has first-class streaming response support.
6. **Consistent pattern** — AgentGate dashboard can use the same pattern.

**Tradeoffs vs WebSocket:**
- WebSocket would be better if the dashboard needed to send frequent messages to the server (it doesn't — queries use REST)
- SSE has a ~6 connection limit per domain in HTTP/1.1 (mitigated by HTTP/2 multiplexing)
- For extremely high-throughput scenarios (10K+ events/sec to dashboard), WebSocket binary frames would be more efficient. Our volume doesn't require this.

**Consequences:**
- Single SSE endpoint serves all real-time needs
- Client-side filtering reduces unnecessary re-renders
- Heartbeat messages keep connections alive through proxies

---

### ADR-005: Monorepo Package Boundaries

**Status:** Accepted  
**Date:** 2026-02-07

**Context:**  
How should AgentLens be split into packages? Options range from a single package to fine-grained splitting.

**Decision:** **Six packages** as defined in the package structure.

**Package Responsibility Matrix:**

| Package | Ships to npm | Runtime | Responsibility |
|---------|-------------|---------|----------------|
| `@agentlens/core` | Yes | Node.js + Browser | Types, interfaces, validation, hash utilities. Zero runtime dependencies. |
| `@agentlens/mcp` | Yes | Node.js (stdio) | MCP server binary. Connects to `@agentlens/server` via HTTP. |
| `@agentlens/server` | Yes | Node.js | Hono HTTP server. Storage, API, SSE, alerts. Serves dashboard in production. |
| `@agentlens/dashboard` | No (built into server) | Browser | React SPA. Built by Vite, output copied to server's `public/` directory. |
| `@agentlens/sdk` | Yes | Node.js + Browser | Typed HTTP client for the AgentLens API. Thin wrapper over fetch. |
| `@agentlens/cli` | Yes | Node.js | CLI binary. Uses `@agentlens/sdk` for all API access. |

**Rationale:**
1. **Matches AgentGate** — Same package structure for developer familiarity.
2. **Independent versioning** — MCP server and API server can evolve at different rates.
3. **Minimal dependency trees** — `@agentlens/core` has zero deps. `@agentlens/mcp` only needs core + MCP SDK + fetch.
4. **Clear npm distribution** — Users install only what they need: `@agentlens/mcp` for agent instrumentation, `@agentlens/server` for self-hosting, `@agentlens/sdk` for programmatic access.

**Consequences:**
- Build order matters: core → (mcp, server, sdk, dashboard) → cli
- Dashboard build output must be copied/symlinked into server's public directory
- Workspace protocol (`workspace:*`) for internal dependencies

---

## Appendix A: Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3400` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `DB_DIALECT` | `sqlite` | Database dialect: `sqlite` or `postgresql` |
| `DATABASE_PATH` | `./agentlens.db` | SQLite database file path |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `AUTH_DISABLED` | `false` | Disable API key auth (development) |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `RETENTION_DAYS` | `90` | Event retention period (0 = forever) |
| `ALERT_CHECK_INTERVAL_MS` | `60000` | How often to evaluate alert rules |
| `AGENTGATE_WEBHOOK_SECRET` | — | Secret for AgentGate webhook verification |
| `FORMBRIDGE_WEBHOOK_SECRET` | — | Secret for FormBridge webhook verification |
| `LOG_LEVEL` | `info` | Server log level |
| `AGENTLENS_URL` | `http://localhost:3400` | (MCP server) AgentLens server URL |
| `AGENTLENS_API_KEY` | — | (MCP server) API key for server auth |

### Port Allocation (AgentKit Suite)

| Product | Default Port |
|---------|-------------|
| AgentGate | 3000 |
| FormBridge | 3200 |
| **AgentLens** | **3400** |

---

## Appendix B: Future Considerations

### Phase 2 Features (Not in Initial Scope)
- **MCP Proxy mode** — Optional transparent proxy for automatic tool call capture
- **RBAC** — Role-based access control for dashboard users
- **Multi-tenancy** — Namespace events by team/org
- **Distributed tracing** — OpenTelemetry-compatible trace/span correlation
- **Export formats** — CSV, Parquet, NDJSON export for compliance
- **Plugin system** — Custom event processors, custom dashboard widgets
- **ClickHouse backend** — For very high volume deployments (100K+ events/sec)
- **S3 archival** — Archive old events to S3-compatible storage
- **Email/Slack alerts** — Direct notification delivery (not just webhook)
- **Agent scoring** — Quality metrics derived from error rates, approval patterns, costs

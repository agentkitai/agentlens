# Product Requirements Document — AgentLens

**Author:** Amit Paz  
**Date:** 2026-02-07  
**Version:** 1.0  
**Status:** Draft  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [Target Users & Personas](#4-target-users--personas)
5. [User Stories & Journeys](#5-user-stories--journeys)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Technical Constraints & Architecture Notes](#8-technical-constraints--architecture-notes)
9. [MCP Integration Design](#9-mcp-integration-design)
10. [Integration Points](#10-integration-points)
11. [Data Model](#11-data-model)
12. [Dashboard Requirements](#12-dashboard-requirements)
13. [API Design](#13-api-design)
14. [Scope & MVP Definition](#14-scope--mvp-definition)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Open Questions](#16-open-questions)

---

## 1. Executive Summary

**AgentLens** is an open-source observability and audit trail platform for AI agents. It acts as a "flight recorder" — capturing every tool call, decision, approval, and data exchange an agent makes — and presents this data through a web dashboard for debugging, compliance, and performance optimization.

**Who it's for:** Developer teams building AI agents, engineering managers tracking cost and reliability, and compliance/security teams needing immutable audit trails of agent behavior.

**Why now:** The AI agent ecosystem has exploded to over 8,500 repositories and 7,100+ MCP servers, yet observability infrastructure is virtually nonexistent — only 12 repositories on GitHub are tagged `agent-observability`. Teams are deploying agents to production with zero visibility into what those agents actually do. This is the monitoring gap that AgentLens fills.

**Key differentiators:**
- **MCP-native** — ships as an MCP server that agents connect to naturally (not a bolt-on SDK)
- **Integrated with AgentGate** — approval/rejection events flow directly into the observability timeline
- **Integrated with FormBridge** — data collection and submission events tracked end-to-end
- **Part of the AgentKit suite** — unified agent lifecycle management (data collection → approvals → observability)
- **Open source** — MIT licensed, self-hostable, no vendor lock-in

---

## 2. Problem Statement

### The Core Problem

Teams deploying AI agents in production have **no systematic visibility** into what their agents are doing. When an agent fails, there's no trace to debug. When an agent succeeds, there's no way to understand why. When regulators ask what happened, there's no audit trail.

### Specific Pain Points

| Pain Point | Impact | Who Feels It |
|---|---|---|
| **No debug trace** — when an agent fails, developers have only console logs and guesswork | Hours wasted per incident; root cause often never found | Developers |
| **No cost visibility** — token usage and API costs per agent session are invisible | Budget overruns; no way to optimize | Eng managers |
| **No audit trail** — no immutable record of what agents did and why | Compliance gaps; cannot satisfy SOC2/regulatory requirements | Compliance teams |
| **No behavioral understanding** — cannot see patterns in how agents use tools | Missed optimization opportunities; no data to improve prompts | All |
| **No cross-system correlation** — approval events (AgentGate), data events (FormBridge), and tool calls live in separate silos | Cannot reconstruct end-to-end agent workflows | All |

### Why Existing Solutions Fall Short

- **Langfuse** — LLM observability, not agent-focused; no MCP integration; no approval/data flow tracking
- **Arize Phoenix** — ML observability platform; designed for model performance, not agent lifecycle
- **AgentOps** — Early stage, Python-only; no MCP support; no integration ecosystem
- **Cozeloop** — Closed-source, locked to Coze/ByteDance ecosystem
- **Custom logging** — Every team rolls their own `console.log` wrapper; fragile, unstructured, not queryable

### The Opportunity

With only 12 repos in the `agent-observability` space globally and thousands of teams deploying MCP-based agents, there is a massive greenfield opportunity to become the standard observability layer for AI agents — especially for the TypeScript/MCP ecosystem.

---

## 3. Goals & Success Metrics

### Goals

| Goal | Description | Timeline |
|---|---|---|
| **G1: Ship MVP** | Release v0.1.0 with event capture, storage, API, and basic dashboard | 6 weeks |
| **G2: Prove utility** | Instrument AgentGate and FormBridge as first users; validate the event model | 8 weeks |
| **G3: Community adoption** | Reach 500 GitHub stars and 1,000 npm downloads/week | 16 weeks |
| **G4: Integration ecosystem** | Ship AgentGate + FormBridge integrations, demonstrate unified timeline | 12 weeks |

### Success Metrics (KPIs)

| Metric | Target (MVP) | Target (6 months) | Measurement |
|---|---|---|---|
| **Events captured/day** | 10,000 (internal testing) | 1M+ (community) | Event storage stats |
| **P95 event ingestion latency** | < 5ms | < 5ms | Performance benchmarks |
| **GitHub stars** | 100 | 500+ | GitHub API |
| **npm weekly downloads** | 50 | 1,000+ | npm stats |
| **Dashboard active users** | 3 (internal) | 50+ | Analytics |
| **Mean time to debug** | Baseline → 50% reduction | Measured via user surveys | User feedback |
| **Agent sessions with full traces** | 95% capture rate | 99% capture rate | Completeness audit |

---

## 4. Target Users & Personas

### Persona 1: Dana — The Agent Developer

- **Role:** Full-stack developer building MCP-based AI agents
- **Tech stack:** TypeScript, Claude/GPT, MCP SDK, VS Code
- **Goals:** Debug agent failures quickly; understand tool call patterns; optimize prompt strategies
- **Frustrations:** Spends hours reading console logs to figure out why an agent misbehaved; no way to replay agent decision paths; each debugging session is ad-hoc
- **Key quote:** _"When my agent made 47 tool calls and the 38th one failed, I need to see exactly what happened at step 38 without reading through a wall of logs."_

### Persona 2: Marcus — The Engineering Manager

- **Role:** Manages a team of 5 developers building agent-powered features
- **Goals:** Track cost per agent session; ensure SLAs are met; report on agent reliability to leadership
- **Frustrations:** Has no dashboards for agent operations; can't answer "how much did our agents cost last week?"; relies on developers' anecdotes for reliability data
- **Key quote:** _"I need a single dashboard that tells me: how many agent sessions ran, what they cost, and what broke."_

### Persona 3: Sophia — The Compliance Officer

- **Role:** Security & compliance at a fintech company using AI agents
- **Goals:** Prove to auditors that agents only performed approved actions; maintain immutable audit trails; satisfy SOC2 requirements
- **Frustrations:** No structured audit log of agent actions; cannot prove chain of custody for agent decisions; manual evidence collection is painful
- **Key quote:** _"When an auditor asks 'show me every action this agent took on customer data in November,' I need to produce that report in minutes, not days."_

---

## 5. User Stories & Journeys

### Epic 1: Agent Instrumentation

**US-1.1:** As a developer, I want to add AgentLens to my agent's MCP configuration so that all tool calls are automatically captured without changing my agent code.

**US-1.2:** As a developer, I want to tag agent sessions with metadata (agent name, version, environment) so that I can filter and group events later.

**US-1.3:** As a developer, I want captured events to include timing data so that I can identify slow tool calls.

#### Journey: Instrumenting an Agent

```
1. Developer installs: npm install @agentlens/mcp-server
2. Adds AgentLens to MCP config:
   {
     "mcpServers": {
       "agentlens": {
         "command": "npx",
         "args": ["@agentlens/mcp-server"],
         "env": { "AGENTLENS_API_URL": "http://localhost:3200" }
       }
     }
   }
3. Agent starts → AgentLens MCP server initializes
4. Agent makes tool calls → AgentLens intercepts and logs each one
5. Developer opens dashboard at localhost:3200 → sees live event stream
```

### Epic 2: Event Viewing & Timeline

**US-2.1:** As a developer, I want to see a chronological timeline of all events in an agent session so that I can understand the full decision path.

**US-2.2:** As a developer, I want to expand any event to see its full payload (request params, response data, timing) so that I can debug specific steps.

**US-2.3:** As an eng manager, I want to see an overview of all agent sessions with status indicators (success/failure/in-progress) so that I can monitor system health.

#### Journey: Viewing an Agent Session Timeline

```
1. User opens dashboard → lands on Sessions page
2. Sees list of recent sessions: agent name, start time, duration, event count, status
3. Clicks into a session → sees vertical timeline:
   - 10:00:00.000 [tool_call] search_database(query: "user records")
   - 10:00:00.342 [tool_result] search_database → 42 results (342ms)
   - 10:00:01.100 [tool_call] format_report(data: {...})
   - 10:00:01.250 [approval_requested] send_email → routed to human (AgentGate)
   - 10:00:15.400 [approval_decided] send_email → approved by admin@co.com
   - 10:00:15.600 [tool_call] send_email(to: "user@example.com", ...)
   - 10:00:16.100 [tool_result] send_email → success (500ms)
4. User clicks on an event → side panel shows full JSON payload
5. User filters by event type → shows only errors or approvals
```

### Epic 3: Debugging a Failure

**US-3.1:** As a developer, I want to filter events by error status so that I can quickly find what went wrong.

**US-3.2:** As a developer, I want to see the full request/response context around an error so that I can understand the failure cause.

**US-3.3:** As a developer, I want to compare a failed session with a successful session of the same agent so that I can spot differences.

#### Journey: Debugging a Failed Agent Run

```
1. Developer notices an agent run failed (alert or user report)
2. Opens dashboard → filters sessions by status: "error"
3. Finds the failed session → clicks into timeline
4. Sees error event highlighted in red at step 12 of 15
5. Expands error event → sees: "API returned 429 Too Many Requests"
6. Scrolls up → sees the preceding 11 successful calls were all to the same API
7. Realizes: rate limiting caused the failure; adds retry logic
8. Marks the session with a note: "Root cause: rate limiting on external API"
```

### Epic 4: Compliance Audit

**US-4.1:** As a compliance officer, I want to export all events for a given time range and agent so that I can provide evidence to auditors.

**US-4.2:** As a compliance officer, I want events to be immutable (append-only) so that I can prove the audit trail hasn't been tampered with.

**US-4.3:** As a compliance officer, I want to see all approval decisions (from AgentGate) correlated with the actions that followed so that I can prove agents only acted with authorization.

#### Journey: Compliance Audit

```
1. Auditor requests: "All agent actions on customer data, November 2025"
2. Compliance officer opens AgentLens dashboard → Events page
3. Filters: date range = Nov 1-30, agent = customer-service-bot
4. Applies tag filter: data_category = "customer_pii"
5. Reviews timeline showing tool calls + approval events
6. Clicks "Export" → downloads JSON/CSV with all matching events
7. Verifies each sensitive action has a corresponding approval event
8. Provides export to auditor with cryptographic hashes for integrity
```

---

## 6. Functional Requirements

### P0 — Must Have (MVP)

#### FR-P0-1: MCP Server for Event Capture

The system MUST provide an MCP server (`@agentlens/mcp-server`) that agents connect to for event instrumentation.

| Requirement | Detail |
|---|---|
| **FR-P0-1.1** | MCP server exposes tools: `agentlens_log_event`, `agentlens_start_session`, `agentlens_end_session` |
| **FR-P0-1.2** | MCP server auto-captures tool call/result events via MCP protocol hooks |
| **FR-P0-1.3** | Each event includes: timestamp, event type, session ID, agent ID, payload, duration |
| **FR-P0-1.4** | MCP server buffers events locally and flushes to the API server in batches (max 100 events or 1s interval) |
| **FR-P0-1.5** | MCP server works as both stdio transport (for Claude Desktop/Cursor) and SSE transport (for programmatic agents) |
| **FR-P0-1.6** | MCP server config accepts: API URL, agent name, agent version, environment, custom tags |

#### FR-P0-2: Event Storage (SQLite)

The system MUST store events in an append-only SQLite database for local/self-hosted deployments.

| Requirement | Detail |
|---|---|
| **FR-P0-2.1** | Events stored in append-only `events` table with no UPDATE or DELETE operations |
| **FR-P0-2.2** | Sessions stored in `sessions` table with computed fields (start, end, duration, event count, status) |
| **FR-P0-2.3** | Support for WAL mode for concurrent read/write |
| **FR-P0-2.4** | Automatic retention policy: configurable max age (default 30 days), max size (default 1GB) |
| **FR-P0-2.5** | Database schema managed via Drizzle ORM with migration support |

#### FR-P0-3: REST API for Querying Events

The system MUST expose a REST API (Hono) for querying events, sessions, and basic analytics.

| Requirement | Detail |
|---|---|
| **FR-P0-3.1** | Event ingestion endpoint: `POST /api/v1/events` (batch) |
| **FR-P0-3.2** | Event query endpoints: `GET /api/v1/events`, `GET /api/v1/events/:id` |
| **FR-P0-3.3** | Session endpoints: `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`, `GET /api/v1/sessions/:id/events` |
| **FR-P0-3.4** | Query filtering: by event type, session ID, agent ID, time range, status, tags |
| **FR-P0-3.5** | Pagination: cursor-based with configurable page size (default 50, max 500) |
| **FR-P0-3.6** | API key authentication for ingestion and querying |

#### FR-P0-4: Basic Web Dashboard

The system MUST provide a React web dashboard for visualizing agent activity.

| Requirement | Detail |
|---|---|
| **FR-P0-4.1** | **Sessions list page:** Table of agent sessions with sorting, filtering, search |
| **FR-P0-4.2** | **Session detail page:** Vertical timeline of events with expand/collapse, event type icons, duration indicators |
| **FR-P0-4.3** | **Events page:** Filterable list of all events across sessions |
| **FR-P0-4.4** | **Event detail panel:** Side panel or modal showing full event JSON with syntax highlighting |
| **FR-P0-4.5** | Dashboard served by the same Hono server (SPA served from `/` route) |
| **FR-P0-4.6** | Responsive layout (desktop-first, functional on tablet) |

### P1 — Should Have (v0.2.0)

#### FR-P1-1: AgentGate Integration

| Requirement | Detail |
|---|---|
| **FR-P1-1.1** | Webhook receiver endpoint: `POST /api/v1/integrations/agentgate/webhook` |
| **FR-P1-1.2** | Maps AgentGate events (request.created, request.decided, request.expired) to AgentLens event format |
| **FR-P1-1.3** | Correlates approval events with agent sessions via request ID or agent context |
| **FR-P1-1.4** | Approval events appear in the session timeline with distinct styling (✅ approved, ❌ denied, ⏰ expired) |
| **FR-P1-1.5** | Webhook signature verification (HMAC-SHA256, matching AgentGate's `signPayload` format) |

#### FR-P1-2: FormBridge Integration

| Requirement | Detail |
|---|---|
| **FR-P1-2.1** | Webhook receiver endpoint: `POST /api/v1/integrations/formbridge/webhook` |
| **FR-P1-2.2** | Maps FormBridge submission events to AgentLens event format |
| **FR-P1-2.3** | Tracks data flow: form created → fields filled → submitted → delivered |
| **FR-P1-2.4** | FormBridge events appear in session timeline showing data handoff points |

#### FR-P1-3: Cost Tracking

| Requirement | Detail |
|---|---|
| **FR-P1-3.1** | Events can include optional `cost` field: `{ tokens: { input, output }, estimatedCostUsd }` |
| **FR-P1-3.2** | Session summary includes total token usage and estimated cost |
| **FR-P1-3.3** | Dashboard shows cost per session, cost over time chart, cost by agent |
| **FR-P1-3.4** | API endpoint: `GET /api/v1/analytics/costs` with grouping by agent, time period |

#### FR-P1-4: Alerting

| Requirement | Detail |
|---|---|
| **FR-P1-4.1** | Configurable alert rules: error rate threshold, cost spike, session duration anomaly |
| **FR-P1-4.2** | Alert channels: webhook (generic), console log |
| **FR-P1-4.3** | Alert history stored and viewable in dashboard |
| **FR-P1-4.4** | API endpoints for CRUD on alert rules: `POST/GET/PUT/DELETE /api/v1/alerts/rules` |

### P2 — Nice to Have (Future)

#### FR-P2-1: PostgreSQL Support

| Requirement | Detail |
|---|---|
| **FR-P2-1.1** | Configurable database backend: SQLite (default) or PostgreSQL |
| **FR-P2-1.2** | Drizzle schema with dialect-agnostic abstractions |
| **FR-P2-1.3** | Connection pooling for PostgreSQL (via `postgres.js` or `pg`) |

#### FR-P2-2: Team Features

| Requirement | Detail |
|---|---|
| **FR-P2-2.1** | Multi-user authentication (email/password or OAuth) |
| **FR-P2-2.2** | Role-based access: admin, viewer, operator |
| **FR-P2-2.3** | Shared dashboards and saved filters |

#### FR-P2-3: Advanced Analytics

| Requirement | Detail |
|---|---|
| **FR-P2-3.1** | Tool call frequency heatmaps |
| **FR-P2-3.2** | Error pattern detection (repeated failures by tool or agent) |
| **FR-P2-3.3** | Session comparison view (diff two sessions side by side) |
| **FR-P2-3.4** | Agent performance leaderboard (success rate, avg duration, avg cost) |

#### FR-P2-4: Export & Compliance

| Requirement | Detail |
|---|---|
| **FR-P2-4.1** | Export events to JSON, CSV, or JSONL |
| **FR-P2-4.2** | Cryptographic hashing for audit trail integrity (SHA-256 chain) |
| **FR-P2-4.3** | Scheduled export to S3/GCS/Azure Blob |
| **FR-P2-4.4** | Data retention policies with configurable archival |

---

## 7. Non-Functional Requirements

### Performance

| Metric | Target | Notes |
|---|---|---|
| **Event ingestion throughput** | ≥ 1,000 events/sec (single instance) | Batch endpoint, SQLite WAL mode |
| **Event ingestion latency (P95)** | < 5ms per event (batch of 100) | Measured at API layer |
| **Dashboard page load** | < 2s initial, < 500ms navigation | SPA with code splitting |
| **Event query latency (P95)** | < 100ms for filtered queries (< 1M events) | With indexed columns |
| **Session timeline render** | < 1s for sessions with up to 1,000 events | Virtual scrolling for large sessions |

### Storage

| Metric | Target | Notes |
|---|---|---|
| **Event size (average)** | ~500 bytes per event (without large payloads) | Payload truncation at 10KB |
| **Database size (1M events)** | ~500MB–1GB | With indexes |
| **Retention default** | 30 days | Configurable |
| **Max payload size** | 10KB per event payload | Truncated with indicator |

### Security

| Requirement | Detail |
|---|---|
| **API authentication** | API key-based authentication for all endpoints |
| **Key management** | Keys stored as SHA-256 hashes; displayed only on creation |
| **Payload sanitization** | Option to redact sensitive fields before storage (configurable patterns) |
| **Webhook verification** | HMAC-SHA256 signature validation for all inbound webhooks |
| **CORS** | Configurable allowed origins; default: same-origin only |
| **No external calls** | Self-hosted server makes no outbound network calls (except configured alert webhooks) |

### Scalability

| Scenario | Target |
|---|---|
| **Single developer (local)** | 100K events/day, SQLite, single process |
| **Small team (5-10 agents)** | 1M events/day, SQLite WAL, single server |
| **Growth path** | PostgreSQL backend for > 1M events/day, horizontal read replicas |

### Reliability

| Requirement | Detail |
|---|---|
| **MCP server resilience** | If API server is unreachable, buffer events locally (up to 10K events or 10MB) and flush when reconnected |
| **No data loss** | Append-only storage; no DELETE operations on events table |
| **Graceful degradation** | Dashboard shows stale data indicator if API is unreachable |

---

## 8. Technical Constraints & Architecture Notes

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Language** | TypeScript (strict mode) | Consistent with AgentGate & FormBridge |
| **Runtime** | Node.js 20+ | LTS, native fetch, ESM |
| **MCP Server** | `@modelcontextprotocol/sdk` | Standard MCP implementation |
| **HTTP Framework** | Hono | Lightweight, fast, used in FormBridge |
| **Database ORM** | Drizzle | Type-safe, lightweight, multi-dialect |
| **Database** | SQLite (better-sqlite3) → PostgreSQL | SQLite for MVP; Postgres for scale |
| **Dashboard** | React 18+ with Vite | Consistent with AgentGate dashboard |
| **Styling** | Tailwind CSS | Utility-first, consistent with ecosystem |
| **Testing** | Vitest | Consistent with ecosystem |
| **Package Manager** | pnpm | Consistent with ecosystem |

### Monorepo Structure

```
agentlens/
├── packages/
│   ├── core/              # Shared types, event schema, utilities
│   │   ├── src/
│   │   │   ├── types.ts         # Core type definitions
│   │   │   ├── events.ts        # Event type definitions and helpers
│   │   │   ├── schemas.ts       # Zod validation schemas
│   │   │   └── index.ts         # Public API
│   │   └── package.json         # @agentlens/core
│   │
│   ├── server/            # Hono API server + event storage
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point
│   │   │   ├── app.ts           # Hono app setup
│   │   │   ├── db/              # Drizzle schema + migrations
│   │   │   ├── routes/          # API route handlers
│   │   │   ├── lib/             # Business logic
│   │   │   └── integrations/    # Webhook receivers (AgentGate, FormBridge)
│   │   └── package.json         # @agentlens/server
│   │
│   ├── mcp-server/        # MCP server for agent instrumentation
│   │   ├── src/
│   │   │   ├── index.ts         # MCP server entry
│   │   │   ├── tools.ts         # MCP tool definitions
│   │   │   ├── interceptor.ts   # Tool call interception logic
│   │   │   └── buffer.ts        # Event buffering and flush
│   │   └── package.json         # @agentlens/mcp-server
│   │
│   ├── dashboard/         # React SPA
│   │   ├── src/
│   │   │   ├── pages/           # Route pages
│   │   │   ├── components/      # Shared components
│   │   │   ├── hooks/           # Data fetching hooks
│   │   │   └── lib/             # Utilities
│   │   └── package.json         # @agentlens/dashboard
│   │
│   └── sdk/               # Optional: programmatic client for non-MCP use
│       ├── src/
│       │   ├── client.ts        # HTTP client for AgentLens API
│       │   └── index.ts
│       └── package.json         # @agentlens/sdk
│
├── package.json           # Root workspace
├── pnpm-workspace.yaml
├── tsconfig.json          # Base TS config
└── vitest.config.ts       # Root test config
```

### Key Architectural Decisions

1. **Append-only event log** — Events are immutable once written. No UPDATE or DELETE on the events table. This guarantees audit trail integrity.

2. **Batch ingestion** — MCP server buffers events and sends them in batches to reduce HTTP overhead. The API accepts batch writes atomically.

3. **Session as materialized view** — Sessions are computed from events (first event = start, last event or explicit end = end). Session metadata is denormalized for fast queries but always derivable from the event stream.

4. **Shared event envelope** — All events (native, AgentGate, FormBridge) conform to the same envelope format, enabling unified querying and timeline rendering.

5. **Server-served SPA** — The dashboard is built as a static SPA and served by the Hono server. Single binary deployment: one process serves both API and UI.

---

## 9. MCP Integration Design

### How Agents Connect

AgentLens operates as an **MCP server** that agents add to their MCP configuration. The MCP server provides tools that agents (or their frameworks) call to emit observability events. Additionally, the MCP server can optionally act as an **MCP proxy** — wrapping another MCP server and automatically capturing all tool calls that flow through it.

### Mode 1: Explicit Instrumentation (MCP Tools)

The AgentLens MCP server exposes the following tools:

#### `agentlens_start_session`

Begins a new observability session.

```json
{
  "name": "agentlens_start_session",
  "description": "Start a new AgentLens observability session. Call this at the beginning of an agent task.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "agentName": { "type": "string", "description": "Name of the agent" },
      "agentVersion": { "type": "string", "description": "Agent version (semver)" },
      "environment": { "type": "string", "enum": ["development", "staging", "production"] },
      "tags": {
        "type": "object",
        "description": "Key-value metadata tags",
        "additionalProperties": { "type": "string" }
      },
      "parentSessionId": { "type": "string", "description": "Parent session ID for sub-agent tracing" }
    },
    "required": ["agentName"]
  }
}
```

Returns: `{ sessionId: string }`

#### `agentlens_log_event`

Logs a custom event to the current session.

```json
{
  "name": "agentlens_log_event",
  "description": "Log a custom observability event to the current AgentLens session.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": { "type": "string" },
      "type": { "type": "string", "description": "Event type (e.g., 'custom', 'decision', 'error')" },
      "name": { "type": "string", "description": "Human-readable event name" },
      "payload": { "type": "object", "description": "Event data" },
      "level": { "type": "string", "enum": ["debug", "info", "warn", "error"] },
      "tags": { "type": "object", "additionalProperties": { "type": "string" } }
    },
    "required": ["sessionId", "type", "name"]
  }
}
```

#### `agentlens_end_session`

Ends the current observability session.

```json
{
  "name": "agentlens_end_session",
  "description": "End the current AgentLens observability session.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": { "type": "string" },
      "status": { "type": "string", "enum": ["success", "error", "cancelled"] },
      "summary": { "type": "string", "description": "Human-readable session summary" }
    },
    "required": ["sessionId"]
  }
}
```

### Mode 2: MCP Proxy (Automatic Capture) — Future

In proxy mode, AgentLens sits between the agent and its target MCP servers, automatically capturing all tool calls without any instrumentation code. This is a **future capability** (post-MVP) but the event schema is designed to support it.

```
Agent → AgentLens MCP Proxy → Target MCP Server(s)
         ↓ (captured events)
       AgentLens API Server
```

### What Gets Captured

| Event Type | Source | Captured Data |
|---|---|---|
| `session.start` | agentlens_start_session tool | Agent name, version, environment, tags |
| `session.end` | agentlens_end_session tool | Status, summary, duration |
| `tool.call` | MCP proxy or explicit log | Tool name, arguments, target server |
| `tool.result` | MCP proxy or explicit log | Return value (truncated), duration, error |
| `custom` | agentlens_log_event tool | Arbitrary structured payload |
| `integration.agentgate` | Webhook from AgentGate | Approval request/decision events |
| `integration.formbridge` | Webhook from FormBridge | Form submission/delivery events |

---

## 10. Integration Points

### AgentGate Integration

AgentGate already has a webhook delivery system (`deliverWebhook()`) that sends HMAC-SHA256-signed payloads to configured endpoints. AgentLens receives these webhooks and transforms them into its unified event format.

#### Webhook Configuration (in AgentGate)

```json
{
  "url": "http://localhost:3200/api/v1/integrations/agentgate/webhook",
  "secret": "shared-secret-for-hmac",
  "events": [
    "request.created",
    "request.decided",
    "request.expired",
    "request.escalated",
    "policy.matched"
  ]
}
```

#### Event Mapping

| AgentGate Event | AgentLens Event Type | Key Fields Mapped |
|---|---|---|
| `request.created` | `integration.agentgate.request_created` | requestId, action, params, urgency, policyDecision |
| `request.decided` | `integration.agentgate.request_decided` | requestId, action, status (approved/denied), decidedBy, reason, decisionTimeMs |
| `request.expired` | `integration.agentgate.request_expired` | requestId, action, pendingTimeMs |
| `request.escalated` | `integration.agentgate.request_escalated` | requestId, fromApprover, toApprover, reason |
| `policy.matched` | `integration.agentgate.policy_matched` | requestId, policyName, decision, matchedRule |

#### Session Correlation

AgentGate events include a `metadata` field. If the agent passes its AgentLens `sessionId` in the approval request context, AgentLens correlates the approval event with the correct session:

```typescript
// In the agent code
await agentgate.requestApproval({
  action: "send_email",
  params: { to: "user@example.com" },
  context: { agentlens_session_id: currentSessionId }
});
```

If no session ID is provided, AgentLens stores the event as an "unlinked" integration event that can be manually correlated later.

### FormBridge Integration

FormBridge will emit webhook events for form lifecycle milestones. AgentLens receives and maps these.

#### Event Mapping

| FormBridge Event | AgentLens Event Type | Key Fields Mapped |
|---|---|---|
| `submission.created` | `integration.formbridge.submission_created` | submissionId, intakeId, actor, fields |
| `submission.completed` | `integration.formbridge.submission_completed` | submissionId, completedAt, fieldCount |
| `submission.delivered` | `integration.formbridge.submission_delivered` | submissionId, destination, deliveryStatus |
| `submission.failed` | `integration.formbridge.submission_failed` | submissionId, error, retryCount |

#### Session Correlation

Same pattern as AgentGate — the agent includes `agentlens_session_id` in FormBridge's submission context for automatic correlation.

### Generic Webhook Receiver

For future integrations, AgentLens provides a generic webhook endpoint:

```
POST /api/v1/integrations/generic/webhook
```

This accepts any JSON payload and stores it as a `custom.webhook` event. Users configure a mapping template to extract session ID, event type, and structured fields from the payload.

---

## 11. Data Model

### Core Entities

#### Event

The fundamental unit of data in AgentLens.

```typescript
interface AgentLensEvent {
  // Identity
  id: string;                    // Unique event ID (nanoid, e.g., "evt_a1b2c3d4e5f6")
  type: EventType;               // Event type (see enum below)
  source: EventSource;           // What generated this event

  // Association
  sessionId: string | null;      // Parent session (null for unlinked events)
  parentEventId: string | null;  // For request/response pairing (tool.result → tool.call)
  traceId: string | null;        // Cross-session trace ID (for sub-agent spanning)

  // Content
  name: string;                  // Human-readable event name (e.g., "search_database")
  level: EventLevel;             // debug | info | warn | error
  payload: Record<string, unknown>; // Event-specific structured data
  
  // Timing
  timestamp: number;             // Unix timestamp (ms) when event occurred
  durationMs: number | null;     // Duration for request/response events

  // Metadata
  agentId: string | null;        // Agent identifier
  tags: Record<string, string>;  // Free-form key-value tags
  
  // Storage metadata
  createdAt: string;             // ISO 8601 when stored
}
```

#### Event Types (Enum)

```typescript
type EventType =
  // Session lifecycle
  | 'session.start'
  | 'session.end'
  // Tool calls
  | 'tool.call'
  | 'tool.result'
  | 'tool.error'
  // Custom events
  | 'custom'
  | 'decision'
  | 'error'
  // Integration events — AgentGate
  | 'integration.agentgate.request_created'
  | 'integration.agentgate.request_decided'
  | 'integration.agentgate.request_expired'
  | 'integration.agentgate.request_escalated'
  | 'integration.agentgate.policy_matched'
  // Integration events — FormBridge
  | 'integration.formbridge.submission_created'
  | 'integration.formbridge.submission_completed'
  | 'integration.formbridge.submission_delivered'
  | 'integration.formbridge.submission_failed'
  // Generic
  | 'custom.webhook';

type EventSource = 'mcp' | 'api' | 'webhook.agentgate' | 'webhook.formbridge' | 'webhook.generic';

type EventLevel = 'debug' | 'info' | 'warn' | 'error';
```

#### Session

A logical grouping of events representing a single agent task/run.

```typescript
interface Session {
  // Identity
  id: string;                     // Session ID (nanoid)
  
  // Agent info
  agentId: string;                // Agent identifier
  agentName: string;              // Human-readable agent name
  agentVersion: string | null;    // Semver version
  environment: string;            // development | staging | production
  
  // Lifecycle
  status: SessionStatus;          // running | success | error | cancelled
  startedAt: string;              // ISO 8601
  endedAt: string | null;         // ISO 8601 (null while running)
  durationMs: number | null;      // Computed: endedAt - startedAt
  
  // Aggregates (materialized)
  eventCount: number;             // Total events in session
  errorCount: number;             // Events with level=error
  toolCallCount: number;          // Events with type=tool.call
  
  // Cost (P1)
  totalTokensInput: number | null;
  totalTokensOutput: number | null;
  estimatedCostUsd: number | null;
  
  // Metadata
  tags: Record<string, string>;   // Free-form tags
  summary: string | null;         // Agent-provided summary
  parentSessionId: string | null; // For sub-agent tracing
  
  // Storage
  createdAt: string;
  updatedAt: string;
}

type SessionStatus = 'running' | 'success' | 'error' | 'cancelled';
```

#### Agent

Registered agent identity (auto-created on first event).

```typescript
interface Agent {
  id: string;                     // Agent identifier
  name: string;                   // Human-readable name
  firstSeenAt: string;            // ISO 8601
  lastSeenAt: string;             // ISO 8601
  sessionCount: number;           // Total sessions
  metadata: Record<string, string>; // Agent metadata
}
```

### Database Schema (Drizzle — SQLite)

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  source: text('source').notNull(),
  sessionId: text('session_id').references(() => sessions.id),
  parentEventId: text('parent_event_id'),
  traceId: text('trace_id'),
  name: text('name').notNull(),
  level: text('level').notNull().default('info'),
  payload: text('payload').notNull().default('{}'),     // JSON string
  timestamp: integer('timestamp').notNull(),              // Unix ms
  durationMs: integer('duration_ms'),
  agentId: text('agent_id'),
  tags: text('tags').notNull().default('{}'),             // JSON string
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name').notNull(),
  agentVersion: text('agent_version'),
  environment: text('environment').notNull().default('development'),
  status: text('status').notNull().default('running'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
  eventCount: integer('event_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  totalTokensInput: integer('total_tokens_input'),
  totalTokensOutput: integer('total_tokens_output'),
  estimatedCostUsd: real('estimated_cost_usd'),
  tags: text('tags').notNull().default('{}'),
  summary: text('summary'),
  parentSessionId: text('parent_session_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  sessionCount: integer('session_count').notNull().default(0),
  metadata: text('metadata').notNull().default('{}'),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  permissions: text('permissions').notNull().default('["read"]'), // JSON array
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
});
```

### Indexes

```sql
CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_agent_id ON events(agent_id);
CREATE INDEX idx_events_level ON events(level);
CREATE INDEX idx_events_session_timestamp ON events(session_id, timestamp);
CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
```

### Timeline Reconstruction

To reconstruct a session timeline:

```sql
SELECT * FROM events 
WHERE session_id = :sessionId 
ORDER BY timestamp ASC, created_at ASC;
```

Tool call/result pairing is done via `parentEventId`: when a `tool.result` event is stored, its `parentEventId` points to the corresponding `tool.call` event. The dashboard uses this to render request/response pairs as a single expandable node.

---

## 12. Dashboard Requirements

### Page 1: Overview (Home)

**Path:** `/`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  AgentLens                            [Settings] [Docs] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Sessions │  │  Events  │  │  Errors  │  │ Agents │  │
│  │  Today   │  │  Today   │  │  Today   │  │ Active │  │
│  │   142    │  │  8,431   │  │    12    │  │    5   │  │
│  │  ↑ 12%   │  │  ↑ 8%   │  │  ↓ 3%   │  │  ── 0% │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Events Over Time (24h bar chart)                │   │
│  │  ████ ██ ███████ ████ ██████ ███ ████████        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────┐  │
│  │ Recent Sessions         │  │ Error Feed           │  │
│  │ • agent-a  ✅ 2m ago    │  │ • tool_x failed at.. │  │
│  │ • agent-b  ❌ 5m ago    │  │ • timeout on tool_y  │  │
│  │ • agent-c  🔄 running   │  │ • 429 rate limited   │  │
│  └─────────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Components:**
- Summary stat cards with trend indicators (24h comparison)
- Events over time chart (bar chart, hourly buckets, last 24h)
- Recent sessions list (top 10, sorted by start time)
- Recent errors feed (top 10 error events, sorted by timestamp)

### Page 2: Sessions

**Path:** `/sessions`

**Layout:**
- **Filters bar:** Agent name (dropdown), status (multi-select), environment (dropdown), date range (picker), search (free text)
- **Sessions table:** Columns: Agent | Status | Start | Duration | Events | Errors | Cost* | Tags
- **Sorting:** Click column headers to sort
- **Pagination:** Cursor-based, 50 per page

### Page 3: Session Detail

**Path:** `/sessions/:id`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  ← Sessions    agent-customer-bot v1.2.0                │
│  Status: ✅ Success  Duration: 12.4s  Events: 23       │
│  Started: 2026-02-07 10:00:00  Environment: production  │
│  Tags: team=support, customer_id=abc123                 │
├──────────────────────────────┬──────────────────────────┤
│  Timeline                   │  Event Detail             │
│                              │                          │
│  10:00:00.000                │  tool.call                │
│  ● session.start             │  search_database          │
│  │                           │                          │
│  10:00:00.100                │  Arguments:              │
│  ● tool.call search_db      │  {                       │
│  │  342ms                    │    "query": "user recs"  │
│  ● tool.result search_db    │  }                       │
│  │                           │                          │
│  10:00:01.000                │  Result:                 │
│  ● tool.call format_report  │  { "count": 42, ... }    │
│  │  150ms                    │                          │
│  ● tool.result format_rep   │  Duration: 342ms         │
│  │                           │                          │
│  10:00:02.000                │                          │
│  ⏳ approval_requested       │                          │
│  │  (AgentGate)              │                          │
│  │  14.2s                    │                          │
│  ✅ approval_decided         │                          │
│  │                           │                          │
│  10:00:16.500                │                          │
│  ● tool.call send_email     │                          │
│  │  500ms                    │                          │
│  ● tool.result send_email   │                          │
│  │                           │                          │
│  10:00:17.100                │                          │
│  ● session.end (success)     │                          │
│                              │                          │
├──────────────────────────────┴──────────────────────────┤
│  Filters: [All] [Tool Calls] [Errors] [Approvals]      │
└─────────────────────────────────────────────────────────┘
```

**Components:**
- Session header: agent info, status badge, duration, event/error counts, tags
- Vertical timeline: chronological event list with icons, timestamps, durations
- Event detail panel: click an event → shows full JSON payload, timing, metadata
- Event type filter buttons: all, tool calls, errors, approvals, custom
- Request/response pairing: tool.call and tool.result rendered as a single expandable node

### Page 4: Events

**Path:** `/events`

**Layout:**
- **Filters bar:** Event type (multi-select), level (multi-select), agent (dropdown), session (search), time range, free-text search in event names/payloads
- **Events table:** Columns: Timestamp | Type | Name | Agent | Session | Level | Duration
- **Click row** → expands inline or navigates to session detail with event highlighted

### Page 5: Agents

**Path:** `/agents`

**Layout:**
- **Agents list:** Card view showing each unique agent with: name, last seen, session count, error rate, avg duration
- **Click agent** → filtered sessions view for that agent

### Page 6: Settings (MVP)

**Path:** `/settings`

**Components:**
- API key management (create, revoke, list)
- Retention settings
- Integration configuration (AgentGate/FormBridge webhook URLs and secrets)
- Export data

### Real-Time Updates

- Dashboard uses **polling** for MVP (every 5 seconds on active pages)
- P1: Upgrade to **Server-Sent Events (SSE)** for live streaming on session detail and events pages
- Live sessions show a pulsing "running" indicator with auto-updating event timeline

---

## 13. API Design

### Base URL

```
http://localhost:3200/api/v1
```

### Authentication

All API requests must include an API key:
```
Authorization: Bearer agentlens_key_xxxxxxxxxxxxx
```

### Endpoints

#### Events

| Method | Path | Description |
|---|---|---|
| `POST` | `/events` | Ingest a batch of events |
| `GET` | `/events` | List events with filters |
| `GET` | `/events/:id` | Get a single event by ID |

**POST /events** — Batch Event Ingestion

```json
// Request
{
  "events": [
    {
      "type": "tool.call",
      "source": "mcp",
      "sessionId": "ses_abc123",
      "name": "search_database",
      "level": "info",
      "payload": { "query": "user records", "limit": 100 },
      "timestamp": 1707300000000,
      "agentId": "agent_customer_bot",
      "tags": { "environment": "production" }
    }
  ]
}

// Response (201 Created)
{
  "ingested": 1,
  "eventIds": ["evt_x1y2z3"]
}
```

**GET /events** — Query Events

Query parameters:
- `type` — Filter by event type (comma-separated)
- `level` — Filter by level (comma-separated)
- `sessionId` — Filter by session
- `agentId` — Filter by agent
- `from` — Start timestamp (Unix ms)
- `to` — End timestamp (Unix ms)
- `search` — Full-text search in name and payload
- `cursor` — Pagination cursor
- `limit` — Page size (default 50, max 500)
- `order` — `asc` or `desc` (default `desc`)

```json
// Response
{
  "events": [ /* array of AgentLensEvent */ ],
  "cursor": "next_cursor_token",
  "hasMore": true,
  "total": 8431
}
```

#### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/sessions` | List sessions with filters |
| `GET` | `/sessions/:id` | Get session detail |
| `GET` | `/sessions/:id/events` | Get all events for a session |
| `PATCH` | `/sessions/:id` | Update session (tags, summary) |

**GET /sessions** — Query Sessions

Query parameters:
- `agentId` — Filter by agent
- `status` — Filter by status (comma-separated)
- `environment` — Filter by environment
- `from` / `to` — Time range
- `search` — Free-text search in agent name, tags, summary
- `cursor` / `limit` / `order` — Pagination

```json
// Response
{
  "sessions": [ /* array of Session */ ],
  "cursor": "next_cursor_token",
  "hasMore": true,
  "total": 142
}
```

**GET /sessions/:id/events**

Returns all events for a session, ordered by timestamp ascending (for timeline rendering).

```json
// Response
{
  "events": [ /* array of AgentLensEvent, ordered by timestamp */ ],
  "session": { /* Session metadata */ }
}
```

#### Agents

| Method | Path | Description |
|---|---|---|
| `GET` | `/agents` | List all known agents |
| `GET` | `/agents/:id` | Get agent detail with stats |

#### Analytics (P1)

| Method | Path | Description |
|---|---|---|
| `GET` | `/analytics/overview` | Summary stats (event count, session count, error rate) |
| `GET` | `/analytics/events-over-time` | Event counts bucketed by time interval |
| `GET` | `/analytics/costs` | Cost breakdown by agent, time period |
| `GET` | `/analytics/errors` | Error rate trends, top error types |

**GET /analytics/overview**

Query parameters:
- `from` / `to` — Time range (default: last 24h)

```json
// Response
{
  "period": { "from": "2026-02-06T10:00:00Z", "to": "2026-02-07T10:00:00Z" },
  "sessions": { "total": 142, "success": 125, "error": 12, "running": 5 },
  "events": { "total": 8431 },
  "errors": { "total": 47, "rate": 0.0056 },
  "agents": { "active": 5 },
  "cost": { "totalUsd": 12.47, "totalTokensInput": 1240000, "totalTokensOutput": 380000 }
}
```

**GET /analytics/events-over-time**

Query parameters:
- `from` / `to` — Time range
- `interval` — Bucket size: `minute`, `hour`, `day` (default: auto based on range)
- `groupBy` — Optional: `type`, `agent`, `level`

```json
// Response
{
  "buckets": [
    { "time": "2026-02-07T09:00:00Z", "count": 342, "groups": { "tool.call": 200, "tool.result": 140, "error": 2 } },
    { "time": "2026-02-07T10:00:00Z", "count": 415, "groups": { "tool.call": 250, "tool.result": 160, "error": 5 } }
  ]
}
```

#### Integrations

| Method | Path | Description |
|---|---|---|
| `POST` | `/integrations/agentgate/webhook` | Receive AgentGate webhook events |
| `POST` | `/integrations/formbridge/webhook` | Receive FormBridge webhook events |
| `POST` | `/integrations/generic/webhook` | Receive generic webhook events |

#### API Keys

| Method | Path | Description |
|---|---|---|
| `POST` | `/api-keys` | Create a new API key |
| `GET` | `/api-keys` | List API keys (metadata only, not the keys themselves) |
| `DELETE` | `/api-keys/:id` | Revoke an API key |

**POST /api-keys**

```json
// Request
{
  "name": "mcp-server-production",
  "permissions": ["ingest", "read"]
}

// Response (201 Created) — key shown ONLY here
{
  "id": "key_abc123",
  "name": "mcp-server-production",
  "key": "agentlens_key_xxxxxxxxxxxxxxxxxxxxxxxx",
  "permissions": ["ingest", "read"],
  "createdAt": "2026-02-07T10:00:00Z"
}
```

#### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth required) |

```json
// Response
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 86400,
  "database": "sqlite",
  "eventCount": 84310
}
```

---

## 14. Scope & MVP Definition

### v0.1.0 — MVP (Target: 6 weeks)

**Goal:** A working end-to-end system: agents emit events via MCP → events stored → queryable via API → viewable in dashboard.

| Component | Scope |
|---|---|
| **@agentlens/core** | Event types, session types, Zod schemas, utility functions |
| **@agentlens/mcp-server** | MCP server with 3 tools (start_session, log_event, end_session); batch buffering; stdio transport |
| **@agentlens/server** | Hono API server; SQLite storage (Drizzle); event ingestion + query endpoints; session endpoints; API key auth; serves dashboard SPA |
| **@agentlens/dashboard** | React SPA; Overview page (stats + charts); Sessions list page; Session detail page (timeline); Events page; Settings page (API keys) |

**Explicitly out of scope for MVP:**
- AgentGate/FormBridge integrations (P1)
- Cost tracking (P1)
- Alerting (P1)
- PostgreSQL support (P2)
- Multi-user auth (P2)
- MCP proxy mode (future)
- SSE/WebSocket real-time (polling only for MVP)
- Export/compliance features (P2)

### v0.2.0 — Integrations (Target: +4 weeks after MVP)

| Component | Scope |
|---|---|
| **AgentGate integration** | Webhook receiver, event mapping, session correlation, timeline rendering |
| **FormBridge integration** | Webhook receiver, event mapping, session correlation |
| **Cost tracking** | Cost fields on events/sessions, cost analytics endpoint, cost charts on dashboard |
| **Alerting (basic)** | Alert rule CRUD, webhook alert channel, alert history |
| **Dashboard enhancements** | Agents page, cost charts, integration events in timeline, SSE for live updates |
| **SDK package** | `@agentlens/sdk` — programmatic TypeScript client for the API |

### v0.3.0+ — Scale & Teams (Future)

| Feature | Description |
|---|---|
| PostgreSQL backend | For teams needing > 1M events/day |
| Multi-user auth | OAuth/email login, RBAC |
| Export & compliance | JSON/CSV export, SHA-256 audit chain, scheduled exports |
| Advanced analytics | Heatmaps, session comparison, anomaly detection |
| MCP proxy mode | Transparent tool call interception |
| Cloud offering | Hosted version with managed storage and retention |

---

## 15. Risks & Mitigations

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **SQLite write contention at scale** | Medium | High | WAL mode; batch writes; clear path to PostgreSQL for scaling |
| **MCP SDK breaking changes** | Medium | High | Pin SDK version; abstract MCP interactions behind internal interface |
| **Large event payloads causing storage bloat** | High | Medium | Enforce 10KB payload limit with truncation; configurable retention |
| **Dashboard performance with large datasets** | Medium | Medium | Virtual scrolling; pagination; indexed queries; time-range limits |
| **Event buffering data loss** | Low | High | Local file-based buffer as fallback; flush-on-shutdown hook |

### Market Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Langfuse adds MCP support** | Medium | High | Move fast; differentiate on AgentGate/FormBridge integration and full-stack agent lifecycle |
| **MCP protocol loses adoption** | Low | Critical | Event model is protocol-agnostic; MCP server is one ingestion path among several |
| **Competitors enter the space** | High | Medium | Open source + integrated ecosystem (AgentKit) creates lock-in through convenience, not vendor lock |

### Adoption Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Agents don't emit enough context** | Medium | High | Provide sensible defaults; auto-capture as much as possible; make manual instrumentation minimal |
| **Developers don't see value until they have a problem** | High | Medium | Ship with demo/example agent showing the "aha moment"; focus marketing on debugging stories |
| **Too complex to set up** | Medium | High | One-command setup (npx); zero-config defaults; embedded dashboard (no separate deployment) |

---

## 16. Open Questions

### Architecture

| # | Question | Context | Decision Needed By |
|---|---|---|---|
| **OQ-1** | Should the MCP server support proxy mode in MVP? | Proxy mode would auto-capture all tool calls without explicit instrumentation, but adds significant complexity. Current plan: explicit tools only for MVP. | Architecture review |
| **OQ-2** | Should events be stored as structured columns or as a single JSON blob? | Structured columns enable efficient querying; JSON blob is more flexible. Current plan: hybrid (key fields as columns + payload as JSON). | Architecture review |
| **OQ-3** | How to handle event ordering when timestamps are identical? | Multiple events can share the same millisecond timestamp. Current plan: secondary sort by `createdAt` (server receipt time) + sequence number. | Implementation |

### Integration

| # | Question | Context | Decision Needed By |
|---|---|---|---|
| **OQ-4** | Should AgentGate/FormBridge integrations be push (webhook) or pull (polling)? | Webhooks are more real-time but require the source to support them. AgentGate already has webhooks. FormBridge needs webhook support added. | v0.2.0 planning |
| **OQ-5** | How should session correlation work when the agent doesn't pass a session ID? | We can try to match by agent ID + time proximity, but this is fragile. | v0.2.0 planning |
| **OQ-6** | Should AgentLens provide an AgentGate policy that auto-logs approval decisions? | This would make integration zero-config for AgentGate users, but couples the projects more tightly. | v0.2.0 planning |

### Product

| # | Question | Context | Decision Needed By |
|---|---|---|---|
| **OQ-7** | Should the dashboard support dark mode from MVP? | Most developer tools have dark mode. Adds design scope but increases developer appeal. | Design phase |
| **OQ-8** | What's the right default retention period? | 30 days is proposed. Too short = lost data, too long = storage costs for self-hosters. | MVP |
| **OQ-9** | Should there be a CLI tool for querying events from the terminal? | Developers may prefer CLI over browser dashboard. Could be a lightweight addition. | Post-MVP |
| **OQ-10** | Should event payload contain raw tool responses or summarized/truncated versions? | Full payloads are better for debugging but create storage concerns. Current plan: truncate at 10KB, store full payload hash for integrity. | Architecture review |

### Business

| # | Question | Context | Decision Needed By |
|---|---|---|---|
| **OQ-11** | When to introduce the cloud/paid tier? | Too early = premature complexity. Too late = no revenue signal. Suggested: after 500+ GitHub stars and consistent community usage. | 6 months post-MVP |
| **OQ-12** | Should AgentLens be a separate npm org or under @agentkit? | Separate org gives independence; shared org shows ecosystem cohesion. | Before first publish |

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **MCP** | Model Context Protocol — standard for connecting AI agents to tool servers |
| **Event** | A single recorded action, decision, or state change in an agent's execution |
| **Session** | A logical grouping of events representing one agent task/run |
| **Agent** | An AI system that uses MCP tools to perform actions |
| **AgentGate** | Sibling project: approval and policy engine for agent actions |
| **FormBridge** | Sibling project: agent-human data collection via forms |
| **AgentKit** | Umbrella name for the FormBridge + AgentGate + AgentLens ecosystem |
| **Flight Recorder** | Metaphor for AgentLens: like an airplane's black box, but for AI agents |

## Appendix B: Related Documents

| Document | Location |
|---|---|
| Product Brief | `_bmad-output/planning-artifacts/product-brief.md` |
| Architecture Document | `_bmad-output/planning-artifacts/architecture.md` (TBD) |
| UX Design | `_bmad-output/planning-artifacts/ux-design.md` (TBD) |
| Epics & Stories | `_bmad-output/planning-artifacts/epics-stories.md` (TBD) |

---

*This PRD is a living document. It will be updated as architecture decisions are made and user feedback is incorporated.*

# Architecture Overview

AgentLens is a monorepo with six packages that form a layered observability platform.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Hosts                              │
│                                                                 │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│   │  Claude     │  │  GPT-4     │  │  Custom    │               │
│   │  Desktop    │  │  Agent     │  │  Agent     │               │
│   └─────┬──────┘  └─────┬──────┘  └─────┬──────┘               │
│         └────────────────┼───────────────┘                      │
│                          │ MCP Protocol (stdio)                 │
│                          ▼                                      │
│   ┌──────────────────────────────────────┐                      │
│   │        @agentlens/mcp                │                      │
│   │   4 Tools: session_start, log_event, │                      │
│   │   session_end, query_events          │                      │
│   └──────────────┬───────────────────────┘                      │
│                  │ HTTP POST (batched events)                   │
└──────────────────┼──────────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    @agentlens/server                             │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │ Event Ingest │  │ Query Engine │  │ Alert Engine │         │
│   │ POST /api/   │  │ GET /api/    │  │              │         │
│   │ events       │  │ events|      │  │ Rules eval   │         │
│   │              │  │ sessions|    │  │ Webhooks     │         │
│   │ Webhook Rx   │  │ analytics    │  │              │         │
│   └──────┬───────┘  └──────┬───────┘  └──────────────┘         │
│          │                 │                                     │
│          ▼                 ▼                                     │
│   ┌──────────────────────────────────┐                          │
│   │         @agentlens/core          │                          │
│   │   Types · Schemas · Hash Chain   │                          │
│   │   Storage Interface (IEventStore)│                          │
│   └──────────────────────────────────┘                          │
│          │                                                      │
│          ▼                                                      │
│   ┌──────────────┐  ┌──────────────┐                            │
│   │   SQLite     │  │ PostgreSQL   │                            │
│   │  (default)   │  │  (team)      │                            │
│   └──────────────┘  └──────────────┘                            │
│                                                                 │
│   ┌──────────────────────────────────┐                          │
│   │     @agentlens/dashboard         │                          │
│   │   React SPA (served at /)        │                          │
│   │   Overview · Sessions · Events   │                          │
│   │   Analytics · Alerts · Settings  │                          │
│   └──────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘

        External Integrations (webhooks):
  ┌──────────┐  ┌────────────┐  ┌────────────┐
  │AgentGate │  │ FormBridge │  │ Third-party│
  └─────┬────┘  └─────┬──────┘  └─────┬──────┘
        └──────────────┼───────────────┘
                       ▼
             POST /api/events/ingest
```

## Package Dependency Graph

```
@agentlens/core          (no internal deps)
     ▲
     ├── @agentlens/mcp
     ├── @agentlens/server
     ├── @agentlens/dashboard
     └── @agentlens/sdk
              ▲
              └── @agentlens/cli
```

## Design Principles

### Event Sourcing / Append-Only

All data is an immutable, append-only event log. No UPDATE or DELETE on the events table. This guarantees complete audit trails, temporal queries, tamper evidence, and compliance.

### MCP-Native

AgentLens ships as an MCP server. Agents add it to their MCP config — zero code changes required. Works with any MCP client.

### Interface-Based / Pluggable

All major subsystems are defined by TypeScript interfaces. Storage backends are pluggable (SQLite default, PostgreSQL for teams). Event processing supports middleware.

### Local-First, Cloud-Ready

SQLite out of the box — no external dependencies. PostgreSQL available for shared access. Self-hosting is a first-class citizen.

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20, TypeScript ≥ 5.7 |
| HTTP Server | Hono |
| ORM | Drizzle ORM |
| Database | SQLite (better-sqlite3) / PostgreSQL |
| Dashboard | React 18, Vite, Tailwind CSS, Recharts |
| MCP | @modelcontextprotocol/sdk |
| Validation | Zod |
| IDs | ULID (time-sortable) |
| Build | pnpm workspaces, TypeScript project references |
| Testing | Vitest |
| Versioning | Changesets |

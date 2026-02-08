# Introduction

## What is AgentLens?

**AgentLens** is an open-source observability and audit trail platform for AI agents. Think of it as a flight recorder — it captures every tool call, approval decision, data exchange, and error your agents produce, then presents it through a queryable API and web dashboard.

## Why AgentLens?

The AI agent ecosystem has exploded, yet observability infrastructure is virtually nonexistent. Teams deploy agents to production with zero visibility into what those agents actually do.

When an agent fails, there's no trace. When it succeeds, there's no understanding of why. When auditors ask what happened, there's no record.

AgentLens fills this gap.

## Key Features

| Feature | Description |
|---|---|
| **MCP-Native** | Ships as an MCP server — agents connect to it like any other tool |
| **Real-Time Dashboard** | Session timelines, event explorer, analytics charts, alerting |
| **Tamper-Evident** | Append-only storage with SHA-256 hash chains per session |
| **Cost Tracking** | Token usage and estimated costs per session, agent, and time period |
| **Alerting** | Configurable rules for error rate, cost spikes, latency anomalies |
| **Integrations** | First-class support for AgentGate (approvals) and FormBridge (data collection) |
| **Self-Hosted** | SQLite by default, PostgreSQL optional. Your data, your infrastructure |

## Architecture at a Glance

```
AI Agents (Claude, GPT, Custom)
       │
       │ MCP Protocol (stdio/SSE)
       ▼
┌─────────────────────┐
│  @agentlensai/mcp     │  ← MCP server with 4 tools
└────────┬────────────┘
         │ HTTP
         ▼
┌─────────────────────┐
│  @agentlensai/server  │  ← Hono API + Dashboard
│  ┌───────────────┐  │
│  │ SQLite / PG   │  │  ← Append-only event store
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ React SPA     │  │  ← Dashboard UI
│  └───────────────┘  │
└─────────────────────┘
```

## Part of the AgentKit Suite

AgentLens is designed to work alongside:

- **[AgentGate](https://github.com/amitpaz/agentgate)** — Human-in-the-loop approval gateway for sensitive agent actions
- **[FormBridge](https://github.com/amitpaz/formbridge)** — Structured data collection from humans during agent workflows

Together, they provide unified agent lifecycle management: data collection → approvals → observability.

## Packages

AgentLens is a monorepo with six packages:

| Package | npm | Description |
|---|---|---|
| `@agentlensai/core` | [![npm](https://img.shields.io/npm/v/@agentlensai/core)](https://npmjs.com/package/@agentlensai/core) | Shared types, schemas, and utilities |
| `@agentlensai/server` | [![npm](https://img.shields.io/npm/v/@agentlensai/server)](https://npmjs.com/package/@agentlensai/server) | Hono API server + dashboard |
| `@agentlensai/mcp` | [![npm](https://img.shields.io/npm/v/@agentlensai/mcp)](https://npmjs.com/package/@agentlensai/mcp) | MCP server for agent instrumentation |
| `@agentlensai/dashboard` | — | React dashboard (bundled with server) |
| `@agentlensai/sdk` | [![npm](https://img.shields.io/npm/v/@agentlensai/sdk)](https://npmjs.com/package/@agentlensai/sdk) | Programmatic TypeScript client |
| `@agentlensai/cli` | [![npm](https://img.shields.io/npm/v/@agentlensai/cli)](https://npmjs.com/package/@agentlensai/cli) | Command-line interface |

<p align="center">
  <h1 align="center">🔍 AgentLens</h1>
  <p align="center">
    <strong>Open-source observability & audit trail for AI agents</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@agentlensai/server"><img src="https://img.shields.io/npm/v/@agentlensai/server?label=server" alt="npm server"></a>
    <a href="https://www.npmjs.com/package/@agentlensai/mcp"><img src="https://img.shields.io/npm/v/@agentlensai/mcp?label=mcp" alt="npm mcp"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/amitpaz/agentlens/actions"><img src="https://img.shields.io/github/actions/workflow/status/amitpaz/agentlens/ci.yml?branch=main" alt="Build Status"></a>
  </p>
</p>

---

<p align="center">
  <img src="demo/agentlens-demo.gif" alt="AgentLens Demo" width="720">
</p>

AgentLens is a **flight recorder for AI agents**. It captures every tool call, approval decision, data exchange, and error — then presents it through a queryable API and real-time web dashboard.

**MCP-native.** Add one config block → every tool call is captured automatically. Zero code changes.

## ✨ Key Features

- **🔌 MCP-Native** — Ships as an MCP server. Agents connect to it like any other tool. Works with Claude Desktop, Cursor, and any MCP client.
- **📊 Real-Time Dashboard** — Session timelines, event explorer, cost analytics, and alerting in a beautiful web UI.
- **🔒 Tamper-Evident Audit Trail** — Append-only event storage with SHA-256 hash chains per session. Cryptographically linked and verifiable.
- **💰 Cost Tracking** — Track token usage and estimated costs per session, per agent, over time. Alert on cost spikes.
- **🚨 Alerting** — Configurable rules for error rate, cost threshold, latency anomalies, and inactivity.
- **🔗 AgentKit Ecosystem** — First-class integrations with [AgentGate](https://github.com/amitpaz/agentgate) (approval flows) and [FormBridge](https://github.com/amitpaz/formbridge) (data collection).
- **🏠 Self-Hosted** — SQLite by default, no external dependencies. MIT licensed. Your data stays on your infrastructure.

## 📸 Dashboard

AgentLens ships with a real-time web dashboard for monitoring your agents.

### Overview — At-a-Glance Metrics

![Dashboard Overview](demo/dashboard-overview.jpg)

The overview page shows **live metrics** — sessions, events, errors, and active agents — with a 24-hour event timeline chart, recent sessions with status badges (active/completed), and a recent errors feed. Everything updates in real-time via SSE.

### Sessions — Track Every Agent Run

![Sessions List](demo/dashboard-sessions.jpg)

The sessions table shows **every agent session** with sortable columns: agent name, status, start time, duration, event count, error count, and total cost. Filter by agent or status (Active / Completed / Error) to drill down.

### Session Detail — Timeline & Hash Chain

![Session Detail](demo/dashboard-session-detail.jpg)

Click into any session to see the **full event timeline** — every tool call, error, cost event, and session lifecycle event in chronological order. The green **✓ Chain Valid** badge confirms the tamper-evident hash chain is intact. Filter by event type (Tool Calls, Errors, Approvals, Custom). Cost breakdown shows token usage and spend.

### Events Explorer — Search & Filter Everything

![Events Explorer](demo/dashboard-events.jpg)

The events explorer gives you a **searchable, filterable view** of every event across all sessions. Filter by event type, severity, agent, or time range. Full-text search works on payload content. Each row shows the tool name, agent, session, severity level, and duration.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agents (Claude Desktop, Cursor, GPT-4, Custom)          │
│                        │                                    │
│                        │ MCP Protocol (stdio)               │
│                        ▼                                    │
│  ┌──────────────────────────────────────┐                   │
│  │       @agentlensai/mcp                 │                   │
│  │  Tools: session_start · log_event    │                   │
│  │         session_end · query_events   │                   │
│  └──────────────┬───────────────────────┘                   │
│                 │ HTTP (batched events)                      │
└─────────────────┼───────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              @agentlensai/server                               │
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │  Ingest    │ │   Query    │ │   Alert    │               │
│  │  Engine    │ │   Engine   │ │   Engine   │               │
│  └─────┬──────┘ └─────┬──────┘ └────────────┘               │
│        └───────────────┘                                     │
│               │                                              │
│        ┌──────┴──────┐         ┌─────────────┐               │
│        │   SQLite    │         │  Dashboard  │               │
│        │  (append    │         │  React SPA  │               │
│        │   only)     │         │  (served    │               │
│        └─────────────┘         │   at /)     │               │
│                                └─────────────┘               │
└──────────────────────────────────────────────────────────────┘

  Integrations:  AgentGate ──┐
                 FormBridge ─┤──► POST /api/events/ingest
                 Generic ────┘     (HMAC-SHA256 verified)
```

## 🚀 Quick Start

### 1. Start the Server

```bash
npx @agentlensai/server
```

Opens on **http://localhost:3400** with SQLite — zero config.

### 2. Create an API Key

```bash
curl -X POST http://localhost:3400/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Save the `als_...` key from the response — it's shown only once.

### 3. Add to Your Agent

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp"],
      "env": {
        "AGENTLENS_API_URL": "http://localhost:3400",
        "AGENTLENS_API_KEY": "als_your_key_here"
      }
    }
  }
}
```

### 4. Open the Dashboard

Navigate to **http://localhost:3400** — see sessions, timelines, analytics, and alerts in real time.

## 📦 Packages

| Package | Description | npm |
|---|---|---|
| [`@agentlensai/core`](./packages/core) | Shared types, schemas, hash chain utilities | [![npm](https://img.shields.io/npm/v/@agentlensai/core)](https://npmjs.com/package/@agentlensai/core) |
| [`@agentlensai/server`](./packages/server) | Hono API server + dashboard serving | [![npm](https://img.shields.io/npm/v/@agentlensai/server)](https://npmjs.com/package/@agentlensai/server) |
| [`@agentlensai/mcp`](./packages/mcp) | MCP server for agent instrumentation | [![npm](https://img.shields.io/npm/v/@agentlensai/mcp)](https://npmjs.com/package/@agentlensai/mcp) |
| [`@agentlensai/dashboard`](./packages/dashboard) | React web dashboard (bundled with server) | private |
| [`@agentlensai/sdk`](./packages/sdk) | Programmatic TypeScript client | [![npm](https://img.shields.io/npm/v/@agentlensai/sdk)](https://npmjs.com/package/@agentlensai/sdk) |
| [`@agentlensai/cli`](./packages/cli) | Command-line interface | [![npm](https://img.shields.io/npm/v/@agentlensai/cli)](https://npmjs.com/package/@agentlensai/cli) |

## 🔌 API Overview

| Endpoint | Description |
|---|---|
| `POST /api/events` | Ingest events (batch) |
| `GET /api/events` | Query events with filters |
| `GET /api/sessions` | List sessions |
| `GET /api/sessions/:id/timeline` | Session timeline with hash chain verification |
| `GET /api/analytics` | Bucketed metrics over time |
| `GET /api/analytics/costs` | Cost breakdown by agent |
| `POST /api/alerts/rules` | Create alert rules |
| `POST /api/events/ingest` | Webhook ingestion (AgentGate/FormBridge) |
| `POST /api/keys` | Create API keys |

[Full API Reference →](./docs/reference/api.md)

## 🔗 Part of the AgentKit Suite

AgentLens works alongside two companion projects for unified agent lifecycle management:

| Project | Role | Link |
|---|---|---|
| **AgentGate** | Human-in-the-loop approval gateway | [github.com/amitpaz/agentgate](https://github.com/amitpaz/agentgate) |
| **FormBridge** | Structured data collection from humans | [github.com/amitpaz/formbridge](https://github.com/amitpaz/formbridge) |
| **AgentLens** | Observability & audit trail | You are here |

Together: **data collection → approvals → observability**.

Approval events from AgentGate and form submissions from FormBridge appear directly in AgentLens session timelines, giving you a single view of the complete agent lifecycle.

## 🛠️ Development

```bash
# Clone and install
git clone https://github.com/amitpaz/agentlens.git
cd agentlens
pnpm install

# Run all checks
pnpm typecheck
pnpm test
pnpm lint

# Start dev server
pnpm dev
```

### Requirements

- Node.js ≥ 20.0.0
- pnpm ≥ 10.0.0

## 📄 License

[MIT](LICENSE) © [Amit Paz](https://github.com/amitpaz)

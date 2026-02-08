<p align="center">
  <h1 align="center">🔍 AgentLens</h1>
  <p align="center">
    <strong>Open-source observability & audit trail for AI agents</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@agentlens/server"><img src="https://img.shields.io/npm/v/@agentlens/server?label=server" alt="npm server"></a>
    <a href="https://www.npmjs.com/package/@agentlens/mcp"><img src="https://img.shields.io/npm/v/@agentlens/mcp?label=mcp" alt="npm mcp"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/amitpaz/agentlens/actions"><img src="https://img.shields.io/github/actions/workflow/status/amitpaz/agentlens/ci.yml?branch=main" alt="Build Status"></a>
  </p>
</p>

---

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

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agents (Claude Desktop, Cursor, GPT-4, Custom)          │
│                        │                                    │
│                        │ MCP Protocol (stdio)               │
│                        ▼                                    │
│  ┌──────────────────────────────────────┐                   │
│  │       @agentlens/mcp                 │                   │
│  │  Tools: session_start · log_event    │                   │
│  │         session_end · query_events   │                   │
│  └──────────────┬───────────────────────┘                   │
│                 │ HTTP (batched events)                      │
└─────────────────┼───────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              @agentlens/server                               │
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
npx @agentlens/server
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
      "args": ["@agentlens/mcp"],
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
      "args": ["@agentlens/mcp"],
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
| [`@agentlens/core`](./packages/core) | Shared types, schemas, hash chain utilities | [![npm](https://img.shields.io/npm/v/@agentlens/core)](https://npmjs.com/package/@agentlens/core) |
| [`@agentlens/server`](./packages/server) | Hono API server + dashboard serving | [![npm](https://img.shields.io/npm/v/@agentlens/server)](https://npmjs.com/package/@agentlens/server) |
| [`@agentlens/mcp`](./packages/mcp) | MCP server for agent instrumentation | [![npm](https://img.shields.io/npm/v/@agentlens/mcp)](https://npmjs.com/package/@agentlens/mcp) |
| [`@agentlens/dashboard`](./packages/dashboard) | React web dashboard (bundled with server) | private |
| [`@agentlens/sdk`](./packages/sdk) | Programmatic TypeScript client | [![npm](https://img.shields.io/npm/v/@agentlens/sdk)](https://npmjs.com/package/@agentlens/sdk) |
| [`@agentlens/cli`](./packages/cli) | Command-line interface | [![npm](https://img.shields.io/npm/v/@agentlens/cli)](https://npmjs.com/package/@agentlens/cli) |

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

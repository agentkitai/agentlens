# AgentLens — Product Brief

## Vision
AgentLens is an observability and audit trail platform for AI agents. It provides a "flight recorder" that captures every tool call, decision, approval, and data exchange an agent makes — giving teams the visibility they need to trust, debug, and improve their AI agents in production.

## Problem Statement
Teams deploying AI agents have no visibility into what their agents are actually doing. When something goes wrong, there's no audit trail. When things go right, there's no way to understand why. The AI agent ecosystem has exploded (8,500+ repos, 7,100+ MCP servers) but the observability layer is virtually nonexistent (only 12 repos tagged `agent-observability` on GitHub).

## Target Users
1. **Developer teams building AI agents** — Need to debug agent behavior, understand tool call patterns, and trace decision paths
2. **Engineering managers / Team leads** — Need cost tracking, usage analytics, and compliance audit trails
3. **Compliance / Security teams** — Need immutable logs of what agents did, why, and who approved it

## Key Differentiators
1. **MCP-native** — Ships as an MCP server that agents connect to naturally (not a bolt-on SDK)
2. **Integrates with AgentGate** — Approval events flow directly into the observability timeline
3. **Integrates with FormBridge** — Data collection events and field attribution tracked end-to-end
4. **Part of the AgentKit suite** — Unified agent lifecycle management (data collection → approvals → observability)
5. **Open source** — MIT licensed, self-hostable, no vendor lock-in

## Core Capabilities (Initial Scope)
1. **Event Capture** — Log every MCP tool call, response, error, and timing
2. **Decision Timeline** — Visual timeline of agent decisions with context
3. **Approval Integration** — AgentGate approval/rejection events appear in the timeline
4. **Data Flow Tracking** — FormBridge submission events show data handoff points
5. **Cost Tracking** — Token usage and API cost per agent session
6. **Dashboard** — Web UI showing agent activity, patterns, anomalies
7. **Alerting** — Configurable alerts on error rates, cost spikes, unusual patterns
8. **Export / API** — Query audit data programmatically, export for compliance

## Technical Direction
- **TypeScript** (consistent with FormBridge and AgentGate)
- **MCP Server** for agent-side instrumentation
- **Hono** for HTTP API
- **React** dashboard (consistent with AgentGate dashboard)
- **SQLite** for local/self-hosted, **PostgreSQL** for cloud/team
- **Event-driven architecture** — append-only event log, materialized views for queries

## Market Context
- **Competitors:** Virtually none in open-source agent observability
  - Cozeloop (Coze/ByteDance) — closed-source, proprietary ecosystem
  - Langfuse — LLM observability but not agent-focused
  - Arize Phoenix — ML observability, not agent lifecycle
  - AgentOps — early stage, Python-only
- **Our edge:** MCP-native + integrated with approval/data collection tools + open source + TypeScript

## Success Metrics
- GitHub stars (awareness)
- npm downloads (adoption)
- Number of agents instrumented
- Active dashboard users
- Events captured per day

## Revenue Model (Future)
- **Open core** — Free self-hosted, paid cloud/team features
- **Cloud tier:** $29-99/mo per team (hosted dashboard, alerts, retention)
- **Enterprise:** Custom pricing (SSO, advanced compliance, SLA)

## Relationship to Existing Projects
```
AgentKit (umbrella)
├── FormBridge  → Agent ↔ Human data collection
├── AgentGate   → Agent action approval & policy engine
└── AgentLens   → Agent observability & audit trail (THIS PROJECT)
```

Together these three cover the full agent lifecycle: agents gather data (FormBridge) → agents request permission to act (AgentGate) → everything is observed and auditable (AgentLens).

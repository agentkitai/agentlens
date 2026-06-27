# @agentkitai/agentlens-sdk

## 0.14.6

### Patch Changes

- Updated dependencies [3fa978c]
  - @agentkitai/agentlens-core@0.20.0

## 0.14.5

### Patch Changes

- Updated dependencies [26519c6]
  - @agentkitai/agentlens-core@0.19.0

## 0.14.4

### Patch Changes

- Updated dependencies [930aa11]
  - @agentkitai/agentlens-core@0.18.0

## 0.14.3

### Patch Changes

- Updated dependencies [e1b9dce]
  - @agentkitai/agentlens-core@0.17.0

## 0.14.2

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.16.0

## 0.14.1

### Patch Changes

- ae2a5d9: Fix the stale `@agentkitai/agentlens-core` dependency range (`^0.8.0` → `workspace:*`).
  The published `sdk@0.14.0` pinned `core@^0.8.0`, which resolved to the long-stale
  `core@0.8.0` on install instead of the matching current core. `workspace:*` is
  rewritten to the exact core version at publish time (matching server/mcp).
- Updated dependencies
  - @agentkitai/agentlens-core@0.15.0

## 0.14.0

### Minor Changes

- 10-feature product roadmap implementation.
  - Secure-by-default auth with production warnings
  - Session debug replay with speed control
  - Unified cost attribution (by model, agent, session, tool)
  - Audit chain verification and signed compliance export
  - Guardrails action engine v2 (rate_limit, block, downgrade)
  - MCP policy enforcement and evaluation API
  - Agent lifecycle insights dashboard
  - Helm chart and hardened Docker deployment kit
  - API contract governance with version middleware
  - Autonomous optimization advisor

## 0.2.0

### Minor Changes

- Initial release of AgentLens — open-source observability and audit trail platform for AI agents.
  - MCP server with 4 tools for agent instrumentation
  - REST API with event ingestion, sessions, analytics, alerts
  - React dashboard with real-time SSE updates
  - TypeScript SDK and CLI
  - AgentGate + FormBridge webhook integrations
  - Cost tracking and analytics
  - Configurable alerting system

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.2.0

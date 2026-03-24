# @agentlensai/server

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
  - @agentlensai/core@0.2.0

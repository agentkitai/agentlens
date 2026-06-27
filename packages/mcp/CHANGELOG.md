# @agentkitai/agentlens-mcp

## 0.13.8

### Patch Changes

- Updated dependencies [26519c6]
  - @agentkitai/agentlens-core@0.19.0

## 0.13.7

### Patch Changes

- Updated dependencies [930aa11]
  - @agentkitai/agentlens-core@0.18.0

## 0.13.6

### Patch Changes

- Updated dependencies [e1b9dce]
  - @agentkitai/agentlens-core@0.17.0

## 0.13.5

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.16.0

## 0.13.4

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.15.0

## 0.13.2

### Patch Changes

- d05c270: MCP server: bound the startup capability probe to a tight 1.5s timeout (configurable via `AGENTLENS_MCP_PROBE_TIMEOUT_MS`) so an unreachable or slow `AGENTLENS_URL` can't delay the stdio `initialize` handshake. An MCP stdio server must respond promptly, but boot awaited the probe (a network call) before connecting the transport — fine for `localhost` (refuses instantly) but a remote host that drops packets would stall startup up to 5s. The probe stays fail-open (a timeout registers all tools), so this only changes timing, not behavior.
- Updated dependencies [6a8c268]
- Updated dependencies [18428ae]
  - @agentkitai/agentlens-core@0.14.0

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

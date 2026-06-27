# @agentkitai/agentlens-cli

## 0.14.3

### Patch Changes

- @agentkitai/agentlens-sdk@0.14.5

## 0.14.2

### Patch Changes

- @agentkitai/agentlens-sdk@0.14.4

## 0.14.1

### Patch Changes

- @agentkitai/agentlens-sdk@0.14.3

## 0.14.0

### Minor Changes

- `agentlens eval-gate` (#55 Phase 5): gate CI/CD on an eval pass-rate (exit 1 below
  threshold). Trace-scoring mode scores a set of sessions against a catalog evaluator
  (no agent webhook); dataset-run mode triggers a dataset eval against a live agent
  webhook and gates on passedCases/totalCases. Pairs with the composite GitHub Action
  at `.github/actions/eval-gate`.

## 0.13.3

### Patch Changes

- @agentkitai/agentlens-sdk@0.14.2

## 0.13.2

### Patch Changes

- Updated dependencies [ae2a5d9]
  - @agentkitai/agentlens-sdk@0.14.1

## 0.13.1

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-sdk@0.14.0

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
  - @agentkitai/agentlens-sdk@0.2.0

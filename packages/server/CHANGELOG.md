# @agentlensai/server

## 0.15.0

### Minor Changes

- 52182fb: Verify and stamp agent identity on ingest (#12 Phase 2 — the cross-repo wedge).

  `POST /api/events` now accepts an AgentGate-minted agent token via the `X-Agent-Token` header. When present and valid, every event in the batch gets a **server-authoritative** `verifiedAgentId` (plus `verifiedAgentMethod: "agentgate_token"`) stamped into its metadata — turning the self-reported `agentId` into a cryptographically attributable one on the tamper-evident audit trail.

  - The verified id lives in event **metadata**, which is already part of the hashed payload, so the stamp is itself tamper-evident **without** changing the hashed field set (existing hash chains stay valid — no `HASH_VERSION` bump).
  - It is **forgery-proof**: the reserved `verifiedAgentId`/`verifiedAgentMethod` metadata keys are always stripped from client input and only re-set after the server verifies the token, so a client can never inject them. The webhook ingest path (`POST /api/events/ingest`) also strips these reserved keys from caller-supplied context (it never stamps — HMAC there proves the source, not the agent identity); the OTLP path builds metadata server-side and is unaffected.
  - Verification mirrors AgentGate (shared `agentkit-auth`): HS256 signature over the shared secret **plus** the load-bearing `typ:"agent"` claim. A user token, an expired token, or a wrong-key token is ignored (no stamp).
  - New env var **`AGENTGATE_JWT_SECRET`** — AgentGate's signing secret, shared with AgentLens to verify agent tokens. When unset, the feature is off and ingest is unchanged. Verification is cryptographic only (no callback to AgentGate); agent tokens are short-lived, which bounds staleness.

  See AgentGate's `docs/agent-identity.md` for the full identity model and trust boundary.

- 6a8c268: Centralize LLM model pricing in a new `@agentkit/pricing` package, sourced from LiteLLM's published prices with an embedded fallback.

  - Consolidates the two server-side cost tables (`@agentlensai/core` `DEFAULT_MODEL_COSTS` and the cloud `batch-writer` table) onto one source of truth — they had drifted in both units (per-1M vs per-1K) and model coverage.
  - Fixes the cloud-ingest path, which previously returned no cost for modern model ids (e.g. `claude-opus-4-8`) because its hand-maintained table used outdated key formats.
  - Refreshes prices live from LiteLLM at server startup (fire-and-forget, falls back to the embedded table on failure). Off-switch: `AGENTKIT_PRICING_REFRESH=false`.

  `@agentlensai/core` continues to re-export `DEFAULT_MODEL_COSTS` / `lookupModelCost` and now also exports `costUsd` and `refreshFromLiteLLM` — no breaking change for existing consumers.

- 18428ae: Add compliance evals on the tamper-evident audit trail (#55, Phase 1).

  A deterministic compliance scorer evaluates a completed session's events against policy rules — denied tools (`tool_denylist`, supports `delete_*` wildcards), `tool_allowlist`, `max_cost`, and a `no_severity_above` ceiling — with no LLM dependency, so the result is provable and reproducible.

  - New `eval_result` event type + `EvalResultPayload`. The scoring outcome is emitted server-side as a SHA-256 hash-chained event in the session's audit trail, so eval results are themselves tamper-evident evidence ("we ran the eval, here's the cryptographic proof"). It is deliberately excluded from the public ingest schema so clients cannot forge eval results.
  - New endpoint `POST /api/eval/sessions/:sessionId/compliance` — scores a completed session against inline `rules` and records the chained `eval_result`. Strict pass/fail by default; an optional `passThreshold` switches to score-based.
  - `compliance` scorer type registered in the default scorer registry; `ScorerConfig.rules` carries the policy rules.

### Patch Changes

- Updated dependencies [6a8c268]
- Updated dependencies [18428ae]
  - @agentlensai/core@0.14.0

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

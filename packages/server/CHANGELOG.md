# @agentkitai/agentlens-server

## 0.19.0

### Minor Changes

- 930aa11: feat(spend): pricing provenance + reconciliation/drift (#89, Slice C). The final
  slice that makes per-agent spend billing-grade. `costUsd` is frozen at ingest-time
  pricing while the rate table is refreshed in place with no retroactive recompute,
  so stored sums silently drift.

  - `@agentkitai/pricing` adds `pricingVersion()` — a stable fingerprint of the
    active rate table (re-exported via `@agentkitai/agentlens-core`, alongside
    `getModelCosts`/`setModelCosts`).
  - A new `events.pricing_version` column (sqlite + postgres migrations) is stamped
    server-side at ingest on cost-bearing events (`cost_tracked`/`llm_response`) on
    **both** ingest paths — it's a provenance column, not part of the event hash.
  - `POST /api/internal/reconcile` (service-token, billing-aware grouping like
    `/spend`) recomputes each cost-bearing event at **current** pricing and returns a
    per-agent stored-vs-recompute **drift** report + threshold alert
    (`RECONCILE_DRIFT_THRESHOLD`, default 1%), signed with the audit signing key.
    Stale-priced events surface as drift with a `staleVersionCount`.

  The optional provider-invoice cross-check is deferred (provider usage is per-org,
  not per-agent, so it can only validate the aggregate). With `BILLING_GRADE_SPEND`
  on, per-agent spend is now billing-grade end to end (A+B+C); the flag stays
  default-OFF so guardrail mode is unchanged.

- 5a37f90: feat(spend): billing-grade verified attribution (#87, Slice A). Adds a dedicated,
  indexed `events.verified_agent_id` column (sqlite + postgres migrations), derived
  server-side at insert from the already-hashed `metadata.verifiedAgentId` stamp — it
  is never part of the hash input, so the chain stays valid, and never settable from
  client input. Behind a new default-OFF flag `BILLING_GRADE_SPEND`, `POST
/api/internal/spend` and `GET /api/analytics/costs` attribute cost by the verified
  id instead of the self-reported `agent_id`, so a spoofed `event.agentId` can no
  longer claim another agent's spend; unverified cost is surfaced in an
  "unattributed" bucket rather than billed. With the flag off, guardrail-mode
  behavior (today's `agent_id` grouping and response shape) is byte-for-byte unchanged.
- ac42e8e: feat(otlp): verify a longer-lived ingest key on the OTLP path (#24, Option 3).
  The OTLP verification gate (#88) only accepted the 15-min agent JWT, which is
  awkward for long-running exporters that can't refresh it — so in practice their
  spend fell to "unattributed" in billing mode. An OTLP exporter can now present a
  longer-lived, revocable, ingest-scoped credential (`X-Agent-Ingest-Key`, issued
  by AgentGate) set once in `OTEL_EXPORTER_OTLP_HEADERS`. AgentLens resolves it to
  a server-authoritative verified id by calling AgentGate's
  `/api/internal/verify-ingest-key` (new `AGENTGATE_URL` config, reusing
  `AGENTGATE_SERVICE_TOKEN`) with a short in-memory cache, so a revoked/rotated key
  stops resolving within ~60s. The lookup is **fail-open**: any error/timeout (or
  unconfigured `AGENTGATE_URL`) resolves to null → the span ingests unattributed,
  never mis-attributed. The agent JWT still wins when both credentials are present;
  the verified id is stamped with `verifiedAgentMethod: agentgate_ingest_key`.
  Token-path and guardrail behavior are unchanged.
- 9e9eda4: feat(otlp): verification gate on OTLP ingest (#88, Slice B). The OTLP path read
  the agent id straight from untrusted span/resource attributes, so per-agent
  attribution was spoofable. OTLP exporters can now present an AgentGate agent
  token as `X-Agent-Token` (e.g. via `OTEL_EXPORTER_OTLP_HEADERS`); every ingest
  path (traces, metrics, logs) verifies it with the same `verifyAgentToken`
  primitive `POST /api/events` uses and stamps the resulting server-authoritative
  verified id into the (server-built) metadata before hashing, so the Slice A
  `verified_agent_id` column is derived from it. A spoofed `agentlens.agentId` /
  `service.name` without a valid token stays unverified — unattributed in
  billing-grade mode — and OTLP keeps ingesting unverified spans unchanged (no
  rejection, same events/hash as before). This closes the OTLP half of the
  attribution gap; together with Slice A, both ingest paths now carry a verified
  id. Reconciliation (Slice C) remains before per-agent spend is fully billing-grade.

### Patch Changes

- Updated dependencies [930aa11]
  - @agentkitai/agentlens-core@0.18.0

## 0.18.0

### Minor Changes

- e1b9dce: feat(eval): agenteval→lens federation (#55). New service-token internal route
  `POST /api/internal/eval/run` records a completed agenteval suite run as a
  server-authoritative, hash-chained `eval_result` in a session's audit trail —
  the reverse of the existing import-FROM direction. Mirrors the gate→lens wedge:
  agenteval passes a synthetic per-run sessionId, the server genesis-chains the
  result, failed cases become violations, and `eval_result` stays excluded from
  the client ingest enum so evidence can't be forged.

### Patch Changes

- Updated dependencies [e1b9dce]
  - @agentkitai/agentlens-core@0.17.0

## 0.17.0

### Minor Changes

- Evaluator catalog (#55 Phase 4): reusable, named scorer definitions, browsable and
  instantiable into session scoring.

  - `EvaluatorDefinition` + `GET/POST/PUT/DELETE /api/eval/evaluators` (+ `/:id/publish`,
    `/:id/verify`); a `draft → published → verified` lifecycle. Built-in evaluators
    (PII / data-retention / authorization compliance + PII-leak / response-quality
    llm_judge) are seeded global + read-only.
  - `POST /api/eval/sessions/:id/compliance` and `/score` now accept an `evaluatorId`
    that resolves to the stored config (recorded on the hash-chained `eval_result`).
  - Dashboard catalog browse page at `/eval/evaluators` (ships in the container image).

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.16.0

## 0.16.0

### Minor Changes

- Compliance evals & prompt stack (#55 Phase 2):

  - **LLM-as-judge** scorer backed by a real Anthropic client (default `claude-haiku-4-5`, overridable) with token-cost tracking, plus `POST /api/eval/sessions/:id/score` to score a completed session against a rubric. Judgments are hash-chained as `eval_result` events labelled `method: "llm_judge"` — a judgment, recorded tamper-evidently, not a proof.
  - **Gate→lens wedge**: `POST /api/internal/eval/guardrail-breach` (service-token internal route) records an AgentGate guardrail breach as a deterministic compliance `eval_result` in the breaching session's audit trail.
  - **Prompt auto-discovery**: ingested `llm_call` system prompts are fingerprinted on both the OTLP and `/api/events` paths and surfaced via `GET /api/prompts/fingerprints`.
  - **Cache-aware cost**: prompt-cache read/write tokens are extracted from gen_ai OTLP spans and priced via `costUsdDetailed` (Anthropic/OpenAI cache rates), with per-version `estimatedCacheSavingsUsd` in prompt analytics.
  - **Dashboard** renders `eval_result` inline in session replay (PASS/FAIL + an "AI judgment" tag), and a new compliance-evals guide documents PII / data-retention / authorization rubrics. (Dashboard ships in the container image.)

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.15.0

## 0.15.0

### Minor Changes

- 52182fb: Verify and stamp agent identity on ingest (#12 Phase 2 — the cross-repo wedge).

  `POST /api/events` now accepts an AgentGate-minted agent token via the `X-Agent-Token` header. When present and valid, every event in the batch gets a **server-authoritative** `verifiedAgentId` (plus `verifiedAgentMethod: "agentgate_token"`) stamped into its metadata — turning the self-reported `agentId` into a cryptographically attributable one on the tamper-evident audit trail.

  - The verified id lives in event **metadata**, which is already part of the hashed payload, so the stamp is itself tamper-evident **without** changing the hashed field set (existing hash chains stay valid — no `HASH_VERSION` bump).
  - It is **forgery-proof**: the reserved `verifiedAgentId`/`verifiedAgentMethod` metadata keys are always stripped from client input and only re-set after the server verifies the token, so a client can never inject them. The webhook ingest path (`POST /api/events/ingest`) also strips these reserved keys from caller-supplied context (it never stamps — HMAC there proves the source, not the agent identity); the OTLP path builds metadata server-side and is unaffected.
  - Verification mirrors AgentGate (shared `@agentkitai/auth`): HS256 signature over the shared secret **plus** the load-bearing `typ:"agent"` claim. A user token, an expired token, or a wrong-key token is ignored (no stamp).
  - New env var **`AGENTGATE_JWT_SECRET`** — AgentGate's signing secret, shared with AgentLens to verify agent tokens. When unset, the feature is off and ingest is unchanged. Verification is cryptographic only (no callback to AgentGate); agent tokens are short-lived, which bounds staleness.

  See AgentGate's `docs/agent-identity.md` for the full identity model and trust boundary.

- 6a8c268: Centralize LLM model pricing in a new `@agentkit/pricing` package, sourced from LiteLLM's published prices with an embedded fallback.

  - Consolidates the two server-side cost tables (`@agentkitai/agentlens-core` `DEFAULT_MODEL_COSTS` and the cloud `batch-writer` table) onto one source of truth — they had drifted in both units (per-1M vs per-1K) and model coverage.
  - Fixes the cloud-ingest path, which previously returned no cost for modern model ids (e.g. `claude-opus-4-8`) because its hand-maintained table used outdated key formats.
  - Refreshes prices live from LiteLLM at server startup (fire-and-forget, falls back to the embedded table on failure). Off-switch: `AGENTKIT_PRICING_REFRESH=false`.

  `@agentkitai/agentlens-core` continues to re-export `DEFAULT_MODEL_COSTS` / `lookupModelCost` and now also exports `costUsd` and `refreshFromLiteLLM` — no breaking change for existing consumers.

- 18428ae: Add compliance evals on the tamper-evident audit trail (#55, Phase 1).

  A deterministic compliance scorer evaluates a completed session's events against policy rules — denied tools (`tool_denylist`, supports `delete_*` wildcards), `tool_allowlist`, `max_cost`, and a `no_severity_above` ceiling — with no LLM dependency, so the result is provable and reproducible.

  - New `eval_result` event type + `EvalResultPayload`. The scoring outcome is emitted server-side as a SHA-256 hash-chained event in the session's audit trail, so eval results are themselves tamper-evident evidence ("we ran the eval, here's the cryptographic proof"). It is deliberately excluded from the public ingest schema so clients cannot forge eval results.
  - New endpoint `POST /api/eval/sessions/:sessionId/compliance` — scores a completed session against inline `rules` and records the chained `eval_result`. Strict pass/fail by default; an optional `passThreshold` switches to score-based.
  - `compliance` scorer type registered in the default scorer registry; `ScorerConfig.rules` carries the policy rules.

### Patch Changes

- Updated dependencies [6a8c268]
- Updated dependencies [18428ae]
  - @agentkitai/agentlens-core@0.14.0

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

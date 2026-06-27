# @agentkitai/agentlens-core

## 0.20.0

### Minor Changes

- 3fa978c: Make skills first-class. Claude Code's `claude_code.skill_activated` log is now mapped to a dedicated `skill_activated` event type (added to core's `EventType`) instead of a generic custom event, so it gets real treatment everywhere that keys off event type:

  - **Server** — `/v1/logs` maps `skill_activated` → a typed `skill_activated` event (`skillName`/`source`/`pluginName`); new `GET /api/analytics/skills` returns per-skill activation counts.
  - **Dashboard** — a "Skills" filter chip in the session timeline, a "Skill Usage" chart in Analytics, and skill rows render with a 🧩 icon + skill name in both the session and replay timelines.

  `skill_activated` is OTLP/server-ingested (kept out of the client-ingest `eventTypeSchema`, like `eval_result`). Additive and fail-safe; SDK path untouched.

## 0.19.0

### Minor Changes

- 26519c6: Treat OTLP-ingested events as **unchained** so they no longer falsely report a broken tamper-evident hash chain.

  OTLP telemetry (OpenClaw diagnostics, OTel GenAI spans, Claude Code) is batched, multi-signal (metrics + logs export on independent schedules), out-of-order, and unauthenticated at ingest — so a linear `prevHash` chain is neither achievable nor meaningful for it. The receiver previously chained these events anyway, which surfaced as "chain invalid" on the session view for any real multi-signal source.

  Now OTLP events are stored with `prevHash = null` and a self-contained integrity hash (record-level tampering is still detectable), with **no** cross-event linkage. The strict linear chain is reserved for the SDK's in-order, authenticated stream and is unchanged. Verification detects an all-`null`-prevHash session as "unchained" and checks per-record integrity only (`/sessions/:id/timeline` now also returns `chained: boolean`); `insertEvents` accepts unchained appends without a continuity error.

  `core` adds `verifyRecords()` / `verifyRecordsRaw()` — record-integrity verifiers with no linkage (the strict `verifyChain*` functions are untouched). Also drops the `llm_call` timestamp backdating in the Claude Code mapping (latency is carried explicitly on the response).

## 0.18.0

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

### Patch Changes

- Updated dependencies [930aa11]
  - @agentkitai/pricing@0.4.0

## 0.17.0

### Minor Changes

- e1b9dce: feat(eval): agenteval→lens federation (#55). New service-token internal route
  `POST /api/internal/eval/run` records a completed agenteval suite run as a
  server-authoritative, hash-chained `eval_result` in a session's audit trail —
  the reverse of the existing import-FROM direction. Mirrors the gate→lens wedge:
  agenteval passes a synthetic per-run sessionId, the server genesis-chains the
  result, failed cases become violations, and `eval_result` stays excluded from
  the client ingest enum so evidence can't be forged.

## 0.16.0

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

## 0.15.0

### Minor Changes

- Compliance evals & prompt stack (#55 Phase 2):

  - **LLM-as-judge** scorer backed by a real Anthropic client (default `claude-haiku-4-5`, overridable) with token-cost tracking, plus `POST /api/eval/sessions/:id/score` to score a completed session against a rubric. Judgments are hash-chained as `eval_result` events labelled `method: "llm_judge"` — a judgment, recorded tamper-evidently, not a proof.
  - **Gate→lens wedge**: `POST /api/internal/eval/guardrail-breach` (service-token internal route) records an AgentGate guardrail breach as a deterministic compliance `eval_result` in the breaching session's audit trail.
  - **Prompt auto-discovery**: ingested `llm_call` system prompts are fingerprinted on both the OTLP and `/api/events` paths and surfaced via `GET /api/prompts/fingerprints`.
  - **Cache-aware cost**: prompt-cache read/write tokens are extracted from gen_ai OTLP spans and priced via `costUsdDetailed` (Anthropic/OpenAI cache rates), with per-version `estimatedCacheSavingsUsd` in prompt analytics.
  - **Dashboard** renders `eval_result` inline in session replay (PASS/FAIL + an "AI judgment" tag), and a new compliance-evals guide documents PII / data-retention / authorization rubrics. (Dashboard ships in the container image.)

### Patch Changes

- Updated dependencies
  - @agentkitai/pricing@0.3.0

## 0.14.0

### Minor Changes

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
  - @agentkit/pricing@0.2.0

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

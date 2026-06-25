# @agentkit/pricing

## 0.4.0

### Minor Changes

- 930aa11: feat(spend): pricing provenance + reconciliation/drift (#89, Slice C). The final
  slice that makes per-agent spend billing-grade. `costUsd` is frozen at ingest-time
  pricing while the rate table is refreshed in place with no retroactive recompute,
  so stored sums silently drift.

  - `@agentkitai/pricing` adds `pricingVersion()` — a stable fingerprint of the
    active rate table (re-exported via `@agentlensai/core`, alongside
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

## 0.3.0

### Minor Changes

- Compliance evals & prompt stack (#55 Phase 2):

  - **LLM-as-judge** scorer backed by a real Anthropic client (default `claude-haiku-4-5`, overridable) with token-cost tracking, plus `POST /api/eval/sessions/:id/score` to score a completed session against a rubric. Judgments are hash-chained as `eval_result` events labelled `method: "llm_judge"` — a judgment, recorded tamper-evidently, not a proof.
  - **Gate→lens wedge**: `POST /api/internal/eval/guardrail-breach` (service-token internal route) records an AgentGate guardrail breach as a deterministic compliance `eval_result` in the breaching session's audit trail.
  - **Prompt auto-discovery**: ingested `llm_call` system prompts are fingerprinted on both the OTLP and `/api/events` paths and surfaced via `GET /api/prompts/fingerprints`.
  - **Cache-aware cost**: prompt-cache read/write tokens are extracted from gen_ai OTLP spans and priced via `costUsdDetailed` (Anthropic/OpenAI cache rates), with per-version `estimatedCacheSavingsUsd` in prompt analytics.
  - **Dashboard** renders `eval_result` inline in session replay (PASS/FAIL + an "AI judgment" tag), and a new compliance-evals guide documents PII / data-retention / authorization rubrics. (Dashboard ships in the container image.)

## 0.2.0

### Minor Changes

- 6a8c268: Centralize LLM model pricing in a new `@agentkit/pricing` package, sourced from LiteLLM's published prices with an embedded fallback.

  - Consolidates the two server-side cost tables (`@agentlensai/core` `DEFAULT_MODEL_COSTS` and the cloud `batch-writer` table) onto one source of truth — they had drifted in both units (per-1M vs per-1K) and model coverage.
  - Fixes the cloud-ingest path, which previously returned no cost for modern model ids (e.g. `claude-opus-4-8`) because its hand-maintained table used outdated key formats.
  - Refreshes prices live from LiteLLM at server startup (fire-and-forget, falls back to the embedded table on failure). Off-switch: `AGENTKIT_PRICING_REFRESH=false`.

  `@agentlensai/core` continues to re-export `DEFAULT_MODEL_COSTS` / `lookupModelCost` and now also exports `costUsd` and `refreshFromLiteLLM` — no breaking change for existing consumers.

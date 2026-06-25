# @agentkit/pricing

## 0.2.0

### Minor Changes

- 6a8c268: Centralize LLM model pricing in a new `@agentkit/pricing` package, sourced from LiteLLM's published prices with an embedded fallback.

  - Consolidates the two server-side cost tables (`@agentlensai/core` `DEFAULT_MODEL_COSTS` and the cloud `batch-writer` table) onto one source of truth — they had drifted in both units (per-1M vs per-1K) and model coverage.
  - Fixes the cloud-ingest path, which previously returned no cost for modern model ids (e.g. `claude-opus-4-8`) because its hand-maintained table used outdated key formats.
  - Refreshes prices live from LiteLLM at server startup (fire-and-forget, falls back to the embedded table on failure). Off-switch: `AGENTKIT_PRICING_REFRESH=false`.

  `@agentlensai/core` continues to re-export `DEFAULT_MODEL_COSTS` / `lookupModelCost` and now also exports `costUsd` and `refreshFromLiteLLM` — no breaking change for existing consumers.

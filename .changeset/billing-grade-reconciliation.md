---
"@agentkitai/pricing": minor
"@agentlensai/core": minor
"@agentlensai/server": minor
---

feat(spend): pricing provenance + reconciliation/drift (#89, Slice C). The final
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

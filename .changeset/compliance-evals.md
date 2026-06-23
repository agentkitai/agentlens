---
"@agentlensai/core": minor
"@agentlensai/server": minor
---

Add compliance evals on the tamper-evident audit trail (#55, Phase 1).

A deterministic compliance scorer evaluates a completed session's events against policy rules — denied tools (`tool_denylist`, supports `delete_*` wildcards), `tool_allowlist`, `max_cost`, and a `no_severity_above` ceiling — with no LLM dependency, so the result is provable and reproducible.

- New `eval_result` event type + `EvalResultPayload`. The scoring outcome is emitted server-side as a SHA-256 hash-chained event in the session's audit trail, so eval results are themselves tamper-evident evidence ("we ran the eval, here's the cryptographic proof"). It is deliberately excluded from the public ingest schema so clients cannot forge eval results.
- New endpoint `POST /api/eval/sessions/:sessionId/compliance` — scores a completed session against inline `rules` and records the chained `eval_result`. Strict pass/fail by default; an optional `passThreshold` switches to score-based.
- `compliance` scorer type registered in the default scorer registry; `ScorerConfig.rules` carries the policy rules.

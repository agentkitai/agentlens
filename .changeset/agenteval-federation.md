---
"@agentlensai/server": minor
"@agentlensai/core": minor
---

feat(eval): agenteval→lens federation (#55). New service-token internal route
`POST /api/internal/eval/run` records a completed agenteval suite run as a
server-authoritative, hash-chained `eval_result` in a session's audit trail —
the reverse of the existing import-FROM direction. Mirrors the gate→lens wedge:
agenteval passes a synthetic per-run sessionId, the server genesis-chains the
result, failed cases become violations, and `eval_result` stays excluded from
the client ingest enum so evidence can't be forged.

---
"@agentlensai/server": minor
---

feat(spend): billing-grade verified attribution (#87, Slice A). Adds a dedicated,
indexed `events.verified_agent_id` column (sqlite + postgres migrations), derived
server-side at insert from the already-hashed `metadata.verifiedAgentId` stamp — it
is never part of the hash input, so the chain stays valid, and never settable from
client input. Behind a new default-OFF flag `BILLING_GRADE_SPEND`, `POST
/api/internal/spend` and `GET /api/analytics/costs` attribute cost by the verified
id instead of the self-reported `agent_id`, so a spoofed `event.agentId` can no
longer claim another agent's spend; unverified cost is surfaced in an
"unattributed" bucket rather than billed. With the flag off, guardrail-mode
behavior (today's `agent_id` grouping and response shape) is byte-for-byte unchanged.

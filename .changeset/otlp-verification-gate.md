---
"@agentlensai/server": minor
---

feat(otlp): verification gate on OTLP ingest (#88, Slice B). The OTLP path read
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

---
"@agentlensai/server": minor
---

feat(otlp): verify a longer-lived ingest key on the OTLP path (#24, Option 3).
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

# Verifiable Audit Sidecar

AgentLens is best deployed as a **verifiable audit sidecar** — it *complements*
your existing observability stack (Langfuse, Datadog, Honeycomb, Grafana…)
rather than replacing it. Keep your APM where it is; **mirror your OpenTelemetry
telemetry** to AgentLens to get a tamper-evident, agent-identity-bound audit
trail and compliance evidence alongside it.

## Why a sidecar, not a replacement

General-purpose observability tools answer *"is my system healthy and fast?"*.
AgentLens answers a different, narrower question that those tools don't:

> *"Which agent did this, under whose identity, was it approved, and can I
> **prove** the log wasn't altered?"*

That's the EU AI Act Art.12 / SOC 2 seam — and it's deliberately focused. So
rather than ask you to re-platform your tracing, AgentLens rides alongside:

- **Tamper-evident audit** — every event is SHA-256 hash-chained; a single
  altered or deleted row breaks the chain (verify via `GET /api/audit/verify`).
- **Agent identity** — events are bound to a *server-verified* agent id (JWT /
  JWKS / SPIFFE), not a client-claimed string.
- **Evidence packs** — export a signed, hash-anchored evidence bundle for an
  agent + time range (`/api/audit/evidence/export`).

Your primary backend keeps doing full-fidelity APM/trace exploration; AgentLens
keeps the verifiable record.

## Mirror your OTLP (fan-out)

AgentLens exposes a standard **OTLP/HTTP receiver**:

- `POST /v1/traces` — OpenTelemetry spans → AgentLens events
- `POST /v1/logs` — OpenTelemetry logs → AgentLens events

Both JSON and Protobuf payloads are accepted. So you don't change your app — you
add **one more exporter** to the telemetry you already produce.

### Option A — OpenTelemetry Collector (recommended)

Fan a pipeline out to two exporters; your existing backend is untouched:

```yaml
exporters:
  otlphttp/primary:            # your existing backend (Datadog, Honeycomb, …)
    endpoint: https://otlp.your-apm.example
  otlphttp/agentlens:          # the audit sidecar
    endpoint: https://agentlens.internal
    # Only if you set OTLP_AUTH_REQUIRED=true on AgentLens:
    headers: { "x-api-key": "${AGENTLENS_API_KEY}" }

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/primary, otlphttp/agentlens]   # fan-out
```

The AgentLens exporter points at the server root; the receiver serves
`/v1/traces` and `/v1/logs` itself.

### Option B — dual export from the SDK

If you export OTLP directly from your app, register a second
`OTLPTraceExporter` aimed at AgentLens:

```ts
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const agentlens = new OTLPTraceExporter({
  url: "https://agentlens.internal/v1/traces",
  headers: { "x-api-key": process.env.AGENTLENS_API_KEY ?? "" }, // if auth required
});
// add `agentlens` as a second span processor alongside your existing one
```

## Auth

The OTLP receiver is unauthenticated by default (like webhook ingest), which is
fine inside a trusted network. For multi-tenant or internet-exposed deployments,
set `OTLP_AUTH_REQUIRED=true` and send an API key (`x-api-key`) or bearer token —
AgentLens then resolves the tenant + verified agent id from it. See
[Configuration](/guide/configuration) and [Tenant Isolation](/guide/tenant-isolation).

## What you get

Once spans mirror in, the AgentLens differentiators apply to them automatically:

| Capability | Where |
|------------|-------|
| Hash-chained tamper-evident audit | `GET /api/audit/verify` |
| Signed evidence pack (agent + range) | `POST /api/audit/evidence/export` |
| Per-agent spend reconstruction | [Cost Tracking](/guide/cost-tracking) |
| Pricing-catalog provenance | `GET /api/server-info` (`pricing`) |

Run AgentLens *next to* your observability stack, not instead of it — the
verifiable record is the part nobody else is giving you.

# Cross-product verifiable evidence (#98)

A tamper-evident **evidence module**: a per-identity timeline and a signed,
portable evidence pack assembled from the hash-chained event store, keyed
strictly on the server-derived `verified_agent_id` (see
[agent identity](billing-grade-spend.md)). It's the one record no single
competitor can structurally assemble — trace + approval + memory + intake under
one identity-keyed, verifiable chain.

> Scope: notified bodies *certify* conformity; this provides the verifiable
> evidence artifact a GRC tool (Vanta/Drata) or auditor references — not a
> conformity certificate.

## Endpoints

All under `/api/audit/*`, so they inherit the audit **`manage`** RBAC guard
(owner/admin/auditor) and are tenant-scoped. SQLite storage backend.

### `GET /api/audit/timeline`
Chain-tagged timeline for one verified agent across sessions and products.

| Query | |
|---|---|
| `agentId` | required — the `verified_agent_id` |
| `from`, `to` | required ISO 8601, `from ≤ to`, span ≤ 1 year |
| `types` | optional CSV of event types to include |

Returns `{ verifiedAgentId, range, eventTypes, totalEvents, events[] }`; each
event is tagged with its source `product` (`agentlens` / `agentgate` /
`formbridge` / `eval`) and `verifiedAgentMethod`. Only attributed events
(non-null `verified_agent_id`) are included.

### `POST /api/audit/evidence/export`
Body `{ agentId, from, to, types? }` → a signed evidence pack:

```jsonc
{
  "kind": "agentlens.evidence-pack/v1",
  "exportedAt": "…", "tenantId": "…", "verifiedAgentId": "…",
  "range": { "from": "…", "to": "…" }, "eventTypes": null,
  "totalEvents": 12,
  "chains": [{ "sessionId": "…", "verified": true, "firstHash": "…", "lastHash": "…" }],
  "events": [ /* timeline entries */ ],
  "signature": { "type": "hmac", "alg": "sha256", "value": "…" }
}
```

The chain of every session the agent touched is verified at export time. The
pack is HMAC-signed over a canonical (key-sorted) body. **Set
`AGENTLENS_AUDIT_SIGNING_KEY`** — without it the pack is emitted with
`signature: null` (unsigned) and `/verify` is unavailable.

### `POST /api/audit/evidence/verify`
Body = an evidence pack → `{ verifiedAgentId, valid, reason? }`. Recomputes the
HMAC over the canonical body and compares constant-time. Returns `501` when no
signing key is configured.

## Signing — HMAC now, RFC-3161 next

`signature.type` is pluggable (`hmac` | `rfc3161`). HMAC proves *"this pack came
from this AgentLens instance, unmodified"* — sufficient for internal audit and
GRC ingestion. RFC-3161 third-party timestamp anchoring (non-repudiable, for a
buyer who doesn't trust the instance) is a drop-in upgrade with **no format
break** — tracked in #99.

## Phase 2 (separate issues)

The timeline/export pick these up automatically once they emit into the chain:
memory writes/redactions/supersessions (lore #78/#79) and FormBridge intake
(formbridge #14/#15).

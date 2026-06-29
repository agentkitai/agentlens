# Signed, third-party-verifiable exports (#125)

An auditor or customer can confirm an AgentLens export's integrity **without
trusting our server or sharing a secret** — using only the public key.

## Asymmetric signing (Ed25519)

- `lib/export-signing.ts` signs over the **canonical JSON** of the body
  (`canonicalJson` from `lib/evidence.ts`) with Ed25519. No new dependencies —
  Node's native `crypto` + JWK export.
- Signature: `{ type: 'ed25519', alg: 'EdDSA', kid, value }` (base64url). The
  `evidence.ts` `PackSignature` union is extended to `'hmac' | 'rfc3161' |
  'ed25519'` so evidence packs and exports share one forward-compatible format
  (HMAC remains as a fallback; `rfc3161` stays reserved for #99).
- **Key source:** `AGENTLENS_EXPORT_PRIVATE_KEY` (PEM, PKCS#8) for a stable JWKS
  in production; otherwise an ephemeral keypair per process (fine for local/OSS).
- `kid` is the RFC-7638 JWK thumbprint.

## JWKS endpoint (public)

`GET /.well-known/jwks.json` → `{ keys: [ <OKP public JWK> ] }`. Mounted
**outside** `/api` so it needs no auth — a third party fetches the public key and
verifies offline. Verification with the public key alone is covered by tests.

## Signed export endpoint

- `POST /api/exports/sign` `{ sessionId }` → `{ export, signature }`. The export
  is **self-describing about integrity**:
  - `chained` (session-level) + per-event `chainCovered` distinguish
    **SDK-chained** (tamper-evident) from **OTLP record-integrity-only** events —
    the existing chain boundary is respected, never claiming a chain for OTLP.
  - `chainValid` from `verifyChain` / `verifyRecords`.
  - each event preserves the server-set `verifiedAgentId` / `verifiedAgentMethod`
    and per-event `costUsd` — never client-supplied identity.
- `POST /api/exports/verify` `{ export, signature, jwk? }` → `{ valid }` — pass
  `jwk` to run the same public-key-only check a third party would.

## Signed outbound webhooks

`lib/notifications/providers/webhook.ts` adds an `X-AgentLens-Signature:
sha256=<hmac>` (+ `X-AgentLens-Timestamp`) header when
`AGENTLENS_WEBHOOK_SIGNING_SECRET` is set, signing `timestamp.body` (replay
resistance) through the existing SSRF guard + retry. `verifyWebhookSignature`
is exported for receivers.

## Deferred (noted for follow-up)

This PR delivers the export/signing slice — the epic's most-emphasized
differentiator. The larger identity-stack work is intentionally deferred:

- **org → project → member hierarchy** unification (`tenant_id` ↔ `(org_id,
  project_id)`), reconciling the OSS and cloud identity models — a data-layer
  refactor across the whole store; needs its own ADR + PR.
- **Single role model** in `@agentkitai/auth` (fold in cloud `member`/`auditor`;
  remove the `api_keys.role`-derived `auditor` shortcut in `audit-verify.ts`).
- **SAML 2.0 SSO** + **SCIM** (new deps + an IdP).
- Webhook **subscription CRUD + delivery-log table** and the typed events
  (`export.completed`, `member.invited`, `audit.chain_broken`) — this PR ships
  the signed-delivery primitive they build on.
- Dashboard `export-utils.ts` rewiring to route JSON/CSV/NDJSON through
  `/api/exports/sign` (the server signing authority + format land here first).

---
"@agentlensai/server": minor
---

Verify and stamp agent identity on ingest (#12 Phase 2 — the cross-repo wedge).

`POST /api/events` now accepts an AgentGate-minted agent token via the `X-Agent-Token` header. When present and valid, every event in the batch gets a **server-authoritative** `verifiedAgentId` (plus `verifiedAgentMethod: "agentgate_token"`) stamped into its metadata — turning the self-reported `agentId` into a cryptographically attributable one on the tamper-evident audit trail.

- The verified id lives in event **metadata**, which is already part of the hashed payload, so the stamp is itself tamper-evident **without** changing the hashed field set (existing hash chains stay valid — no `HASH_VERSION` bump).
- It is **forgery-proof**: the reserved `verifiedAgentId`/`verifiedAgentMethod` metadata keys are always stripped from client input and only re-set after the server verifies the token, so a client can never inject them. The webhook ingest path (`POST /api/events/ingest`) also strips these reserved keys from caller-supplied context (it never stamps — HMAC there proves the source, not the agent identity); the OTLP path builds metadata server-side and is unaffected.
- Verification mirrors AgentGate (shared `agentkit-auth`): HS256 signature over the shared secret **plus** the load-bearing `typ:"agent"` claim. A user token, an expired token, or a wrong-key token is ignored (no stamp).
- New env var **`AGENTGATE_JWT_SECRET`** — AgentGate's signing secret, shared with AgentLens to verify agent tokens. When unset, the feature is off and ingest is unchanged. Verification is cryptographic only (no callback to AgentGate); agent tokens are short-lived, which bounds staleness.

See AgentGate's `docs/agent-identity.md` for the full identity model and trust boundary.

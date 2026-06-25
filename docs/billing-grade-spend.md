# Billing-grade per-agent spend (design)

> **Status:** design / RFC. Tracks [agentkitai/agentgate#24](https://github.com/agentkitai/agentgate/issues/24).
> Implementation slices: [#87](https://github.com/agentkitai/agentlens/issues/87) ·
> [#88](https://github.com/agentkitai/agentlens/issues/88) ·
> [#89](https://github.com/agentkitai/agentlens/issues/89).

AgentGate enforces per-agent monthly budgets by reading priced spend from AgentLens
(`POST /api/internal/spend`), joined on the convention `agentgate.agents.id (agt_*) =
agentlens event.agentId`. Today that is a **soft guardrail**, explicitly *not* a billing
meter. This doc scopes what it takes to make per-agent spend trustworthy enough to bill on,
and breaks the work into three independently shippable slices.

## Current state

- **Budgets (AgentGate, shipped).** `agents.monthlyBudgetUsd` → `checkAgentBudget()` reads
  `POST /api/internal/spend` (30 s cache, re-read at 2 s near the cap), soft-gates the *next*
  request, **fails open** on telemetry outage. Alerts at 80 % / 100 %. A guardrail by design.
- **Spend ground truth (AgentLens).** `/api/internal/spend` sums `costUsd` from
  `cost_tracked` / `llm_response` events, `GROUP BY agent_id`, per tenant + window. `costUsd`
  is frozen into the **hashed, immutable** event payload at ingest. Two ingest paths: the
  client SDK (`POST /api/events`, client *sends* `costUsd`) and OTLP (`/v1/traces`, server
  *computes* `costUsd` from `@agentkitai/pricing` at the ingest moment).
- **Identity.** AgentGate mints a short-lived (`~15 min`) `typ:"agent"` HS256 JWT signed with
  `AGENTGATE_JWT_SECRET`; agents present it as `X-Agent-Token`. `POST /api/events` verifies it
  (`verifyAgentToken`) and stamps a server-authoritative `metadata.verifiedAgentId`
  ([#12 Phase 2](https://github.com/agentkitai/agentlens/issues/12)).

## The two gaps

### Gap 1 — Trustworthy attribution (the prerequisite)

The issue frames this as "OTLP is spoofable," but it is in fact **two** structural problems:

1. **Spend aggregates by the unverified column.** `/api/internal/spend` does
   `GROUP BY agent_id` on the raw `event.agentId`, **not** `metadata.verifiedAgentId`. So even
   on the client path where the agent token *is* verified, that verification is **bypassed for
   billing** — the verified stamp exists but is never used to attribute spend.
2. **OTLP has zero verification.** `extractAgentId()` reads `agentlens.agentId` / `service.name`
   straight from untrusted span attributes. No token, no signature, no stamp. Any caller can
   attribute cost to any agent.

So the cheapest high-value step is *not* "sign OTLP" — it is **(a) make spend group by a
verified id** and **(b) close the client path**, then **(c) add the same verification gate to
OTLP**. (a)+(b) is a contained AgentLens change that mirrors the already-shipped verify-stamp
work; (c) is the heavier, cross-repo piece.

### Gap 2 — Reconciliation cross-check (bigger, depends on Gap 1)

`costUsd` is frozen at *ingest-time* pricing, and `refreshFromLiteLLM()` updates prices
**in-memory with no versioning and no retroactive recompute**. So stored sums drift from a
recompute-at-current-pricing or the provider's invoice — and today the drift is *unknowable*
because no pricing provenance is recorded on events.

**Key constraint:** provider invoices (OpenAI / Anthropic usage APIs) are **per-org, not
per-agent** — providers don't know your `agt_*` ids. Invoice reconciliation can therefore only
validate the **aggregate**; the per-agent split is only as trustworthy as Gap 1. That is why
Gap 1 is the true prerequisite, and why provider-API integration is an *optional* add-on rather
than the core of the reconciliation work.

## Plan — three slices

| Slice | Issue | Scope | Depends on |
|------|-------|-------|-----------|
| **A — Verified attribution** | [#87](https://github.com/agentkitai/agentlens/issues/87) | Dedicated indexed `verifiedAgentId` column; spend/analytics group by it; billing-grade mode (unverified → "unattributed" bucket); guardrail mode unchanged. AgentLens-only. | — |
| **B — OTLP verification** | [#88](https://github.com/agentkitai/agentlens/issues/88) | A verification gate on the OTLP ingest path so OTLP spans carry a verified id. Cross-repo (the fork below). | A |
| **C — Reconciliation** | [#89](https://github.com/agentkitai/agentlens/issues/89) | Pricing provenance at ingest; a stored-vs-recompute drift report per agent/period + threshold alert; optional provider-invoice aggregate check. | A, B |

Recommended order: **A → B → C.** A removes the spoofability that blocks calling spend
trustworthy and is shippable on its own. Full "billing-grade" (provider-invoice integration,
zero-staleness enforcement, exactly-once alerting) is a large lift beyond these three; A alone
already closes the headline trust gap.

## Fork to decide (Slice B): how to verify OTLP

Add a verification gate to OTLP ingest so a verified agent id can be stamped (feeding Slice A's
column). The issue allows "HMAC-signed OTLP payloads (or equivalent)":

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **1. Reuse the agent JWT** | exporter sends `X-Agent-Token` via `OTEL_EXPORTER_OTLP_HEADERS`; verify like `/api/events` | Reuses the existing primitive; one identity mechanism | 15-min token TTL is awkward for long-running exporters (needs refresh plumbing) |
| **2. Per-agent HMAC-signed payloads** | per-agent signing key; verify the signature, derive the agent id from it | The issue's literal suggestion; no token-refresh problem | New signing scheme + key distribution; non-standard OTLP |
| **3. Longer-lived per-agent ingest keys** | a key scoped to an `agentId`, separate from the 15-min request JWT | Exporter-friendly; no refresh churn | Needs key issuance + rotation (overlaps [#59](https://github.com/agentkitai/agentlens/issues/59)) |

**Recommendation:** evaluate **(1)** for protocol reuse against **(3)** for operational fit
before building B. (2) is viable but adds a bespoke signing path; prefer it only if neither
token approach fits the deployment model.

## Non-goals (for now)

- Zero-staleness / in-flight enforcement — AgentGate doesn't sit in the completion path; budgets
  remain "gate the next request."
- Cross-replica exactly-once alerting (current in-memory dedup is fine for soft notifications).
- Org-level invoicing (AgentLens cloud billing tables already exist; this is *per-agent*).

## Definition of done

Per-agent spend can be called **billing-grade** when: every cost-bearing event on **both**
ingest paths carries a cryptographically **verified** agent id (A + B), spend aggregates on that
id, and a **reconciliation** report can show stored-vs-recompute drift (and, optionally, agree
with the provider invoice in aggregate) within a stated threshold (C). Until then it stays a
guardrail, as documented in AgentGate's `governance.md`.

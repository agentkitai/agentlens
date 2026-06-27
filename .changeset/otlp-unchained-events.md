---
"@agentkitai/agentlens-core": minor
"@agentkitai/agentlens-server": minor
---

Treat OTLP-ingested events as **unchained** so they no longer falsely report a broken tamper-evident hash chain.

OTLP telemetry (OpenClaw diagnostics, OTel GenAI spans, Claude Code) is batched, multi-signal (metrics + logs export on independent schedules), out-of-order, and unauthenticated at ingest — so a linear `prevHash` chain is neither achievable nor meaningful for it. The receiver previously chained these events anyway, which surfaced as "chain invalid" on the session view for any real multi-signal source.

Now OTLP events are stored with `prevHash = null` and a self-contained integrity hash (record-level tampering is still detectable), with **no** cross-event linkage. The strict linear chain is reserved for the SDK's in-order, authenticated stream and is unchanged. Verification detects an all-`null`-prevHash session as "unchained" and checks per-record integrity only (`/sessions/:id/timeline` now also returns `chained: boolean`); `insertEvents` accepts unchained appends without a continuity error.

`core` adds `verifyRecords()` / `verifyRecordsRaw()` — record-integrity verifiers with no linkage (the strict `verifyChain*` functions are untouched). Also drops the `llm_call` timestamp backdating in the Claude Code mapping (latency is carried explicitly on the response).

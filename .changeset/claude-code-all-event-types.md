---
"@agentkitai/agentlens-server": minor
"@agentkitai/agentlens-dashboard": minor
---

Display every Claude Code OpenTelemetry event type properly across the dashboard.

**Server** — the OTLP `/v1/logs` handler now maps Claude Code's tool lifecycle logs to first-class events: `tool_decision` → `tool_call` (a denied decision also emits a `tool_error`), and `tool_result` → `tool_response` (or `tool_error` on failure), correlated by `tool_use_id`. This lights up the Tools analytics view, the SessionDetail "Tool Calls"/"Errors" filters, and paired timeline rendering — which all key off the `tool_*` event types. Cost/token metrics deliberately stay generic custom events (cost is already authoritative on the `api_request` → `llm_response` path; mapping the `cost.usage` metric too would double-count). Also derives `agent.sessionCount` from the sessions table in `listAgents`/`getAgent` (both stores) so OTLP-ingested agents — which never emit `session_started` — no longer show "0 sessions".

**Dashboard** — a shared OTLP renderer (`lib/otlpEvent.ts`) gives every remaining generic `custom` log/metric a real title, icon, and labeled detail fields derived from the OTLP event/metric name + attributes (e.g. `token.usage = 1,340 (output)`, `user_prompt`, `hook_execution_complete`, `cost.usage = $0.0123`) instead of an identical gray "otlp_log"/"otlp_metric" blob. Wired into the SessionDetail timeline, the Replay timeline, the Events Explorer table, and the event detail panel (readable fields above the raw payload). Also adds missing `error`/`eval_result` styles to the SessionDetail timeline for parity.

Additive and fail-safe: unrecognized event names fall through to the existing generic event, still rendered legibly by the shared renderer. The SDK ingest path is untouched.

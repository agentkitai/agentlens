# @agentkitai/agentlens-dashboard

## 0.15.0

### Minor Changes

- 3fa978c: Make skills first-class. Claude Code's `claude_code.skill_activated` log is now mapped to a dedicated `skill_activated` event type (added to core's `EventType`) instead of a generic custom event, so it gets real treatment everywhere that keys off event type:

  - **Server** — `/v1/logs` maps `skill_activated` → a typed `skill_activated` event (`skillName`/`source`/`pluginName`); new `GET /api/analytics/skills` returns per-skill activation counts.
  - **Dashboard** — a "Skills" filter chip in the session timeline, a "Skill Usage" chart in Analytics, and skill rows render with a 🧩 icon + skill name in both the session and replay timelines.

  `skill_activated` is OTLP/server-ingested (kept out of the client-ingest `eventTypeSchema`, like `eval_result`). Additive and fail-safe; SDK path untouched.

### Patch Changes

- Updated dependencies [3fa978c]
  - @agentkitai/agentlens-core@0.20.0

## 0.14.0

### Minor Changes

- 62d37bb: Display every Claude Code OpenTelemetry event type properly across the dashboard.

  **Server** — the OTLP `/v1/logs` handler now maps Claude Code's tool lifecycle logs to first-class events: `tool_decision` → `tool_call` (a denied decision also emits a `tool_error`), and `tool_result` → `tool_response` (or `tool_error` on failure), correlated by `tool_use_id`. This lights up the Tools analytics view, the SessionDetail "Tool Calls"/"Errors" filters, and paired timeline rendering — which all key off the `tool_*` event types. Cost/token metrics deliberately stay generic custom events (cost is already authoritative on the `api_request` → `llm_response` path; mapping the `cost.usage` metric too would double-count). Also derives `agent.sessionCount` from the sessions table in `listAgents`/`getAgent` (both stores) so OTLP-ingested agents — which never emit `session_started` — no longer show "0 sessions".

  **Dashboard** — a shared OTLP renderer (`lib/otlpEvent.ts`) gives every remaining generic `custom` log/metric a real title, icon, and labeled detail fields derived from the OTLP event/metric name + attributes (e.g. `token.usage = 1,340 (output)`, `user_prompt`, `hook_execution_complete`, `cost.usage = $0.0123`) instead of an identical gray "otlp_log"/"otlp_metric" blob. Wired into the SessionDetail timeline, the Replay timeline, the Events Explorer table, and the event detail panel (readable fields above the raw payload). Also adds missing `error`/`eval_result` styles to the SessionDetail timeline for parity.

  Additive and fail-safe: unrecognized event names fall through to the existing generic event, still rendered legibly by the shared renderer. The SDK ingest path is untouched.

### Patch Changes

- 49c9aa0: Two Claude Code follow-ups:

  - **Server** — backfill the LLM detail view's prompt/response text. The OTLP `/v1/logs` handler now correlates `user_prompt` (by `prompt.id`) and `assistant_response` (by `request_id`) with the `api_request` in the same batch, so the `llm_call`/`llm_response` show the real conversation instead of a placeholder. Text is only present when `OTEL_LOG_USER_PROMPTS=1` is set (Claude Code redacts it otherwise); when absent, the placeholder now points to that setting. Correlates within a single OTLP export batch (fail-safe otherwise).
  - **Dashboard** — add a "Telemetry" filter category to the session Replay timeline so OTLP-ingested custom events (Claude Code metrics/logs) can be isolated, matching the other replay filter chips.

- f913fb3: Recover the dashboard ErrorBoundary on client-side navigation, and guard the list
  `.map` sites against non-array data. Fast page-to-page navigation no longer
  wedges the whole SPA with `(x.data ?? []).map is not a function` until a hard
  refresh — the boundary now resets when the route changes, and the
  CostOptimization / Insights / Alerts lists tolerate a transient wrong-shaped
  response instead of throwing.
- Updated dependencies [26519c6]
  - @agentkitai/agentlens-core@0.19.0

## 0.13.5

### Patch Changes

- Updated dependencies [930aa11]
  - @agentkitai/agentlens-core@0.18.0

## 0.13.4

### Patch Changes

- Updated dependencies [e1b9dce]
  - @agentkitai/agentlens-core@0.17.0

## 0.13.3

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.16.0

## 0.13.2

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.15.0

## 0.13.1

### Patch Changes

- Updated dependencies [6a8c268]
- Updated dependencies [18428ae]
  - @agentkitai/agentlens-core@0.14.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @agentkitai/agentlens-core@0.2.0

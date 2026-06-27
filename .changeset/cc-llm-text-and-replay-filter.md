---
"@agentkitai/agentlens-server": patch
"@agentkitai/agentlens-dashboard": patch
---

Two Claude Code follow-ups:

- **Server** — backfill the LLM detail view's prompt/response text. The OTLP `/v1/logs` handler now correlates `user_prompt` (by `prompt.id`) and `assistant_response` (by `request_id`) with the `api_request` in the same batch, so the `llm_call`/`llm_response` show the real conversation instead of a placeholder. Text is only present when `OTEL_LOG_USER_PROMPTS=1` is set (Claude Code redacts it otherwise); when absent, the placeholder now points to that setting. Correlates within a single OTLP export batch (fail-safe otherwise).
- **Dashboard** — add a "Telemetry" filter category to the session Replay timeline so OTLP-ingested custom events (Claude Code metrics/logs) can be isolated, matching the other replay filter chips.

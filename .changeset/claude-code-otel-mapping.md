---
"@agentkitai/agentlens-server": minor
---

Map Claude Code's native OpenTelemetry into rich AgentLens events. Claude Code
emits `claude_code.*` metrics + logs (not gen_ai.* spans), so its data
previously fell through to generic `otlp_log`/`otlp_metric` custom events,
leaving the Sessions, LLM Analytics, and Cost views empty. The OTLP `/v1/logs`
handler now maps each `claude_code.api_request` log to a paired
`llm_call` + `llm_response` carrying the model, all four token counts
(input/output/cache-read/cache-creation), real `cost_usd`, and `duration_ms`,
and resolves the `session.id` attribute so events land on the real session
(and Claude Code metrics too). Cost rides on `llm_response` only — matching the
SDK/gen_ai contract — so session and cost-view totals are not double-counted.
Additive and fail-safe: unrecognized shapes still fall through to generic
events.

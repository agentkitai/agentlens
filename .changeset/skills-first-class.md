---
"@agentkitai/agentlens-core": minor
"@agentkitai/agentlens-server": minor
"@agentkitai/agentlens-dashboard": minor
---

Make skills first-class. Claude Code's `claude_code.skill_activated` log is now mapped to a dedicated `skill_activated` event type (added to core's `EventType`) instead of a generic custom event, so it gets real treatment everywhere that keys off event type:

- **Server** — `/v1/logs` maps `skill_activated` → a typed `skill_activated` event (`skillName`/`source`/`pluginName`); new `GET /api/analytics/skills` returns per-skill activation counts.
- **Dashboard** — a "Skills" filter chip in the session timeline, a "Skill Usage" chart in Analytics, and skill rows render with a 🧩 icon + skill name in both the session and replay timelines.

`skill_activated` is OTLP/server-ingested (kept out of the client-ingest `eventTypeSchema`, like `eval_result`). Additive and fail-safe; SDK path untouched.

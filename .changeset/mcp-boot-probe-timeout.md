---
"@agentlensai/mcp": patch
---

MCP server: bound the startup capability probe to a tight 1.5s timeout (configurable via `AGENTLENS_MCP_PROBE_TIMEOUT_MS`) so an unreachable or slow `AGENTLENS_URL` can't delay the stdio `initialize` handshake. An MCP stdio server must respond promptly, but boot awaited the probe (a network call) before connecting the transport — fine for `localhost` (refuses instantly) but a remote host that drops packets would stall startup up to 5s. The probe stays fail-open (a timeout registers all tools), so this only changes timing, not behavior.

---
"@agentlensai/sdk": patch
---

Fix the stale `@agentlensai/core` dependency range (`^0.8.0` → `workspace:*`).
The published `sdk@0.14.0` pinned `core@^0.8.0`, which resolved to the long-stale
`core@0.8.0` on install instead of the matching current core. `workspace:*` is
rewritten to the exact core version at publish time (matching server/mcp).

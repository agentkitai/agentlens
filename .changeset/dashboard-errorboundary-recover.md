---
"@agentkitai/agentlens-dashboard": patch
---

Recover the dashboard ErrorBoundary on client-side navigation, and guard the list
`.map` sites against non-array data. Fast page-to-page navigation no longer
wedges the whole SPA with `(x.data ?? []).map is not a function` until a hard
refresh — the boundary now resets when the route changes, and the
CostOptimization / Insights / Alerts lists tolerate a transient wrong-shaped
response instead of throwing.

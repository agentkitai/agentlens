# AgentLens v0.8.0 — Sprint Plan

## Phase 3: Proactive Guardrails & Framework Plugins

---

## Batch Strategy

### Batch 1: Types, Schemas, Store (Foundation)
**Stories:** 1.1, 1.2, 4.1
**Parallel:** Yes — core types + store + plugin base are independent
**Dependencies:** None
**Commit:** `feat: guardrail types, store, and plugin base class`

### Batch 2: Evaluation Engine + Conditions + Actions
**Stories:** 1.3, 1.4, 1.5
**Parallel:** Conditions and Actions can be built in parallel, Engine integrates both
**Dependencies:** Batch 1 (types + store)
**Commit:** `feat: guardrail evaluation engine with conditions and actions`

### Batch 3: REST API + Server Wiring
**Stories:** 2.1, 2.2, 2.3
**Parallel:** Routes can be built together
**Dependencies:** Batch 2 (engine for wiring)
**Commit:** `feat: guardrail REST API and server integration`

### Batch 4: MCP Tool + Framework Plugins
**Stories:** 3.1, 5.1, 5.2, 5.3, 5.4, 5.5
**Parallel:** MCP tool and Python plugins are fully independent
**Dependencies:** Batch 1 (for base plugin), Batch 3 (for MCP transport)
**Commit:** `feat: guardrail MCP tool + framework plugins`

### Batch 5: Dashboard
**Stories:** 6.1
**Dependencies:** Batch 3 (REST API must exist)
**Commit:** `feat: guardrails dashboard page`

---

## Critical Path

```
Batch 1 (types + store + base) → Batch 2 (engine) → Batch 3 (API) → Batch 5 (dashboard)
         ↓
    Batch 4 (MCP + plugins) — can start after Batch 1 for plugins
```

---

## Final Commit
After all batches pass tests and TypeScript compilation:
```
git add -A && git commit -m "feat: v0.8.0 proactive guardrails + framework plugins"
```

# Sprint Plan: AgentLens v0.6.0

**Date:** 2026-02-08
**Stories:** 15 across 3 epics
**Method:** Parallel sub-agents where dependencies allow

---

## Batch 1: Core Types (Stories 1.1 + 2.1) — Parallel
- **Agent A:** Story 1.1 (Health types + schemas)
- **Agent B:** Story 2.1 (Cost optimization types + schemas)
- **No dependencies** — both add types to `@agentlensai/core`

## Batch 2: Core Logic (Stories 1.2 + 1.3 + 2.2 + 2.3) — Parallel
- **Agent A:** Stories 1.2 + 1.3 (Health computer + snapshot store)
- **Agent B:** Stories 2.2 + 2.3 (Complexity classifier + recommendation engine)
- **Depends on:** Batch 1 (types)

## Batch 3: REST + MCP (Stories 1.4 + 1.5 + 2.4 + 2.5) — Parallel
- **Agent A:** Stories 1.4 + 1.5 (Health endpoints + MCP tool)
- **Agent B:** Stories 2.4 + 2.5 (Optimization endpoint + MCP tool)
- **Depends on:** Batch 2 (core logic)

## Batch 4: Review (All Epics 1+2)
- **Review Agent:** Code review of all server/core/MCP changes
- **Depends on:** Batch 3 complete

## Batch 5: Fix + SDK/CLI/Dashboard (Stories 3.1-3.5)
- **Fix Agent:** Address review findings from Batch 4
- **Agent A:** Stories 3.1 + 3.3 (TS SDK + CLI)
- **Agent B:** Story 3.2 (Python SDK)
- **Agent C:** Stories 3.4 + 3.5 (Dashboard pages)
- **Depends on:** Batch 4 (review)

## Batch 6: Final Review + Publish
- **Review Agent:** Review SDK/CLI/Dashboard
- **Fix Agent:** Address findings
- **Publish:** Version bump → npm/PyPI → GitHub release

---

## Tracking

| Story | Batch | Agent | Status |
|-------|-------|-------|--------|
| 1.1 | 1 | A | ⬜ |
| 2.1 | 1 | B | ⬜ |
| 1.2 | 2 | A | ⬜ |
| 1.3 | 2 | A | ⬜ |
| 2.2 | 2 | B | ⬜ |
| 2.3 | 2 | B | ⬜ |
| 1.4 | 3 | A | ⬜ |
| 1.5 | 3 | A | ⬜ |
| 2.4 | 3 | B | ⬜ |
| 2.5 | 3 | B | ⬜ |
| 3.1 | 5 | A | ⬜ |
| 3.2 | 5 | B | ⬜ |
| 3.3 | 5 | A | ⬜ |
| 3.4 | 5 | C | ⬜ |
| 3.5 | 5 | C | ⬜ |

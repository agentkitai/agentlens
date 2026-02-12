# AgentLens × Lore Integration Brief

## Problem
AgentLens has a built-in memory/lesson sharing system (~3100 lines of server code + pool-server package + dashboard pages + SDK methods + MCP tools + core types). Lore now exists as a standalone product doing the same thing better. The duplication is a maintenance burden and dilutes Lore's value.

## Goal
Make Lore an **optional integration** in AgentLens. When configured, AgentLens delegates all lesson/memory operations to a Lore instance. When not configured, those features simply don't appear.

## Scope — What Gets Removed

### Server (`packages/server/`)
- `src/db/lesson-store.ts` (274 lines) — replaced by Lore
- `src/services/community-service.ts` (1132 lines) — replaced by Lore
- `src/routes/lessons.ts` — replaced by thin proxy to Lore
- `src/routes/community.ts` — replaced by thin proxy to Lore
- `src/lib/redaction/` (874 lines, 6 layers) — Lore has its own redaction
- `src/lib/embeddings/` (633 lines) — Lore has its own embeddings
- All associated tests (~15 test files)

### Pool Server (`packages/pool-server/`)
- **Entire package** (1103 lines source + 1979 lines tests) — Lore server replaces this completely

### Core (`packages/core/`)
- `src/community-types.ts` — move to thin compatibility shim or remove
- `src/redaction-types.ts` — remove (Lore owns redaction)
- Lesson types in `src/types.ts` — keep as re-exports from Lore or thin wrappers

### Dashboard (`packages/dashboard/`)
- `src/pages/Lessons.tsx` — conditionally rendered
- `src/pages/CommunityBrowser.tsx` — conditionally rendered
- `src/pages/SharingControls.tsx` — conditionally rendered
- `src/pages/SharingActivity.tsx` — conditionally rendered
- `src/components/LessonList.tsx` — conditionally rendered
- `src/components/LessonEditor.tsx` — conditionally rendered
- `src/api/lessons.ts` — rewire to call Lore API
- `src/api/community.ts` — rewire to call Lore API
- Layout nav: hide lesson/community items when Lore not configured

### SDK (`packages/sdk/`)
- Lesson-related methods — delegate to `lore-sdk` or remove
- Re-export Lore types for backward compatibility

### MCP (`packages/mcp/`)
- `src/tools/community.ts` — remove (Lore has its own MCP server)
- `src/tools/learn.ts` — remove or delegate to Lore
- `src/tools/recall.ts` — remove or delegate to Lore

## Architecture

### Configuration
```
# .env or config
LORE_ENABLED=true
LORE_API_URL=http://localhost:8100  # Lore Phase 2 server
LORE_API_KEY=lore_...               # Lore API key
# OR for local-only:
LORE_LOCAL=true                     # Use lore-sdk locally (no server)
LORE_DB_PATH=~/.lore/agentlens.db
```

### Server: Thin Proxy Pattern
Instead of reimplementing lesson CRUD, the server routes become thin proxies:
- `POST /api/lessons` → forward to Lore API (or call `lore-sdk` directly)
- `GET /api/lessons` → forward to Lore API
- Routes only registered when `LORE_ENABLED=true`

### Dashboard: Feature Flag
- Server exposes `GET /api/config/features` → `{ lore: true/false }`
- Dashboard fetches features on mount
- Lesson/community nav items and pages hidden when `lore: false`
- Lazy-loaded pages (already code-split) → zero bundle cost when disabled

### Backward Compatibility
- AgentLens SDK lesson methods become thin wrappers around lore-sdk
- MCP community/learn/recall tools removed — users point to Lore's MCP server instead
- Existing lesson data: migration script to export from AgentLens SQLite → Lore format

## What Stays in AgentLens
- All observability (events, sessions, spans, cost tracking)
- Guardrails, benchmarking, optimization
- Session replay
- Health scores
- Alert engine
- Cloud/multi-tenant features (minus lesson-specific cloud tables)

## Batches (Estimated)

1. **Feature flag + config** — Add LORE_ENABLED config, feature endpoint, dashboard feature detection
2. **Server proxy routes** — Replace lesson-store + community-service with Lore proxy layer
3. **Remove pool-server** — Delete entire package, update workspace
4. **Remove redaction + embeddings** — Delete from server (Lore owns these)
5. **Dashboard conditional rendering** — Hide/show pages based on feature flag
6. **SDK + MCP cleanup** — Remove/delegate lesson methods, remove community MCP tool
7. **Core types cleanup** — Remove community-types, redaction-types, slim down types.ts
8. **Migration script** — Export existing AgentLens lessons → Lore import format
9. **Tests + docs** — Update all remaining tests, README, docs

## Risks
- **Test count drop**: We'll lose ~500+ tests that tested the removed code. That's fine — those tests live in Lore now.
- **Breaking change**: SDK users calling `agentlens.lessons.create()` will need to switch to `lore-sdk`. Document in migration guide.
- **Dashboard routing**: Need to handle direct URL access to `/lessons` when Lore disabled (redirect to home).

## Success Criteria
- `LORE_ENABLED=false` → AgentLens works exactly as pure observability, no lesson UI
- `LORE_ENABLED=true` → Lessons/community pages appear, all ops delegate to Lore
- Zero regressions in non-lesson features
- Clean separation: no lesson/redaction/embedding code left in AgentLens source

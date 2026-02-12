# Lore Integration Sprint Plan — AgentLens

**Author:** Bob (Sprint Planning)  
**Date:** 2026-02-12  
**Batches:** 8  
**Estimated Time:** 5-7 hours

---

## Batch 1: Feature Flag + Config (US-1)
**Goal:** Add Lore configuration, validate on startup, expose feature endpoint

**Tasks:**
1. Add to `ServerConfig`: `loreEnabled`, `loreMode`, `loreApiUrl`, `loreApiKey`, `loreDbPath`
2. Add env var parsing in `getConfig()`: `LORE_ENABLED`, `LORE_MODE`, `LORE_API_URL`, `LORE_API_KEY`, `LORE_DB_PATH`
3. Add `validateLoreConfig()` — clear errors for missing fields
4. Add `GET /api/config/features` route (no auth) returning `{ lore: boolean }`
5. Tests: config validation (6 cases), features endpoint (2 cases)

**Depends on:** Nothing  
**Files:** `packages/server/src/config.ts`, new `packages/server/src/routes/features.ts`

---

## Batch 2: Lore Adapter + Proxy Routes (US-3)
**Goal:** Create Lore client abstraction and proxy lesson/community routes through it

**Tasks:**
1. Create `LoreAdapter` interface (createLesson, listLessons, getLesson, updateLesson, deleteLesson, search)
2. Implement `RemoteLoreAdapter` — HTTP fetch to Lore server
3. Implement `LocalLoreAdapter` — delegates to lore-sdk (conditional import)
4. Create `lore-proxy.ts` routes — lesson CRUD proxying through adapter
5. Create `lore-community-proxy.ts` routes — community operations through adapter
6. Register proxy routes conditionally in `createApp()` when `loreEnabled`
7. Tests: adapter mocks, proxy route tests (CRUD + error forwarding)

**Depends on:** Batch 1  
**Files:** new `packages/server/src/lib/lore-client.ts`, new `packages/server/src/routes/lore-proxy.ts`, `packages/server/src/index.ts`

---

## Batch 3: Dashboard Conditional Rendering (US-2)
**Goal:** Dashboard shows lesson/community pages only when Lore is enabled

**Tasks:**
1. Create `useFeatures()` hook — fetches `/api/config/features`, caches result
2. Modify `Layout.tsx` — conditionally render Lessons, Sharing, Community, Sharing Activity nav items
3. Modify `App.tsx` — conditionally render routes, redirect disabled paths to `/`
4. Update dashboard API modules (`lessons.ts`, `community.ts`) — no changes needed if proxy handles it
5. Tests: feature hook mock, nav visibility, route redirects

**Depends on:** Batch 1  
**Files:** new `packages/dashboard/src/hooks/useFeatures.ts`, `packages/dashboard/src/components/Layout.tsx`, `packages/dashboard/src/App.tsx`

---

## Batch 4: Remove Built-in Server Code (US-4, Part 1)
**Goal:** Delete lesson-store, community-service, redaction, embeddings from server

**Tasks:**
1. Delete `packages/server/src/db/lesson-store.ts` + tests
2. Delete `packages/server/src/services/community-service.ts` + tests
3. Delete `packages/server/src/lib/redaction/` (entire directory + tests)
4. Delete `packages/server/src/lib/embeddings/` (entire directory + tests)
5. Delete `packages/server/src/routes/lessons.ts` (replaced by proxy in Batch 2)
6. Delete `packages/server/src/routes/community.ts` (replaced by proxy in Batch 2)
7. Delete `packages/server/src/routes/redaction-test.ts`
8. Update `packages/server/src/index.ts` — remove all imports/exports of deleted modules
9. Update remaining code that imports from deleted modules (embedding worker refs in other routes, etc.)
10. Fix build — ensure `pnpm build` succeeds

**Depends on:** Batch 2  
**Files:** Many deletions, `packages/server/src/index.ts` rewiring

---

## Batch 5: Remove pool-server + Core Types Cleanup (US-4, Part 2)
**Goal:** Delete entire pool-server package, clean up core types

**Tasks:**
1. Delete `packages/pool-server/` entirely
2. Remove from `pnpm-workspace.yaml`
3. Remove from root `package.json` if referenced
4. Delete `packages/core/src/community-types.ts` + tests
5. Delete `packages/core/src/redaction-types.ts` + tests
6. Remove lesson-related exports from `packages/core/src/types.ts` (keep non-lesson types)
7. Update core `index.ts` exports
8. Fix any remaining imports across packages
9. Build succeeds across all packages

**Depends on:** Batch 4  
**Files:** `packages/pool-server/` deletion, `packages/core/src/` cleanup

---

## Batch 6: SDK + MCP Cleanup (US-5, US-6)
**Goal:** Deprecate SDK lesson methods, remove MCP lesson tools

**Tasks:**
1. SDK: Mark lesson methods `@deprecated`, change body to throw with migration message
2. SDK: Remove lesson type imports from core (or add `@deprecated` re-exports)
3. SDK: Update tests — verify deprecated methods throw
4. MCP: Delete `packages/mcp/src/tools/learn.ts`
5. MCP: Delete `packages/mcp/src/tools/community.ts`
6. MCP: Review `packages/mcp/src/tools/recall.ts` — keep event/session search, remove lesson search path
7. MCP: Update tool registration in server.ts
8. MCP: Update tests
9. Build + test all packages

**Depends on:** Batch 5  
**Files:** `packages/sdk/src/client.ts`, `packages/mcp/src/tools/`, `packages/mcp/src/server.ts`

---

## Batch 7: Cloud Schema + Migration Script (US-7, US-8 partial)
**Goal:** Clean up cloud lesson tables, add export script

**Tasks:**
1. Cloud: Add deprecation migration renaming `lessons` table
2. Cloud: Remove `'lesson'` from ingestion gateway accepted types
3. Cloud: Update cloud tests
4. Create `scripts/export-lessons.ts` — reads existing AgentLens SQLite, outputs Lore-compatible JSON
5. Add `agentlens export-lessons` CLI command (or standalone script)
6. Test export script with sample data

**Depends on:** Batch 4  
**Files:** `packages/server/src/cloud/`, new `scripts/export-lessons.ts`

---

## Batch 8: Tests + Docs + Version Bump (US-8)
**Goal:** Final cleanup, documentation, version bump

**Tasks:**
1. Run full test suite — fix any remaining failures
2. Update dashboard test files (smoke tests, page export tests, structure tests)
3. Write `docs/migration/lore-integration.md` — what changed, how to migrate
4. Update main README — replace memory sharing section with Lore integration blurb
5. Update CHANGELOG with breaking changes
6. Version bump: major version (breaking change)
7. Final build + full test run
8. Commit + tag

**Depends on:** All previous batches  
**Files:** docs, README, CHANGELOG, package.json versions

---

## Dependency Graph

```
Batch 1 (config)
  ├── Batch 2 (proxy routes) 
  │     └── Batch 4 (remove server code)
  │           ├── Batch 5 (remove pool-server + core)
  │           │     └── Batch 6 (SDK + MCP)
  │           └── Batch 7 (cloud + export)
  └── Batch 3 (dashboard)
                    ↘
                      Batch 8 (tests + docs) ← all batches
```

Batches 3 and 2 can run in parallel. Batch 7 can run parallel with 5/6.

## BMAD Flow (per batch)

1. **Dev:** Implement all tasks, write tests (red-green-refactor)
2. **Review:** Adversarial code review (3-10 issues minimum)
3. **Fix:** Address all CRITICAL/HIGH findings
4. **Test:** Full test suite passes
5. **Commit:** Single commit per batch with descriptive message

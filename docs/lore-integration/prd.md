# Lore Integration PRD — AgentLens

**Author:** John (Product)  
**Date:** 2026-02-12  
**Status:** Draft

---

## Overview

Remove AgentLens's built-in lesson/memory sharing system and replace it with an optional Lore integration. AgentLens becomes purely observability; Lore handles all memory concerns.

## Personas

1. **Observability User** — Uses AgentLens for tracing, cost tracking, session replay. Doesn't need lessons. Should see a clean dashboard without memory features cluttering the UI.
2. **Memory + Observability User** — Uses both AgentLens and Lore. Wants lesson pages in the AgentLens dashboard, delegating to their Lore instance.
3. **SDK Developer** — Currently calls `agentlens.createLesson()`. Needs a clear migration path to `lore-sdk`.
4. **MCP User** — Uses AgentLens MCP tools for learn/recall/community. Needs to know those moved to Lore's MCP server.

## User Stories

### US-1: Feature Flag Configuration
**As** an operator, **I want** to enable/disable Lore integration via config, **so that** AgentLens works as pure observability by default and I can opt in to memory features.

**Acceptance Criteria:**
- `LORE_ENABLED` env var (default: `false`)
- When `true`, must also provide `LORE_API_URL` + `LORE_API_KEY` (remote) or `LORE_LOCAL=true` (local)
- Server validates config on startup — clear error if LORE_ENABLED but missing connection details
- `GET /api/config/features` returns `{ lore: boolean }` (no auth required — it's a UI feature flag)

### US-2: Dashboard Conditional Rendering
**As** a user, **I want** lesson/community pages to only appear when Lore is configured, **so that** the dashboard is clean when I only use observability.

**Acceptance Criteria:**
- Dashboard fetches `/api/config/features` on mount
- Nav items (Lessons, Sharing, Community, Sharing Activity) hidden when `lore: false`
- Routes return redirect to `/` when accessed directly with Lore disabled
- No lazy-load of lesson page bundles when Lore disabled (zero bundle cost)

### US-3: Server Proxy Routes
**As** a user with Lore enabled, **I want** AgentLens to proxy lesson/community API calls to Lore, **so that** I get a unified API surface.

**Acceptance Criteria:**
- `/api/lessons/*` routes proxy to Lore API (CRUD, list, search)
- `/api/community/*` routes proxy to Lore API (share, search, rate)
- Proxy adds AgentLens tenant context (maps AgentLens API key → Lore API key)
- Routes only registered when Lore enabled
- Error responses from Lore forwarded cleanly to dashboard

### US-4: Remove Built-in Implementation
**As** a maintainer, **I want** all built-in lesson/redaction/embedding code removed, **so that** there's zero duplication with Lore.

**Acceptance Criteria:**
- `packages/pool-server/` deleted from workspace
- `packages/server/src/db/lesson-store.ts` deleted
- `packages/server/src/services/community-service.ts` deleted
- `packages/server/src/lib/redaction/` deleted (all 8 files)
- `packages/server/src/lib/embeddings/` deleted (all 7 files)
- Associated test files deleted
- `packages/core/` lesson/community/redaction types removed or moved to compat shim
- No import of deleted modules anywhere in codebase
- Build succeeds, all remaining tests pass

### US-5: SDK Deprecation
**As** an SDK developer, **I want** clear deprecation of lesson methods, **so that** I know to migrate to `lore-sdk`.

**Acceptance Criteria:**
- `AgentLensClient` lesson methods (`createLesson`, `getLessons`, `getLesson`, `updateLesson`, `deleteLesson`) marked `@deprecated` with message pointing to `lore-sdk`
- Methods throw `Error('Lesson methods removed. Use lore-sdk directly.')` when called
- SDK type exports (`Lesson`, `LessonQuery`, etc.) re-exported from lore-sdk or removed
- CHANGELOG documents breaking change

### US-6: MCP Tool Cleanup
**As** an MCP user, **I want** to know that learn/recall/community tools moved to Lore's MCP server, **so that** I can update my MCP config.

**Acceptance Criteria:**
- `agentlens_learn` tool removed from MCP server
- `agentlens_community` tool removed from MCP server
- `agentlens_recall` tool stays IF it queries observability data (events/sessions), removed if it only queries lessons
- MCP README updated with migration note pointing to `lore mcp`

### US-7: Cloud Schema Cleanup
**As** a maintainer, **I want** lesson-related cloud tables marked for deprecation, **so that** the cloud schema stays clean.

**Acceptance Criteria:**
- Cloud migration adds deprecation comment to `lessons` table
- Cloud ingestion gateway no longer processes `lesson` type
- Cloud tests updated to reflect removal
- Note: actual table DROP deferred to future migration (data safety)

### US-8: Migration Guide & Docs
**As** a user upgrading AgentLens, **I want** a clear migration guide, **so that** I know what changed and how to adapt.

**Acceptance Criteria:**
- `docs/migration/lore-integration.md` explains: what was removed, how to set up Lore, how to migrate existing lesson data
- README updated: memory sharing section replaced with "Integrates with Lore" blurb
- CHANGELOG documents all breaking changes
- Migration script: `agentlens export-lessons --format lore` to dump existing SQLite lessons into Lore-compatible JSON

## Out of Scope
- Hybrid Lore mode (local + remote sync) — deferred to Lore Phase 3
- Auto-migration of existing lessons — manual export/import is sufficient
- Lore dashboard embedded in AgentLens — separate products, separate UIs (AgentLens proxies API only)

## Non-Functional Requirements
- Zero performance regression for observability features
- Build time should decrease (fewer packages)
- Bundle size should decrease when Lore disabled
- No new runtime dependencies when Lore disabled

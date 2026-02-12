# Changelog

## 0.12.0 — Lore Integration (Breaking)

### ⚠️ Breaking Changes

- **Lesson CRUD removed from server** — `POST/GET/PUT/DELETE /api/lessons` no longer available. Use [Lore](https://github.com/amitpaz1/lore) instead.
- **Community sharing removed from server** — `/api/community/*` endpoints removed.
- **Redaction pipeline removed from server** — 6-layer redaction pipeline deleted.
- **`pool-server` package removed** — Entire package deleted from monorepo.
- **SDK lesson methods deprecated** — `createLesson()`, `getLessons()`, `updateLesson()`, `deleteLesson()`, `searchLessons()` now throw errors.
- **MCP tools removed** — `agentlens_learn` and `agentlens_community` tools removed from `@agentlensai/mcp`.

### ✨ New Features

- **`LORE_ENABLED` feature flag** — Toggle Lore integration via environment variable.
- **`GET /api/config/features`** — Public endpoint returning feature flags.
- **Lore proxy routes** — When enabled, `/api/lore/*` proxies to configured Lore server.
- **Dashboard conditional rendering** — Lessons and Community nav items appear only when Lore is enabled.
- **Lesson export script** — `scripts/export-lessons.ts` for migrating existing data to Lore.

### 📖 Documentation

- Migration guide: `docs/migration/lore-integration.md`
- Updated README with Lore integration section

See the [migration guide](docs/migration/lore-integration.md) for upgrade instructions.

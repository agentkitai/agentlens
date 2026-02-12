# Lore Integration Brief — AgentLens

**Author:** Paige (Product Strategy)  
**Date:** 2026-02-12  
**Status:** Draft

---

## Executive Summary

AgentLens has a built-in lesson/memory sharing system spanning 6 packages (~5,000+ lines of source code, ~3,000+ lines of tests). We've now built **Lore** — a standalone cross-agent memory SDK and server — that does the same thing better, as a dedicated product.

This initiative removes the duplication by making Lore an **optional integration** in AgentLens: when configured, all lesson/memory features delegate to Lore; when not configured, those features simply don't appear.

## Problem Statement

1. **Maintenance burden**: Two codebases implementing the same thing (lessons, redaction, embeddings, semantic search, voting, community sharing)
2. **Feature divergence risk**: Bug fixes or improvements in one don't reach the other
3. **Product clarity**: AgentLens should be observability. Lore should be memory. The current AgentLens conflates both.
4. **Bundle bloat**: Users who just want tracing get lesson pages, redaction layers, and embedding engines they never use

## Strategic Goal

**AgentLens = Observability. Lore = Memory.**

Clean separation. Two products, each excellent at one thing. When used together, they're better than either alone.

## Scope

### What Changes
- Lesson CRUD, community sharing, redaction pipeline, embedding engine → removed from AgentLens
- Server lesson routes → thin proxy to Lore (when enabled)
- Dashboard lesson/community pages → conditionally rendered via feature flag
- `pool-server` package → deleted entirely (Lore server replaces it)
- SDK lesson methods → deprecated wrappers or removed
- MCP learn/recall/community tools → removed (Lore has its own MCP server)

### What Stays
All observability features: event ingestion, session tracking, cost analysis, guardrails, benchmarking, session replay, health scores, alerts, optimization engine, cloud multi-tenant.

### What's New
- `LORE_ENABLED` feature flag + config
- `GET /api/config/features` endpoint
- Dashboard feature detection (hides/shows nav items)
- Thin Lore proxy layer in server (when enabled)
- Migration guide for SDK users

## Integration Model

**Optional, default-off.** AgentLens works perfectly without Lore. When `LORE_ENABLED=true`:

1. **Local mode**: AgentLens uses `lore-sdk` directly (SQLite, no server needed)
2. **Remote mode**: AgentLens proxies to a Lore Phase 2 server

This mirrors how people actually use tools: start simple (local), scale when needed (remote).

## Success Metrics

- Zero regressions in non-lesson AgentLens features
- All existing tests for observability features still pass
- Dashboard loads faster when Lore disabled (fewer pages, no embedding deps)
- Clean `package.json` — no redaction/embedding deps when Lore not needed

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking change for SDK lesson users | Medium | Deprecation warnings, migration guide, major version bump |
| Test count drops significantly | Low | Expected — those tests live in Lore now |
| Cloud lesson tables orphaned | Low | Migration script + cleanup migration |

## Timeline Estimate

~6-8 hours across 7-8 batches. Mostly deletion and rewiring, not greenfield.

## Decision: Optional vs Mandatory

**Optional (default-off)** was chosen because:
- AgentLens shouldn't require a Lore server to start
- Pure-observability users get a leaner product
- Minimal extra implementation cost (~30 min for feature flag + conditional routing)

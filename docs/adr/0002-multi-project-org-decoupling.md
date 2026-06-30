# ADR 0002 — Multi-project: decouple project from tenant (org → project)

Status: accepted (2026-06-30). **Supersedes ADR 0001 §1** (the "explicit `org_id` + `project_id` columns on every tenant-scoped table" scoping choice). Tracked by epic #227; resolves the direction of #225.

## Context

The product now has a real multi-project requirement: **one organization → many isolated projects, with shared members and billing** (e.g. one customer running a support bot, a sales drafter, and a coding assistant as three separate, isolated workspaces under one account, one team, one bill).

Today AgentLens (OSS) isolates all data by a flat `tenant_id`, and `project_id` exists on only 3 tables (`events`/`sessions`/`agents`) as a nullable column shimmed to `= tenant_id` (`tenant-scoped-store.ts:36`). Nothing in the auth path supplies a project, so `project_id` is structurally incapable of differing from `tenant_id` (see #225).

A code-grounded blast-radius scan established the key facts:

- **`tenant_id` is already a per-workspace isolation key** — every tenant is a private workspace, and the data layer isolates by it perfectly (proven end-to-end by `tenant-isolation.test.ts`).
- The org→project→member hierarchy (`orgs`/`projects`/`org_members`/`project_members`) and its membership primitives (`OrgProjectStore.getEffectiveRole`, `listUserProjects`) **already exist** but are unused by the request path.
- 50 tables carry `tenant_id`; only 3 carry org/project. Adding `project_id` to all of them (ADR 0001's plan) is ~2,645 references / ~250 files / both dialects, over the most isolation-sensitive code (a cross-tenant-leak class change).
- The **cloud edition** (`packages/server/src/cloud/`) is a *separate* schema keyed on `org_id UUID` + Postgres RLS + partitioning, with **no project concept and no `tenant_id`**.
- `computeEventHash` excludes tenant/org/project — so project metadata is not part of the hash chain.

Greenfield: there is no production data to preserve, and breaking compatibility is acceptable.

## Decision

1. **`tenant_id` IS the project-level isolation key (OSS).** Treat the existing `tenant_id` as the project id. `org` is the grouping/billing tier above it (`orgs`/`projects`/membership). We do **not** add `project_id` to the other 47 tables — the data layer is left untouched, and project isolation reuses the battle-tested tenant isolation. The redundant `project_id` columns on `events`/`sessions`/`agents` are left `= tenant_id` (cleanup optional). `org_id` continues to be stamped on those 3 for fast org-level rollups.

   Rationale for superseding ADR 0001 §1: its stated benefits (projects move orgs, org-level queries, per-project roles) are all satisfied by this model (move = update `projects.org_id`; org queries = join `projects` or the stamped `events.org_id`; per-project roles = `project_members`), at ~5× less work and without surgery on the leak-class code.

2. **Edition-agnostic contract.** Auth resolves a credential → `(orgId, projectId)`. Each edition maps `projectId` onto its own physical isolation:
   - **OSS** → the `tenant_id` filter (the resolved project id is passed as `tenant_id`).
   - **Cloud** → a `project_id` column + an `app.current_project` RLS GUC (below the existing `org_id`/`app.current_org`).

   The org/project/membership domain (`OrgProjectStore`) and the auth resolution are shared, built once; only the data-storage mapping differs (as the two editions already diverge today: TEXT `tenant_id` vs UUID `org_id` + RLS + partitions).

3. **Per-project access from v1.** `project_id` is a real read-time authorization boundary: every request validates membership via `OrgProjectStore.getEffectiveRole(projectId, userId)` (a project member, or the inheriting org role) and 403s on no access.

4. **Project routing — all three mechanisms:** per-project API keys (`api_keys.project_id`), a dashboard project switcher (session/JWT claim), and an explicit `X-Project-Id` header / `:projectId` path. All converge on one resolve-and-validate seam in `tenant-helper.ts`.

5. **Cloud edition is in scope** as its own sub-epic — it must grow a project sublayer below `org_id`. Cloud billing already rolls up at the org level (`usage_records` keyed by `org_id`), which already satisfies "shared billing across projects".

6. **"tenant" becomes an internal alias for "project".** The user-facing API/docs speak of projects; the physical `tenant_id` column-name rename is deferred as optional, mechanical debt-paydown — multi-project does **not** depend on it.

## Consequences

- The migration concentrates in the **auth/identity layer** (the 4-file collapse chain), the **management API**, **ingest stamping**, and the **dashboard** — not in a 50-table column migration. The dangerous compliance/audit/evidence readers are automatically project-scoped, because `tenant_id` is the project key.
- The existing `tenant-isolation.test.ts` *is* the project-isolation guarantee at the data layer; a new HTTP-path `project-isolation.test.ts` (two projects, one org) closes the vertical gap. CI must run with `DB_DIALECT=postgresql` for the Postgres project assertions to execute.
- The cloud edition is a comparable second effort, sharing the auth/domain contract.
- Naming hazard: code-level `tenant_id` now means "project"; the business "tenant/customer" is the `org`. Documented; rename deferred.

## Rollout

Epic **#227**, sequenced:

- Phase 0 — this ADR.
- Phase 1 (#228) — Project identity in auth (OSS) — **the crux / prerequisite**.
- Phase 2 (#229) — Project & membership management API.
- Phase 3 (#230) — Ingest project-stamping (the 4 non-SDK paths).
- Phase 4 (#231) — Dashboard project switcher.
- Phase 5 (#232) — HTTP project-isolation test suite (+ CI with Postgres).
- Phase 6 (#233) — Cloud edition project sublayer (sub-epic).

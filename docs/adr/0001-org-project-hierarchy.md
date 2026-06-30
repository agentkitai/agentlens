# ADR 0001 — Org → project → member hierarchy & unified role model (#147)

Status: accepted (2026-06-29). Supersedes the divergent OSS `tenant_id` / cloud `org_id` stacks.

## Decision

Unify identity on **org → project → member**, built as a sequence of small, green PRs.

1. **Scoping = explicit `org_id` + `project_id` columns** on every tenant-scoped
   table; `TenantScopedStore` filters **both** on every op (chosen over
   `tenant_id == project_id` for future flexibility: projects can move orgs,
   org-level queries, per-project roles). Backfill maps existing
   `tenant_id='default'` → `org_id='default'`, `project_id='default'`; each
   distinct legacy `tenant_id` becomes a project under the default org.
2. **One role enum** in `@agentkitai/auth`: `owner · admin · member · viewer ·
   auditor` over permissions `read · write · manage · billing · audit`. `editor`
   becomes a deprecated alias for `member`. `cloud/auth/rbac.ts` → thin re-export.
   The `api_keys.role`-derived `auditor` shortcut in `routes/audit-verify.ts` is
   removed. Verified agents authorize under the same map.
3. **Membership** = org-level role + optional per-project override
   (`project_members`); override wins, else the org role applies.
4. **Edition**: orgs / projects / RBAC ship in the OSS build.

## Staging (each its own merged PR)

1. **Schema + store** (this PR): `orgs` / `projects` / `org_members` /
   `project_members` (SQLite) + default-org/project backfill + a manage-guarded
   `/api/orgs` route. No data repartitioning yet.
2. **`TenantScopedStore` → (org_id, project_id)**: add the columns to data tables,
   backfill, scope every op on both, keep `tenant_id` as a compatibility shim.
3. **Role unification** in `@agentkitai/auth` (+ cloud re-export, audit-route cleanup).
4. **Audit-route cleanup** + remove the `api_keys.role` auditor shortcut.
5. **Retire the `tenant_id` shim** once all call sites have moved.

## Notes

- Postgres parity for the new tables ships alongside; SQLite is the tested path.
- Enterprise SSO (SAML/SCIM/enforcement) builds on this hierarchy — see #148.

## Addendum — #198: retire the `tenant_id` shim (decision, 2026-06-30)

A code audit of staging step 5 found the shim is a single line (`TenantScopedStore`:
`projectId = scope?.projectId ?? tenantId`) and, critically, that **`project_id` cannot
diverge from `tenant_id` today**: nothing in the request/auth path supplies a `projectId`
(unified-auth and `api_keys` carry only `org_id` / `tenant_id`), and only `events` /
`sessions` / `agents` even have the org/project columns — the other ~27 tenant-scoped
tables and several `events` readers remain `tenant_id`-only.

**Decision: RETAIN `tenant_id` as the coarse org/isolation key; do not physically remove
it now.** Removing the column today would be pure mechanical renaming across ~2645
references / ~250 files / ~30 tables / both dialects — maximum risk (an isolation
regression is a cross-tenant data-leak class bug) for zero behavioral decoupling, because
there is no project identity to decouple *to*. True decoupling is gated on a prerequisite
that #147 deliberately did not ship: a **project source-of-truth in auth**.

The physical-removal path is re-graduated into sequenced, no-milestone follow-ups:

1. **Project identity in auth/scope** — resolve + validate a `projectId` (unified-auth /
   api-keys / header) and plumb a real `scope:{orgId,projectId}` into `getTenantStore` so
   `project_id` *can* differ from `tenant_id`. Hard prerequisite for the rest.
2. **Schema parity** — org/project columns on the remaining tenant-scoped tables (both
   dialects), backfilled `project_id = tenant_id`, `org_id = 'default'`.
3. **Per-store migration batches** onto `(org_id, project_id)` + the remaining
   `tenant_id`-only `events` readers.
4. **Flip the default** (drop `?? tenantId`) and, only if a concrete multi-project product
   requirement lands (projects moving orgs, per-project roles in data reads), drop the
   column behind its own reversible migration.

Until then the shim stays — it is cheap, correct, and load-bearing. This resolves #198.

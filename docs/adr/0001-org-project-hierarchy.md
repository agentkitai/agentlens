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

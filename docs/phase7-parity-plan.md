# Goal prompt — drive "Phase 7 — Langfuse parity" to completion

> Paste this as your task. It is self-contained. Work the whole backlog issue-by-issue until the milestone has no open, unblocked issues left.

## Objective

Close the **Phase 7 — Langfuse parity** milestone (epic #154, issues #143–#153) in the `agentkitai/agentlens` repo. Each issue carries its own Goal / Scope checklist / Acceptance — those are the source of truth. Ship each one as its own PR, merged green. Keep going until every non-blocked issue in the milestone is closed.

Repo: `C:\Users\amitp\projects\agentkitai\agentlens` (pnpm monorepo; packages: core, server, dashboard, sdk, python-sdk, mcp, cli, auth, pricing). Background: a Langfuse parity audit (2026-06-29) produced these issues; the differentiators (hash-chain integrity, verified agent identity, signed exports/JWKS, pricing provenance) are already shipped and out of scope.

## The loop (repeat per issue)

1. **Pick the next issue** in dependency/priority order (see below). `gh issue view <N>` for its acceptance criteria.
2. **Branch** off `main`: `git checkout main && git pull --ff-only && git checkout -b feat/p7-<short-slug>`. Never commit to `main`.
3. **Implement** the issue's scope. Write code that matches the surrounding style. Add **real tests** that prove the acceptance criteria.
4. **Verify ALL green locally** (see Verification) — typecheck, tests, build for every package you touched.
5. **Commit** with the trailers your environment specifies (a Co-Authored-By + Claude-Session line). Use a clear `feat(<pkg>): … (#N)` subject.
6. **PR**: `gh pr create --base main --title "…" --body "…"` with `Closes #N`, a What-changed summary, a Test plan, and any deliberate-scope/deferred notes.
7. **Watch CI to green**: `gh pr checks <PR> --watch --interval 30`. Fix anything red; never merge red.
8. **Admin-merge**: `gh pr merge <PR> --admin --squash --delete-branch`. Confirm the issue auto-closed.
9. **Sync + record**: `git checkout main && git pull --ff-only`; tick the epic #154 checklist item; update memory.
10. **Next issue.** Stop only on the conditions below.

## Sequencing (respect dependencies)

- **Start with #146 (annotation review UI)** — its backend already shipped in #122, so it's the fastest real parity win. Pure dashboard work.
- **Playground chain:** #143 (LLM-connection/BYO-key store) → #145 (prompt runtime primitives) → #144 (Playground). Do not start #144 before #143 and #145 are merged.
- **Enterprise chain:** #147 (org→project hierarchy + unified role model) → #148 (SAML/SCIM/SSO). #148 depends on #147.
- Then tier-2 (#149, #150, #151, #152) in any order; finally tier-3 #153 (split its sub-items into their own issues as you pick them up).
- Within a tie, do tier-1 before tier-2 before tier-3.

## Architecture decisions (LOCKED — 2026-06-29; do not re-ask, do not pause)

These resolve what were the `needs-decision` items. Build to them.

**#147 — hierarchy + roles** (the single biggest, highest-risk item — build as a SEQUENCE of small green PRs under #147, never one mega-PR):
- **Explicit `org_id` + `project_id` columns** on every tenant-scoped table; `TenantScopedStore` filters BOTH on every op (the chosen, cleaner model — not tenant_id==project_id). Staged PRs:
  1. Schema: add `orgs` / `projects` / `org_members` / `project_members` (SQLite + Postgres) + `org_id`/`project_id` columns; backfill existing rows to a `default` org + `default` project (existing `tenant_id='default'` → `org_id='default'`, `project_id='default'`). Keep `tenant_id` as-is for now.
  2. Rewrite `TenantScopedStore` (+ helpers/routes) to scope on `(org_id, project_id)`, keeping `tenant_id` as a compat shim until all call sites move; migrate tests.
  3. Unify roles → 4. audit-route cleanup → 5. retire the `tenant_id` shim.
- **Single role enum `owner · admin · member · viewer · auditor`** over permissions `read · write · manage · billing · audit`, in `@agentkitai/auth`. `editor` = deprecated alias for `member`. `cloud/auth/rbac.ts` → thin re-export. Remove the `api_keys.role`-derived `auditor` shortcut in `routes/audit-verify.ts`. Verified agents authorize under this same map.
- Membership = org-level role + optional per-project override (`project_members`); override wins, else org role applies. JIT/SSO users land in the domain-owning org as `member`.
- Write a short ADR under `docs/adr/` at the start of #147 — it documents the above, it does **not** gate (no approval pause).

**#148 — enterprise SSO (full pass):**
- Ship **OIDC enterprise connections + SSO enforcement/domain-verification + SCIM 2.0 + full SAML 2.0** together. SAML may add ONE dependency: use **`@node-saml/node-saml`** (maintained passport-saml successor) for the SP-initiated flow, signed-assertion validation, metadata + ACS endpoints. Group→role mapping on the org's SSO connection config. Keep OIDC + OAuth working.
- **Edition:** orgs / projects / RBAC / OIDC login ship in the **OSS** build; **SCIM + SSO-enforcement sit behind an enterprise feature flag** (present, not removed; gate via a config flag, default off for OSS).
- No other new dependencies. New tables in both SQLite (tested) + Postgres (parity).

## Definition of done (per issue)

- Every acceptance criterion in the issue is met and checked off.
- New behavior has tests that fail if the logic breaks; full CI is green.
- If the issue is too large for one clean PR: ship the **highest-value testable slice**, and **file + document** the remainder (a follow-up issue + a note in the PR and the relevant `docs/*.md`) rather than half-building or stalling. This "ship the core, defer-and-document the rest" pattern is the established norm for this repo (see Phases 4–6).
- SQLite is the tested/default path; Postgres parity for new tables may be schema-only/deferred (note it) unless the issue says otherwise.

## Verification (these are the real gates)

Run for every package you touched:
- Typecheck: `cd packages/<pkg> && pnpm run typecheck`
- Tests: `cd packages/<pkg> && pnpm run test` (server suite is large; expect ~2300+ passing)
- Build: `pnpm build` (root) or `pnpm --filter @agentkitai/agentlens-<pkg> build`
- **After editing `core`**, rebuild it so dependents resolve new exports: `pnpm --filter @agentkitai/agentlens-core build`
- Python (if touched): `cd packages/python-sdk && PYTHONPATH=src python -m pytest -q`, plus `python -m ruff check <files>` and `python -m mypy src/` — all must pass (CI runs them on 3.9–3.13).

CI jobs that gate the merge: `test` (build + typecheck + per-package tests + coverage), `test-postgres`, `test-python-sdk` (×5 versions), `aha-demo`, Trivy (×2), `pnpm audit`. **CI does not run JS eslint** — it is not a merge gate, but keep your new files lint-clean (`pnpm exec eslint <files>`); ignore the known type-aware "phantom" eslint errors on pre-existing imports that `tsc` is happy with.

## Conventions & gotchas (learned on this repo)

- Server has its own `vitest.config.ts` with no coverage thresholds; the root config enforces `lines: 60` on core. Don't tank core coverage.
- Use explicit, ordered ISO timestamps in tests that build hash-chained event sequences — relying on `createEvent`'s default timestamp makes the chain-continuity guard flaky under other tests' fake timers.
- Server-only event types stay out of the client-ingest `eventTypeSchema`. Verified identity is server-set, never client-trusted.
- Drizzle table defs: eval/prompt/annotation/rollup tables are raw-SQL in `migrate.sqlite.ts` (idempotent `CREATE … IF NOT EXISTS` + PRAGMA-guarded `ALTER`), not always in the drizzle schema. Follow that pattern.
- New routes mount in `packages/server/src/routes/registration.ts`; `/api/*` is authed, non-`/api` paths are public.

## Reporting & checkpoints

- After **each** merged PR: one-line status (issue/sub-PR, PR#, squash SHA) and move on automatically. #147 ships as several merged sub-PRs — report each.
- Pause and ask only when: CI is red for a reason you can't resolve in 2–3 attempts; or an issue's scope reveals a genuinely new product decision not covered by the LOCKED decisions above.

## Stop conditions

- All issues in `Phase 7 — Langfuse parity` are closed → summarize the milestone outcome and stop.

Quick start: `gh issue list --repo agentkitai/agentlens --milestone "Phase 7 — Langfuse parity" --state open` → begin with **#146**.

# Multi-project (org → project) — autonomous loop plan

Drives **epic #227**. Order: **#228 → #229 → #230 → #231 → #232 → #233**, then close epic #227 **last**.
Promise phrase on completion: `MULTI-PROJECT-DONE`.

## Source of truth
- **ADR 0002** (`docs/adr/0002-multi-project-org-decoupling.md`) — the locked architecture + the
  edition-agnostic contract. Do not re-litigate it.
- **Epic #227** + each phase issue (`gh issue view <n>`) — per-phase scope, exact file seams,
  acceptance, dependencies.

## Order & dependencies
- **#228 Phase 1 (project identity in auth) is the CRUX and a hard prerequisite — do it FIRST.**
  It ships **together with #232 Phase 5** (the HTTP project-isolation tests are the *proof* of the
  security boundary): do **not** close #228 until cross-project isolation is proven through the real
  HTTP/auth path.
- After #228: #229 (management API), #230 (ingest stamping), #231 (dashboard) can proceed; #233
  (cloud) shares the same auth contract.
- Close epic **#227 last**, after ticking its checklist.

## Per-issue loop
branch `feat/<slug>` off main → implement with REAL tests that prove the acceptance → ALL green
LOCALLY: run **`pnpm typecheck` at REPO ROOT** (not per-package — `pnpm build` uses vite and does
not typecheck the dashboard) + the touched packages' tests + build; rebuild
`@agentkitai/agentlens-core` if edited; the server full suite must pass; python via ruff+mypy+pytest
if touched → commit with the env Co-Authored-By/Claude-Session trailers → `gh pr create --base main`
("Closes #N", or "Refs #N" for sub-slices) → `gh pr checks <PR> --watch --interval 30` → fix anything
red, NEVER merge red → **BEFORE merging, explicitly confirm the `test` job is GREEN** (it runs the
root typecheck across all packages; `--admin` will merge over a red `test` job — do not let it) →
`gh pr merge <PR> --admin --squash --delete-branch` → sync main → tick the epic checklist → update
memory file `agentlens-epics-rollout.md` → next.

## SECURITY gotchas (this is leak-class isolation code)
- A **cross-project read/write leak is the dangerous bug.** The Phase 5 project-isolation test (two
  projects, one org, via HTTP) is the gate — it must pass before Phase 1 (#228) closes.
- Run isolation tests on **both dialects**: CI `test` (sqlite) **and** `test-postgres`
  (`DB_DIALECT=postgresql`) — the Postgres project assertions are skipped without it.
- The fix funnels through `getTenantStore` / `tenant-helper.ts` — change it there, not per-route.
  Also fix the 3 direct `new TenantScopedStore` sites: `ingest.ts:319`, `alert-engine.ts:143/187`.
- **`tenant_id` IS the project id** (ADR 0002). Do NOT add `project_id` to the other 47 tables.
  Authorize every request's project via `OrgProjectStore.getEffectiveRole(projectId, userId)` → 403.
- `computeEventHash` excludes tenant/org/project → project stamping is hash-chain-safe.
- `schema-drift.test` forces `api_keys.project_id` (and any new column) into BOTH `schema.sqlite.ts`
  and `schema.postgres.ts`.
- pg gotchas still apply: `Number()` on pg counts; `ON CONFLICT … DO UPDATE`; SAVEPOINT for best-effort
  pg sub-writes; jsonb objects; `users.*`/`api_keys`/`service_tokens` timestamps are int epoch seconds.

## Re-graduation
Phase 4 (#231, dashboard frontend) and Phase 6 (#233, cloud sub-epic) are large. Split each into the
smallest shippable PRs; if a phase exceeds one clean PR, ship the highest-value testable slice and file
the remainder as a NO-milestone follow-up (or a sub-issue under the phase) — never let a big phase stall
the loop.

## Completion
ONLY when **#228, #229, #230, #231, #232, #233 are ALL closed** — verify each with
`gh issue view <n> --json state` — AND **epic #227 is closed last** — output exactly and only the
promise phrase `MULTI-PROJECT-DONE` wrapped in promise tags. Re-graduated remainders are no-milestone
follow-ups and do NOT block completion. While any of the seven is open, never output that string. Do
not lie to exit the loop.

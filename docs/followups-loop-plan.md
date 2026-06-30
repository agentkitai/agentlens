# Follow-ups loop plan (post-multi-project)

Drives the remaining no-milestone follow-ups. Order: **#220 → #240 → #242 → #224 → #246**,
small/clean first, the XL sub-epics last. Promise phrase on completion: `FOLLOWUPS-DONE`.

## Source of truth
Each issue body (`gh issue view <n>`) has the scope + exact file seams. ADR 0002
(`docs/adr/0002-multi-project-org-decoupling.md`) is the locked multi-project architecture —
do not re-litigate it. The patterns from the prior loops apply (dialect-agnostic stores; the
#59 control-plane-db pattern; the reframe: `tenant_id` IS the project, org is grouping-only).

## Order & nature
1. **#220 (S)** — make `getRollupAnalytics` + the `/rollup` route dialect-agnostic so the pg
   `cost_rollups` populated in #180 are *read* instead of returning 501. Same `jText`/`jNum` +
   `Number()`-coercion approach as #175 (`analytics-repository.ts`); add a pg test in
   `postgres-integration.test.ts`.
2. **#240 (S)** — `POST /api/projects/:pid/keys` minting a project-bound api key
   (`tenant_id` = the project, ADR 0002). `api_keys` are the **sqlite control plane**, so the
   route needs the sqlite `db` (mirror `serviceTokensRoutes(anyDb, db)` from #59), manage-guarded
   (admin/owner), with the target project validated to belong to the caller's org; reuse the
   `api-keys.ts` insert (raw `als_` token returned once). Add to `routes/projects.ts` (pass the
   sqlite db in addition to AnyDb).
3. **#242 (M, medium-risk)** — stamp the real `org_id` on events/sessions/agents at **write**
   (org-level rollups). HARD CONSTRAINT learned in #230: **`org_id` must be stamp-only, NOT a read
   filter** — `TenantScopedStore` must stamp org from a write-scope while reads filter by
   project/tenant only; reconcile the #147 org/project read-filters
   (`query-helpers.ts` `buildEventConditions`/`buildSessionConditions`) + the
   `org-project-scoping`/`#147` tests with the reframe; resolve the org for the non-SDK ingest paths
   too. Touches the isolation read path → extra test care + run CI with Postgres.
4. **#224 (XL bundle — ship-and-graduate)** — tier-3 parity: **(a)** media/audio object-storage
   offload [reuse the #151 `BlobPut`/`sinkFromConfig` + a `media_objects` table + a `MediaOffloader`
   in `append-event.ts` rewriting base64 parts to `media://` refs + a tenant-scoped signed GET];
   **(b)** dataset folders [`folder` column on `eval_datasets`]. **Re-graduate (c)** prompt folders +
   GitHub version-sync [octokit + secret-box — net-new external integration] and **(d)** evaluator
   sampling [needs a `LiveEvalEngine` first] to their own no-milestone issues.
5. **#246 (XL cloud sub-epic — ship-and-graduate)** — the cloud project sublayer: `project_id`
   column on cloud `events`/`sessions`/`agents` + `batch-writer` INSERT persist + the
   `app.current_project` RLS predicate + cloud API-key project binding. pg-tested via the cloud
   harness. Ship the schema + persist slice; re-graduate the RLS + key-binding if too big.

## Per-issue loop
branch `feat/<slug>` off main → implement with REAL tests proving acceptance → ALL green LOCALLY:
run `pnpm typecheck` **at repo root** (not per-package — vite build skips dashboard typecheck) +
the touched packages' tests + build; rebuild `@agentkitai/agentlens-core` if edited; the server full
suite must pass; python via ruff+mypy+pytest if touched → commit with the env
Co-Authored-By/Claude-Session trailers → `gh pr create --base main` ("Closes #N", or "Refs #N" for
sub-slices) → `gh pr checks <PR> --watch --interval 30` → fix anything red, NEVER merge red →
**confirm the `test` CI job is GREEN before `gh pr merge --admin --squash --delete-branch`** → sync
main → update memory file `agentlens-epics-rollout.md` → next.

## Gotchas (carried forward)
- pg vs sqlite: `Number()` on counts/aggregates; `ON CONFLICT … DO UPDATE` not `INSERT OR REPLACE`;
  SAVEPOINT (nested `tx.transaction`) for best-effort pg sub-writes; jsonb objects vs TEXT; `api_keys`/
  `service_tokens`/`users` timestamps are int epoch seconds.
- `schema-drift.test` forces dual-dialect column parity; raw-SQL-only tables (cost_*, eval_*,
  service_tokens, sso_connections) avoid the drift gate.
- ADR 0002: `tenant_id` IS the project; isolation is by project, org is grouping-only (stamp ≠ filter).
- #59 pattern: `api_keys` live in the sqlite control plane → routes that mutate them take the sqlite db.
- Run CI with Postgres (the `test-postgres` job) for any pg-path or cloud-RLS work.

## Re-graduation
**#224** and **#246** are XL — ship the highest-value testable slice and file the remainder as a
NO-milestone follow-up; never let a big item stall the loop. Closing #224/#246 means their shippable
slices landed AND the rest is graduated.

## Completion
ONLY when **#220, #240, #242, #224, #246 are ALL closed** — verify each with
`gh issue view <n> --json state` — output exactly and only the promise phrase `FOLLOWUPS-DONE`
wrapped in promise tags. Re-graduated remainders are no-milestone follow-ups and do NOT block. While
any of the five is open, never output that string. Do not lie to exit the loop.

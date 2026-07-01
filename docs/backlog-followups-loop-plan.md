# Backlog follow-ups loop plan (parity + audit)

Drives the last buildable backlog items to completion: **#252 → #253 → #254 → #99**.
Promise phrase on completion: `BACKLOG-DONE`.

## Philosophy (read this first)
**Finish each issue.** Re-graduation is a LAST RESORT — allowed only for a genuinely
separate large effort (a new external service, a whole new engine), and even then
ship a minimal *working* version of it first and file a NARROW follow-up naming the
specific remainder. Do NOT re-graduate a whole feature. Prefer done over deferred.
(#56 — the "agent control plane" roadmap tier — is deliberately OUT of scope: it's a
roadmap epic, not one implementable change.)

## Source of truth
Each issue body (`gh issue view <n>`) has the scope + file seams. Prior loop plans
(`docs/followups-loop-plan.md`, `multi-project-loop-plan.md`) and their gotchas apply.

## Order & scope
1. **#252 — media/audio offload.** Reuse the #151 `BlobPut`/`sinkFromConfig` sink +
   a `media_objects` table (id, tenant_id, content_type, size, sink, key, created_at,
   both dialects) + a `MediaOffloader` in `lib/append-event.ts` that walks
   `LlmMessage.content` parts and rewrites base64 image/audio over a size threshold to
   `media://<id>` refs, storing the blob via the sink; a tenant-scoped signed GET route
   to resolve `media://`; downstream readers (replay/builder, compliance-export)
   tolerate `media://` refs (resolve or pass through). Test: offload rewrites a base64
   part → `media://` + the GET resolves it back.
2. **#253 — prompt folders + GitHub version-sync.** (a) `folder` column on prompt
   templates (mirror the #224 dataset-folders slice, both dialects) + list filter —
   SHIP. (b) GitHub sync: push/pull prompt versions to a repo via octokit (the one
   justified new dep), PAT stored with the existing secret-box, a sync route. Ship a
   working one-way push at minimum; only two-way merge/conflict may re-graduate.
3. **#254 — evaluator sampling (online eval).** Build a minimal `LiveEvalEngine`: a
   sampler (configurable fraction of live events) + an async evaluator runner that
   scores sampled traces and writes results back as annotations. Ship the sampler +
   runner + one evaluator wired end-to-end; only additional evaluator *types* may
   re-graduate.
4. **#99 — RFC-3161 audit timestamping.** DECISION (locked by the user): implement an
   RFC-3161 TSA client; DEFER Sigstore/Rekor. A configurable TSA URL; on audit export,
   hash the export and POST to the TSA, store the returned RFC-3161 timestamp token
   alongside the export; a verify path checks the token against the export hash. Test:
   timestamp + verify round-trip against a mocked TSA (no network in tests).

## Per-issue loop
branch `feat/<slug>` off main → implement with REAL tests proving acceptance → ALL
green LOCALLY: `pnpm typecheck` at repo ROOT + touched-package tests + build; rebuild
`@agentkitai/agentlens-core` if edited; python via ruff+mypy+pytest if touched →
commit with the env Co-Authored-By/Claude-Session trailers → `gh pr create --base main`
("Closes #N") → `gh pr checks <PR> --watch --interval 30` → fix red, NEVER merge red →
confirm the `test` job (and `test-postgres` for any pg/cloud work) is GREEN before
`gh pr merge --admin --squash --delete-branch` → sync main → update the memory file →
next.

## Gotchas (carried forward)
- pg vs sqlite: `Number()` on counts/aggregates; `ON CONFLICT … DO UPDATE` not `INSERT
  OR REPLACE`; SAVEPOINT for best-effort pg sub-writes; jsonb vs TEXT; int epoch seconds.
- pg RLS/GUC: use `set_config(name, val, true)` — pg rejects a param in a bare `SET`; a
  custom GUC reverts to `''` (not NULL) on a pooled connection → `NULLIF(…, '')`; the pg
  superuser BYPASSES RLS → `SET LOCAL ROLE` a non-superuser to test isolation.
- cloud tests: `it.skipIf(!pgAvailable)` ALWAYS skips (evaluated at collection time) →
  use `const d = DATABASE_URL ? describe : describe.skip`; cloud pg tests run via
  `vitest.cloud-postgres.config.ts` (the #258 harness), fileParallelism:false.
- `schema-drift.test` forces dual-dialect column parity; raw-SQL-only tables (eval_*,
  cost_*, and any new `media_objects`) avoid the gate — keep new tables out of the
  drizzle schema modules unless you add both dialects.
- dashboard typecheck isn't covered by the vite build → always `pnpm typecheck` at root.
- Reuse the existing secret-box for the #253 PAT; the only justified new dependency in
  this whole loop is octokit (#253). No other new deps.

## Re-graduation (last resort)
Only for a genuinely separate large effort, and only after shipping a minimal working
version; file a NARROW follow-up naming the exact remainder. Never punt a whole feature.

## Completion
ONLY when **#252, #253, #254, #99 are ALL closed** — verify each with
`gh issue view <n> --json state` — output exactly and only `BACKLOG-DONE` wrapped in
promise tags. While any of the four is open, never output that string. Do not lie to
exit the loop.

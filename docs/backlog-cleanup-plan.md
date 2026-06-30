# Backlog cleanup plan — #59 + deferred items

Autonomous loop plan. Locked 2026-06-30. Order: **#59 → #175 → #180 → #211 → #214 → #198**
(mechanical wins first, judgment-heavy #198 last). Promise phrase on completion: `SPEND-AND-DEFERRED-DONE`.

## Locked conventions (apply to every issue)

- **Store pattern:** ONE dialect-agnostic store over `AnyDb` (SqliteDb|PostgresDb) via
  `packages/server/src/db/dialect-db.ts` helpers (`dbRun`/`dbAll`/`dbGet`/`runInTransaction`).
  `CostBudgetStore` is the canonical example. NEVER branch on `isSqliteDb` except where a
  method is already pg-deferred.
- **Schema changes land in BOTH dialects in lockstep:** `schema.sqlite.ts` + `schema.postgres.ts`
  (schema-drift.test enforces column-name parity) + an idempotent `migrate.sqlite.ts` add +
  a new `db/drizzle/00NN_*.sql` (+ `_journal.json` entry) for pg.
- **pg vs sqlite gotchas:** COUNT/bigint/double return **strings** on node-postgres (`Number()` them);
  use `ON CONFLICT … DO UPDATE`, never `INSERT OR REPLACE`; a failed statement aborts the whole pg tx
  (use SAVEPOINT / nested `tx.transaction` for best-effort sub-writes); `users.*` timestamps are int4
  epoch **seconds** (`Math.floor(Date.now()/1000)`); jsonb returns objects on pg vs text on sqlite;
  raw `db.execute()` → use a `rowsOf()` helper.

---

## (1) #59 — Internal spend: per-tenant service tokens + rotation → **Closes #59**

The leak: `routes/internal.ts:64` `app.use('*')` constant-time-compares the Bearer against the single
`getConfig().agentgateServiceToken`, then every handler trusts a `tenantId` from the body (`/spend:87`,
`/reconcile:182`, eval schemas) or query (`agent-eval-status:366`) — so any token holder reads any tenant.

**Approach:** new `service_tokens` table (`id, token_hash, tenant_id, name, created_at, last_used_at,
revoked_at, rotated_at, expires_at, created_by`; index on `token_hash`) — do NOT overload `api_keys`.
Dialect-agnostic `ServiceTokenStore(AnyDb)` mirroring `CostBudgetStore`; reuse `hashApiKey` (sha256,
`middleware/auth.ts:39`) and the SH-6 overlapping-rotation pattern (`routes/api-keys.ts:97` +
`cleanupExpiredRotatedKeys:206`). Token prefix `agl_svc_`; store only the hash. Rewrite the internal.ts
middleware to hash the Bearer → look up an ACTIVE token (`revoked_at IS NULL AND (expires_at IS NULL OR
expires_at>now)`) → `c.set('serviceTenantId', row.tenantId)`; 401 on no match; touch `last_used_at`
fire-and-forget. In EACH handler assert request `tenantId` (body or query) === `serviceTenantId` → 403 on
mismatch. KEEP a legacy fallback: if no DB token matches AND env `AGENTGATE_SERVICE_TOKEN` is set,
constant-time-compare it as org-wide with a one-time deprecation warn. **DO NOT touch the OUTBOUND use of
`agentgateServiceToken` in `lib/ingest-key-verify.ts:78,90`** — that direction stays. Preserve the
`/api/internal` self-auth invariant (`public-paths.ts:33` SELF_AUTH_PREFIXES, `route-coverage-auth.test.ts:22`
SEPARATE_AUTH) — update only the doc comment. Add admin-only (owner/admin RBAC under unified auth)
mint/list/revoke/rotate routes mirroring `routes/api-keys.ts` (raw token returned once).

**Slices:** (1a) schema+store+pg-drizzle, unit-tested both dialects; (1b) auth enforcement — extend
`__tests__/internal-spend.test.ts`: token@A+tenantId=A→200, token@A+tenantId=B→403, revoked/expired→401,
legacy env→org-wide+deprecation, rotation overlap both valid until grace; reconcile the 503-when-unset case
(503 = no tokens AND no env; 401 = presented-but-invalid); (1c) mint/rotate routes+tests; (1d) wire
`cleanupExpiredServiceTokens` + mark `AGENTGATE_SERVICE_TOKEN` inbound-deprecated in `config.ts`.

## (2) #175 — Postgres support for prompt version-analytics → **Closes #175**

`getVersionAnalytics` / `getVersionAnalyticsByAgent` (`db/prompt-store.ts`) are sqlite-only (`json_extract` /
raw SQL that breaks on pg). **Approach:** make them dialect-neutral — read rows and shape/aggregate in JS
rather than `json_extract`, or route through dialect-db helpers; `COUNT`→`Number()` on pg. Add a pg test in
`__tests__/postgres-integration.test.ts` asserting analytics are correct on the pg path.

## (3) #180 — Populate cost_rollups on the Postgres ingest path → **Closes #180**

Today `applyRollupBatch` (`lib/rollup.ts:151`, sync, `INSERT OR REPLACE`) runs only in the better-sqlite3 tx
(`event-repository.ts:144`); `PostgresEventStore.insertEvents` (`postgres-store.ts:204`) never writes rollups.

**Approach:** (3a) extract the per-bucket merge math (existing row + `aggregateBatch` bucket → cumulative row +
unioned `pricing_versions` JSON-set) into a shared pure helper; keep sync `applyRollupBatch` for sqlite.
(3b) add async `applyRollupBatchPg(tx,events,pv)`: `aggregateBatch` → per bucket `await tx.execute(SELECT…)`
(`rowsOf` + `Number()`-coerce counts) → `INSERT … ON CONFLICT (tenant_id,verified_agent_id,model,bucket_start,
granularity) DO UPDATE SET col=excluded.col`. (3c) call it at the tail of `insertEvents` **inside a SAVEPOINT**
(nested `tx.transaction`) so a rollup failure rolls back only the rollup, not the ingest (pg aborts the whole
tx on error — this is the deferral reason; the sqlite swallow-and-continue does NOT translate). (3d) pg test in
`postgres-integration.test.ts`: ingest chained `llm_response`/`cost_tracked` events (`metadata.verifiedAgentId`
set), assert `cost_rollups` rows with correct sums, then a second batch into the same hour accumulates and
`pricing_versions` retains provenance. The `getRollupAnalytics`/`/rollup` 501-on-pg read path is OUT OF SCOPE —
file a no-milestone follow-up.

## (4) #211 — Integrations stretch: JS LlamaIndex + Haystack → **Closes #211**

(4a) **JS LlamaIndex:** mirror `packages/sdk/src/langchain.ts` (a handler → `Instrumentation.capture(LlmCapture)`),
expose as the `@agentkitai/agentlens-sdk/llamaindex` subpath in `package.json` exports; LlamaIndex.TS dep as an
OPTIONAL peerDependency + dev dep; vitest with a mock Instrumentation.
(4b) **Python Haystack:** mirror `python-sdk integrations/llamaindex.py` — a Haystack v2 adapter →
`client.log_llm_call(LogLlmCallParams)`; add optional extra `haystack=["haystack-ai>=2.0"]` (+ in `all`), add
`haystack.*` to the mypy `ignore_missing_imports` overrides, and a `tests/test_haystack.py` that MOCKS the
haystack module hierarchy (the bedrock `sys.modules` pattern). VERIFY PYTHON LOCALLY before push:
`python -m ruff check`, `python -m mypy src/ --exclude '_pytest|pytest'`, `python -m pytest` (line-length 100).

## (5) #214 — Langfuse parity polish remainder (no milestone) → **Closes #214 after ship + graduate**

SHIP two items here, RE-GRADUATE two.

- **SHIP (a) MEDIA OFFLOAD:** new `media_objects` table + dialect-agnostic `MediaStore`, and a `MediaOffloader`
  hooked in `lib/append-event.ts` that walks `LlmMessage.content` parts and, when a base64 image_url/audio part
  exceeds a size threshold, puts the bytes via the EXISTING #151 `BlobPut` sink (built from `sinkFromConfig` —
  share the export sink config) and replaces the inline base64 with a `media://<id>` ref (store
  content-type/sha/size/tenant); a tenant-scoped signed GET resolves it. Add audio as an allowed part type in
  core `LlmMessage`. Downstream readers (replay/builder, compliance-export, dashboard render) must tolerate
  `media://` refs and compose with the existing `redacted` flag.
- **SHIP (c) DATASET FOLDERS + FROM-TRACES:** additive `folder` column on `eval_datasets` (NOT `parent_id` —
  that's version lineage) + folder filter in `EvalStore.listDatasets`; `EvalStore.createItemsFromTrace(tenantId,
  sessionId)` that reads `llm_call`/`llm_response` events and inserts `eval_test_cases` with provenance metadata
  (`sourceEventId`) — shape rows in JS, no `json_extract`; dataset/test-case media attachments reuse `MediaStore`.
- **RE-GRADUATE** to their own no-milestone issues: (b) prompt folders + composability + GitHub version-sync
  (octokit, secret-box token storage — net-new external integration), and (d) evaluator sampling-rate, which
  REQUIRES building a `LiveEvalEngine` first (a new eventBus `'event_ingested'` consumer modeled on
  `lib/guardrails/engine.ts` that pairs `llm_call`+`llm_response` into a `ScorerContext` and runs `EvaluatorStore`
  evaluators via `ScorerRegistry` — an XL subsystem needing cost budgeting/backpressure; sampling is meaningless
  without it).

Tests per store mirroring `db/__tests__/eval-store.test.ts` (MediaOffloader: inject a fake `BlobPut`, assert
base64→`media://` + blob written + row persisted + signed GET round-trip; `createItemsFromTrace`: seed events,
assert test cases + provenance). Close #214 once (a)+(c) land and (b)+(d) are filed as no-milestone follow-ups.

## (6) #198 — Retire the tenant_id shim (follow-up from #147) → **Closes #198 via ADR decision**

DO NOT attempt a big-bang tenant_id removal (2645 refs / ~250 files / ~30 tables / both dialects / the
most-tested isolation code — an isolation regression is a cross-tenant leak class bug). The shim is one line
(`tenant-scoped-store.ts:35` `projectId = scope?.projectId ?? tenantId`), and project_id is STRUCTURALLY
incapable of diverging from tenant_id today because nothing in the request/auth path carries a projectId
(unified-auth/api_keys have only orgId/tenantId; only events/sessions/agents even have the columns).

**Approach:** ship ONE doc PR that updates `docs/adr/0001` with the decision — RECOMMEND retaining tenant_id as
the coarse org/isolation key and closing the shim conceptually, documenting that true decoupling first requires a
project source-of-truth in auth (a deliberate #147 non-deliverable). Re-graduate the physical-removal path into
tracked no-milestone issues: (i) "project identity in auth/scope" prerequisite, (ii) schema parity for the
remaining ~27 tenant-scoped tables, (iii) N per-store migration batches, (iv) final column drop. Close #198 once
the ADR records the decision and the remainder is graduated.

---

## Per-issue loop

branch `feat/<slug>` off main → implement with REAL tests that prove acceptance → ALL green LOCALLY: run
`pnpm typecheck` **AT REPO ROOT** (NOT just per-package — `pnpm build` uses vite and does NOT typecheck the
dashboard; adding a core `EventType`/type breaks exhaustive `Record<EventType,…>` maps like
`EventsExplorer.tsx`) + the touched packages' tests + build; rebuild `@agentkitai/agentlens-core`
(`pnpm --filter @agentkitai/agentlens-core build`) after editing it so server/dashboard/sdk see new exports;
the server full suite must pass; for python verify ruff+mypy+pytest locally → commit with the env
Co-Authored-By/Claude-Session trailers → `gh pr create --base main` with "Closes #N" (or "Refs #N" for
sub-slices) + What-changed + Test-plan → `gh pr checks <PR> --watch --interval 30` → fix anything red, NEVER
merge red → **BEFORE merging, explicitly confirm the `test` job is GREEN** (it runs the root typecheck across
all packages; `--admin` will happily merge over a red `test` job — do not let it) →
`gh pr merge <PR> --admin --squash --delete-branch` → sync main → tick the issue checklist → update memory file
`agentlens-epics-rollout.md` → next.

If a unit is too big for one clean PR, ship the highest-value testable slice and FILE the remainder as a
follow-up issue with NO milestone — never let an XL item stall the loop.

## Completion

ONLY when **#59, #175, #180, #211, #214, AND #198 are ALL CLOSED** — verify with `gh issue view <n> --json state`
for each — and only then output exactly and only the promise phrase `SPEND-AND-DEFERRED-DONE` wrapped in promise
tags. Re-graduated remainders are no-milestone follow-ups and do NOT block completion. While any of the six is
open, never output that string. Do not lie to exit the loop.

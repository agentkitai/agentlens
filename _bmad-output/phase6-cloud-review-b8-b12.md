# Phase 6 — Cloud Code Review (Batches 8–12) + QA Fix Verification

**Reviewer:** QA Subagent  
**Date:** 2026-02-09  
**Scope:** B8A (Python SDK cloud mode), B8B (Billing completion), B9A (Retention), B9B (Dashboard pages), B10 (Migration), B11-B12 (Docs), Earlier QA fix verification (F-01 through F-05)

---

## Summary Table

| ID | Severity | Area | File | Description |
|----|----------|------|------|-------------|
| B8A-01 | **MEDIUM** | Correctness | `_sender.py` | `QuotaExceededError` catch buffers to disk but never retries/replays buffered events |
| B8A-02 | **LOW** | API Design | `_init.py` | `cloud=True` without `api_key` silently sends unauthenticated requests |
| B8A-03 | **LOW** | Code Quality | `client.py` | `_do_request` catches only `httpx.ConnectError`, not `httpx.TimeoutException` |
| B8B-01 | **HIGH** | Data Integrity | `plan-management.ts` | Upgrade cancels existing subscription immediately then creates new one — gap where org has no active subscription |
| B8B-02 | **HIGH** | Schema | `invoice-service.ts` | Import uses `billing_interval` and `line_items` columns — still not verified to exist in migration schema |
| B8B-03 | **MEDIUM** | Logic | `plan-management.ts` | Downgrade to non-free paid tier cancels subscription at period end but `applyPendingDowngrade` creates new sub — race condition if webhook fires during creation |
| B8B-04 | **MEDIUM** | Logic | `trial-service.ts` | `expireTrials` queries `settings->>'trial_ends_at' < $1` — string comparison of ISO dates works but relies on UTC format consistency |
| B8B-05 | **MEDIUM** | Security | `invoice-service.ts` | `syncInvoiceFromWebhook` trusts event data without validating event type (e.g., `invoice.paid` vs `invoice.created`) |
| B8B-06 | **LOW** | Code Quality | `plan-management.ts`, `trial-service.ts` | Both use `(result.rows as any[])` pattern — no type safety |
| B9A-01 | **HIGH** | Data Loss | `retention-job.ts` | `purgeExpiredData` uses raw `DELETE FROM ${table}` with `assertSafe` — but table name is from a constant, not user input; however the `DELETE` has no `LIMIT`/batching, which can lock the table for very large orgs |
| B9A-02 | **MEDIUM** | Schema | `retention-job.ts` | Queries `organizations` table (line ~155) but cloud schema uses `orgs` table — will fail at runtime |
| B9A-03 | **MEDIUM** | Schema | `partition-management.ts` | Also queries `organizations` table (line ~164) — same mismatch |
| B9A-04 | **MEDIUM** | Logic | `retention-job.ts` | `checkExpiryWarnings` generates warnings but has no delivery mechanism (no email, no dashboard notification) |
| B9A-05 | **LOW** | Performance | `retention-job.ts` | Processes orgs sequentially; for many orgs, this could exceed cron window |
| B9B-01 | **HIGH** | Bug | `DlqDashboard.tsx` | Destructures `{ org }` from `useOrg()` but context provides `currentOrg` — component will crash (F-23 from prior review STILL PRESENT) |
| B9B-02 | **HIGH** | Bug | `OrgContext.tsx` | `refreshOrgs` callback depends on `currentOrg` → infinite re-render loop (F-24 from prior review STILL PRESENT) |
| B9B-03 | **MEDIUM** | UX | `OnboardingFlow.tsx` | SDK snippet shows `@agentlens/sdk` (npm) but Python section in cloud-setup.md shows `agentlensai` — inconsistent package names |
| B9B-04 | **LOW** | UX | `OnboardingFlow.tsx` | SDK snippet endpoint is `https://cloud.agentlens.dev` but docs use `https://api.agentlens.ai` — which is correct? |
| B9B-05 | **LOW** | UX | `BillingPage.tsx` | No confirmation dialog for upgrade (only for downgrade) — accidental clicks could trigger billing |
| B10-01 | **CRITICAL** | Data Integrity | `export-import.ts` | Import `event` case uses `INSERT INTO events (id, org_id, session_id, type, timestamp, data)` — schema mismatch with cloud events table which has `event_type` and `payload` columns |
| B10-02 | **MEDIUM** | Data Integrity | `export-import.ts` | Export `SELECT * FROM events` includes `org_id` which is stripped by `stripOrgId`, but relies on column name being exactly `org_id` — if tenant-scoped adapter renames it, export breaks silently |
| B10-03 | **MEDIUM** | Logic | `migrate.ts` CLI | `uploadBatch` sends NDJSON to `/v1/import` but server routes use `/api/` prefix — endpoint mismatch |
| B10-04 | **MEDIUM** | Logic | `migrate.ts` CLI | `migrateDown` calls `/v1/export` — same `/v1/` vs `/api/` prefix mismatch |
| B10-05 | **LOW** | Code Quality | `migrate.ts` | `require('node:fs')` inside `saveState` function while `import` is used at top — mixing module systems |
| B11-01 | **MEDIUM** | Docs | `cloud-setup.md` | Python init example uses `cloud=True` correctly but doesn't mention `AGENTLENS_API_KEY` env var alternative |
| B11-02 | **MEDIUM** | Docs | `cloud-migration.md` | States "Cloud mode requires `agentlensai >= 0.11.0`" — version should be verified against actual `pyproject.toml` |
| B11-03 | **LOW** | Docs | `cloud-api-reference.md` | API key format shown as `al_xxxx...` but code uses `als_cloud_...` prefix — inconsistency |
| B11-04 | **LOW** | Docs | `cloud-setup.md` | CLI commands use `@agentlensai/cli` package name but no verification this package exists |
| QA-V1 | **✅ FIXED** | Security | `jwt.ts` | `crypto.timingSafeEqual` now used for JWT signature verification (F-04 resolved) |
| QA-V2 | **✅ FIXED** | Security | `tokens.ts` | `crypto.timingSafeEqual` now used for token hash verification (F-05 resolved) |
| QA-V3 | **✅ FIXED** | Security | `postgres-adapter.ts` | `pgDateTrunc` now uses `ALLOWED_GRANULARITY` whitelist — SQL injection via granularity is fixed (F-01 resolved) |
| QA-V4 | **✅ FIXED** | Data Integrity | `batch-writer.ts` | INSERT now uses correct columns: `event_type`, `severity`, `payload`, `prev_hash`, `hash` — matches schema (F-03/F-09 resolved) |
| QA-V5 | **✅ FIXED** | Data Integrity | `batch-writer.ts` | `ON CONFLICT (id, timestamp)` now matches partitioned PK (F-33 resolved) |

---

## Detailed Findings

### B8A — Python SDK Cloud Mode

**Overall assessment:** Well-designed. The `init()` function properly supports `cloud=True` with backward compat. Retry logic in `client.py` correctly handles 401 (no retry), 402 (raise for local buffering), 429 (retry with Retry-After), 503 (retry with backoff). Exception hierarchy is clean.

#### B8A-01 — MEDIUM: Local Event Buffer Never Replayed

**File:** `packages/python-sdk/src/agentlensai/_sender.py`, lines ~155-170  
**Description:** When `QuotaExceededError` is caught, events are buffered to `$AGENTLENS_BUFFER_DIR` as JSON files. However, there's no mechanism to replay these buffered events when quota is replenished — the files accumulate indefinitely.

**Fix:** Add a `replay_buffered()` function and call it periodically (e.g., on successful sends) or on next `init()`.

#### B8A-02 — LOW: Cloud Mode Without API Key

**File:** `packages/python-sdk/src/agentlensai/_init.py`, line ~89  
**Description:** `init(cloud=True)` without an API key will send requests to `https://api.agentlens.ai` without authentication. These will fail with 401, but only silently in the background thread. User gets no upfront warning.

**Fix:** Log a warning or raise if `cloud=True` and no API key is resolved:
```python
if cloud and not resolved_key:
    logger.warning("AgentLens: cloud=True but no API key provided. Set api_key or AGENTLENS_API_KEY.")
```

### B8B — Billing Completion

#### B8B-01 — HIGH: Subscription Gap During Upgrade

**File:** `packages/server/src/cloud/billing/plan-management.ts`, `handleUpgrade()`  
**Description:** The upgrade flow: (1) cancels existing subscription immediately, (2) creates new subscription. If step 2 fails (Stripe outage, network error), the org is left with no active subscription but the DB still shows the old plan (since it's updated after `createSubscription`). However, the old subscription is already cancelled.

**Fix:** Use Stripe's subscription update/proration API (`stripe.subscriptions.update()`) instead of cancel+recreate. This is atomic.

#### B8B-02 — HIGH: Invoice Schema Mismatch (Repeat of F-08)

**File:** `packages/server/src/cloud/billing/invoice-service.ts`, line ~88  
**Description:** The `syncInvoiceFromWebhook` INSERT references `billing_interval` and `line_items` columns. This was flagged in the prior review as F-08 and **appears still unfixed** — no migration adding these columns was found.

**Fix:** Add migration `007_invoice_columns.sql` with:
```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_interval TEXT DEFAULT 'monthly';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB DEFAULT '[]';
```

### B9A — Retention

#### B9A-01 — HIGH: Unbatched DELETE on Large Tables

**File:** `packages/server/src/cloud/retention/retention-job.ts`, `purgeExpiredData()`  
**Description:** `DELETE FROM ${table} WHERE org_id = $1 AND ${timestampCol} < $2` with no LIMIT. For orgs with millions of expired events, this creates a long-running transaction that can lock the table, spike IOPS, and cause replication lag.

**Fix:** Batch the delete:
```sql
DELETE FROM events WHERE ctid IN (
  SELECT ctid FROM events WHERE org_id = $1 AND timestamp < $2 LIMIT 10000
)
```
Loop until 0 rows affected.

#### B9A-02 — MEDIUM: Wrong Table Name `organizations` vs `orgs`

**File:** `packages/server/src/cloud/retention/retention-job.ts`, line ~155; `partition-management.ts`, line ~164  
**Description:** Both files query `FROM organizations` but the cloud migration schema creates the table as `orgs` (see `001_cloud_tables.sql`). These queries will fail with "relation 'organizations' does not exist".

**Fix:** Change `organizations` → `orgs` in both files.

### B9B — Dashboard Pages

#### B9B-01 — HIGH: DlqDashboard Still Uses Wrong Context Property

**File:** `packages/dashboard/src/cloud/DlqDashboard.tsx`, line 24  
**Description:** `const { org } = useOrg()` — the `OrgContextValue` interface exposes `currentOrg`, not `org`. This was flagged as F-23 in the prior review and **is still unfixed**. The component will crash with `TypeError: Cannot read properties of undefined (reading 'id')`.

**Fix:** `const { currentOrg: org } = useOrg();`

#### B9B-02 — HIGH: OrgContext Infinite Re-render Loop Still Present

**File:** `packages/dashboard/src/cloud/OrgContext.tsx`, lines 46-60  
**Description:** `refreshOrgs` has `currentOrg` in its dependency array. When `refreshOrgs` calls `setCurrentOrg(list[0])`, it changes `currentOrg`, which recreates `refreshOrgs`, which triggers the `useEffect` on line 63 that calls `refreshOrgs`. This was F-24 in the prior review and **is still unfixed**.

**Fix:**
```tsx
const refreshOrgs = useCallback(async () => {
  const list = await getMyOrgs();
  setOrgs(list);
  setCurrentOrg(prev => prev ?? list[0] ?? null);
}, []); // Remove currentOrg from deps
```

### B10 — Migration

#### B10-01 — CRITICAL: Import Uses Wrong Column Names for Events

**File:** `packages/server/src/cloud/migration/export-import.ts`, line ~333  
**Description:** The import `event` case inserts into:
```sql
INSERT INTO events (id, org_id, session_id, type, timestamp, data)
```
But the cloud events table (after B1-B7 fixes) uses `event_type` and `payload` columns, not `type` and `data`. This INSERT will fail at runtime for any event import.

**Fix:** Change to match the actual schema:
```sql
INSERT INTO events (id, org_id, session_id, event_type, timestamp, payload)
```

#### B10-03 — MEDIUM: CLI Uses `/v1/` Endpoint Prefix

**File:** `packages/cli/src/commands/migrate.ts`, lines ~213, ~233  
**Description:** The CLI calls `/v1/import` and `/v1/export` but the server routes consistently use `/api/` prefix. These endpoints don't exist.

**Fix:** Change to `/api/import` and `/api/export`, or add `/v1/` aliases in the server routing.

### B11-B12 — Documentation

**Overall assessment:** Documentation is comprehensive and well-structured. The cloud-setup guide provides a clear 5-minute path. Migration guide has a nice "what changes / what stays the same" table. API reference is detailed with request/response examples.

#### B11-03 — LOW: API Key Prefix Inconsistency

**File:** `docs/api/cloud-api-reference.md`  
**Description:** Table shows API key format as `Bearer al_xxxx...` but the actual code (cloud-setup.md, SDK) uses `als_cloud_...`. The `al_` prefix is incorrect.

---

## Earlier QA Fixes Verification (F-01 through F-05)

### ✅ F-01 (SQL Injection in Analytics) — FIXED
`postgres-adapter.ts` line 194: `pgDateTrunc` now uses `ALLOWED_GRANULARITY` whitelist map. Invalid granularity throws `Error`. No string interpolation of user input.

### ✅ F-03/F-09 (Batch Writer Schema Mismatch) — FIXED
`batch-writer.ts` line 290: INSERT now correctly uses `(id, org_id, session_id, agent_id, event_type, severity, timestamp, payload, prev_hash, hash)` — matching the migration schema.

### ✅ F-04 (JWT Timing-Safe Comparison) — FIXED
`jwt.ts` line 63: Uses `timingSafeEqual(sigBuf, expectedBuf)` with proper `Buffer.from(signature, 'base64url')` conversion and length check.

### ✅ F-05 (Token Hash Timing-Safe Comparison) — FIXED
`tokens.ts` line 30: Uses `timingSafeEqual(computed, stored)` with proper `Buffer.from(hash, 'hex')` conversion and length check.

### ⚠️ F-33 (ON CONFLICT with Partitioned PK) — FIXED
`batch-writer.ts` line 293: Now uses `ON CONFLICT (id, timestamp) DO NOTHING` — matching the partitioned PK.

### ❌ F-08 (Invoice Schema Mismatch) — NOT FIXED
`invoice-service.ts` still references `billing_interval` and `line_items` columns. No migration adding these columns was found. Flagged as B8B-02 above.

### ❌ F-23 (DlqDashboard Wrong Context) — NOT FIXED
Still uses `{ org }` instead of `{ currentOrg }`. Flagged as B9B-01 above.

### ❌ F-24 (OrgContext Infinite Loop) — NOT FIXED
`refreshOrgs` still has `currentOrg` in dependency array. Flagged as B9B-02 above.

---

## Risk Assessment

### Deployment Blockers (CRITICAL)
- **B10-01**: Import uses wrong column names (`type`/`data` vs `event_type`/`payload`) — all event imports will fail

### Will Fail at Runtime
- **B9A-02/B9A-03**: `organizations` table doesn't exist (should be `orgs`) — retention job will crash
- **B9B-01**: DlqDashboard crashes on render (wrong destructure)
- **B9B-02**: OrgContext infinite re-render loop on mount
- **B10-03/B10-04**: CLI calls non-existent `/v1/` endpoints
- **B8B-02**: Invoice webhook sync fails on missing columns

### Data Integrity Risks
- **B8B-01**: Subscription gap during upgrade if Stripe call fails
- **B9A-01**: Unbatched DELETE can lock tables for large orgs

### Total: 1 CRITICAL, 5 HIGH, 11 MEDIUM, 8 LOW + 5 earlier fixes verified (3 still unfixed)

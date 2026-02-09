# Phase 6 — Cloud Code Review (Batches 1–7)

**Reviewer:** QA Subagent  
**Date:** 2026-02-09  
**Scope:** `packages/server/src/cloud/` and `packages/dashboard/src/cloud/`

---

## Summary Table

| ID | Severity | Area | File | Description |
|----|----------|------|------|-------------|
| F-01 | **CRITICAL** | Security | `postgres-adapter.ts` | SQL injection via string interpolation of `granularity` in analytics queries |
| F-02 | **CRITICAL** | Security | `partition-maintenance.ts` | SQL injection via unparameterized table/partition names |
| F-03 | **CRITICAL** | Security | `batch-writer.ts` | SQL injection — INSERT uses column name `type` instead of `event_type`; also `data` vs `payload` mismatch |
| F-04 | **CRITICAL** | Security | `jwt.ts` | JWT signature comparison not timing-safe |
| F-05 | **CRITICAL** | Security | `tokens.ts` | Token verification not timing-safe (hashToken comparison) |
| F-06 | **HIGH** | Security | `api-key-middleware.ts` | Leaks API key prefix in error messages (info disclosure) |
| F-07 | **HIGH** | Security | `billing-service.ts` | Stripe webhook signature not verified (mock `constructWebhookEvent` parses raw JSON) |
| F-08 | **HIGH** | Security | `invoice-service.ts` | `billing_interval` and `line_items` columns referenced but not in migration schema |
| F-09 | **HIGH** | Architecture | `batch-writer.ts` | Events INSERT schema mismatch — columns `type`, `data`, `hash` don't match migration columns `event_type`, `payload`, `hash` |
| F-10 | **HIGH** | Architecture | `005_partitioning.sql` | Drops events table with CASCADE, destroying FK relationships and data; non-idempotent with existing data |
| F-11 | **HIGH** | Architecture | `005_partitioning.sql` | Partitioned events table loses `org_id` FK to `orgs`, loses `agent_id` column from PK |
| F-12 | **HIGH** | Architecture | `usage-routes.ts` | Queries `api_call_count`, `storage_bytes`, `period_start` columns that don't exist in `usage_records` table |
| F-13 | **HIGH** | Data Integrity | `batch-writer.ts` | Hash chain stored in `event.data` object, not in `events.hash` column properly; `prev_hash` never written |
| F-14 | **HIGH** | Data Integrity | `usage-metering.ts` | Usage accumulator stores monthly data at `YYYY-MM-01T00:00:00Z` but batch-writer stores at actual hour — double counting possible |
| F-15 | **HIGH** | Security | `005_partitioning.sql` | `usage_records` PK includes `api_key_id` but api_key_id can be NULL — NULL in composite PK is problematic |
| F-16 | **HIGH** | Architecture | `org-service.ts` | `listUserOrgs` queries across orgs (joins `orgs` with `org_members`), but both tables have RLS requiring `app.current_org` — query will fail without bypassing RLS |
| F-17 | **HIGH** | Architecture | `auth-service.ts` | All auth queries (user lookup, org creation) hit RLS-protected tables without setting `app.current_org` — will fail in Postgres |
| F-18 | **MEDIUM** | Security | `brute-force.ts` | In-memory store — lost on restart, no shared state across instances |
| F-19 | **MEDIUM** | Code Quality | `api-keys.ts:revoke` | Uses `(result as any).rowCount` — type assertion |
| F-20 | **MEDIUM** | Code Quality | Multiple files | Extensive use of `(result.rows as any[])` throughout billing, auth, org services |
| F-21 | **MEDIUM** | Architecture | `sqlite-adapter.ts` | `getTokenUsage` returns all zeros — breaks feature parity with Postgres adapter |
| F-22 | **MEDIUM** | Architecture | `sqlite-adapter.ts` | `getHealthAnalytics` returns empty — breaks feature parity |
| F-23 | **MEDIUM** | Dashboard | `DlqDashboard.tsx` | Uses `useOrg().org` but `OrgContext` provides `currentOrg`, not `org` — will crash at runtime |
| F-24 | **MEDIUM** | Dashboard | `OrgContext.tsx` | `refreshOrgs` depends on `currentOrg` in useCallback deps — causes infinite re-render loop |
| F-25 | **MEDIUM** | Code Quality | `rate-limiter.ts` | Redis sliding window adds entries BEFORE checking count — allows exceeding limit by batch size on first excess request |
| F-26 | **LOW** | Code Quality | `org-routes.ts` | `action: 'org.created' as any` — unlisted audit action type-casted |
| F-27 | **LOW** | Code Quality | `partition-maintenance.ts` | `createMonthlyPartition` uses string interpolation for SQL table names — should use format-style escaping |
| F-28 | **LOW** | Data Integrity | `006_pgvector.sql` | Hardcoded `vector(1536)` dimension — won't work with other embedding models |
| F-29 | **LOW** | Dashboard | `TeamManagement.tsx` | Role change dropdown allows any user to see all role options including `owner` — no client-side gating by actor role |
| F-30 | **LOW** | Code Quality | `billing-service.ts` | `handleInvoicePaid` — org lookup by `stripe_customer_id` bypasses RLS (no tenant context set) |
| F-31 | **HIGH** | Security | `003_rls_policies.sql` | `users` table has NO RLS — any query can read all users' data including password hashes |
| F-32 | **HIGH** | Security | `_email_tokens` table | No RLS policy — tokens accessible cross-tenant |
| F-33 | **MEDIUM** | Architecture | `batch-writer.ts` | `ON CONFLICT (id) DO NOTHING` but partitioned events PK is `(id, timestamp)` — conflict detection won't work |

---

## Detailed Findings

### F-01 — CRITICAL: SQL Injection in Analytics Queries

**File:** `packages/server/src/cloud/storage/postgres-adapter.ts`, lines ~210, ~260, ~300, ~340  
**Description:** The `granularity` parameter is interpolated directly into SQL via template literal:
```ts
const trunc = pgDateTrunc(query.granularity);
// ...
`SELECT date_trunc('${trunc}', timestamp) AS bucket, ...`
```
`pgDateTrunc()` just returns the input string unchanged. If an attacker controls the `granularity` field (e.g., via API query param), they can inject SQL: `hour'); DROP TABLE events; --`

**Fix:** Use a whitelist validation:
```ts
function pgDateTrunc(g: string): string {
  const ALLOWED = { hour: 'hour', day: 'day', week: 'week' };
  if (!(g in ALLOWED)) throw new Error(`Invalid granularity: ${g}`);
  return ALLOWED[g as keyof typeof ALLOWED];
}
```

### F-02 — CRITICAL: SQL Injection in Partition Maintenance

**File:** `packages/server/src/cloud/partition-maintenance.ts`, lines ~30, ~75  
**Description:** Table and partition names are interpolated directly into SQL:
```ts
await pool.query(
  `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF ${table} ...`
);
// ...
await pool.query(`DROP TABLE IF EXISTS ${row.child_name}`);
```
While these values come from internal constants, the `child_name` comes from a database query result. If a partition name is crafted maliciously (e.g., via direct DB access), this becomes exploitable.

**Fix:** Use `format()` equivalent or at minimum validate names against `^[a-z_0-9]+$`.

### F-03 — CRITICAL: Schema Mismatch in Batch Writer INSERT

**File:** `packages/server/src/cloud/ingestion/batch-writer.ts`, lines ~165–175  
**Description:** The INSERT statement uses columns that don't match the migration schema:
```sql
INSERT INTO events (id, org_id, session_id, type, timestamp, data, hash)
```
But the events table has columns `event_type` (not `type`), `payload` (not `data`), plus required columns `agent_id`, `severity` that aren't provided. This INSERT will fail at runtime.

**Fix:** Match column names to the migration schema and provide all required columns.

### F-04 — CRITICAL: JWT Signature Not Timing-Safe

**File:** `packages/server/src/cloud/auth/jwt.ts`, line ~50  
**Description:**
```ts
if (signature !== expectedSig) return null;
```
String `!==` comparison is not constant-time. Allows timing attacks to forge JWT signatures byte-by-byte.

**Fix:** Use `timingSafeEqual`:
```ts
import { timingSafeEqual } from 'node:crypto';
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;
```

### F-05 — CRITICAL: Token Hash Comparison Not Timing-Safe

**File:** `packages/server/src/cloud/auth/tokens.ts`, line ~20  
**Description:**
```ts
export function verifyToken(token: string, storedHash: string): boolean {
  return hashToken(token) === storedHash;
}
```
Same timing attack issue. However, since the comparison is between two SHA-256 hashes (not the raw token), the practical risk is lower but still technically exploitable.

**Fix:** Use `timingSafeEqual`.

### F-06 — HIGH: API Key Prefix Leaked in Error Messages

**File:** `packages/server/src/cloud/auth/api-key-middleware.ts`  
**Description:** Error messages include the key prefix:
```ts
throw new ApiKeyAuthError(401, `API key revoked (prefix: ${prefix})`);
throw new ApiKeyAuthError(401, `Invalid API key (prefix: ${prefix})`);
```
This confirms to attackers which prefixes are valid/revoked, aiding enumeration.

**Fix:** Use generic error messages: `"Invalid or revoked API key"`.

### F-07 — HIGH: Stripe Webhook Signature Not Verified

**File:** `packages/server/src/cloud/billing/stripe-client.ts`, line ~140  
**Description:** The `MockStripeClient.constructWebhookEvent` ignores the signature entirely:
```ts
constructWebhookEvent(payload: string, _signature: string): StripeWebhookEvent {
  return JSON.parse(payload) as StripeWebhookEvent;
}
```
Since `createStripeClient()` always returns `MockStripeClient` even when `STRIPE_SECRET_KEY` is set (see comment "For now, always return mock"), webhook signature verification is **never performed** in any environment.

**Fix:** Implement the real Stripe client with `stripe.webhooks.constructEvent()` when a secret key is provided.

### F-08 — HIGH: Invoice Table Schema Mismatch

**File:** `packages/server/src/cloud/billing/invoice-service.ts`, line ~88  
**Description:** The `syncInvoiceFromWebhook` INSERT references columns `billing_interval` and `line_items` that don't exist in the `invoices` table migration (001_cloud_tables.sql). This INSERT will fail.

**Fix:** Add `billing_interval TEXT` and `line_items JSONB` columns to the invoices migration, or create a new migration.

### F-09 — HIGH: Batch Writer Column Name Mismatch

**File:** `packages/server/src/cloud/ingestion/batch-writer.ts`  
**Description:** Duplicate of F-03 context. The INSERT uses `type` and `data` but the migration defines `event_type` and `payload`. Also missing required columns `agent_id` and `severity`.

### F-10 — HIGH: Partitioning Migration Drops Tables With Data

**File:** `packages/server/src/cloud/migrations/005_partitioning.sql`  
**Description:** `DROP TABLE IF EXISTS events CASCADE` destroys all existing data and FK references. If migrations run in order on a system that already has data from migration 002, all events are lost. The `CASCADE` also drops dependent objects.

**Fix:** Use `pg_dump` / data migration approach, or only apply partitioning on fresh installs.

### F-11 — HIGH: Partitioned Events Table Loses FK and Columns

**File:** `packages/server/src/cloud/migrations/005_partitioning.sql`  
**Description:** The recreated partitioned `events` table has PK `(id, timestamp)` but the original had PK `(id)` with `REFERENCES orgs(id)` on `org_id`. Partitioned tables in Postgres cannot have FK references to non-partitioned tables. The org_id FK constraint is silently dropped.

### F-12 — HIGH: Usage Routes Query Non-Existent Columns

**File:** `packages/server/src/cloud/routes/usage-routes.ts`  
**Description:** Queries `api_call_count`, `storage_bytes`, `period_start` from `usage_records`, but the table only has columns `org_id`, `hour`, `event_count`, `api_key_id`. These queries will fail at runtime.

**Fix:** Either add these columns to usage_records or rewrite queries to use only existing columns.

### F-13 — HIGH: Hash Chain Not Properly Persisted

**File:** `packages/server/src/cloud/ingestion/batch-writer.ts`  
**Description:** Hash is computed and stored in `event.data.hash`, then written to the `hash` column. But `prev_hash` is never written to the database — the INSERT doesn't include a `prev_hash` column. This means the tamper-detection hash chain cannot be verified from the database.

### F-14 — HIGH: Usage Double-Counting Risk

**File:** `packages/server/src/cloud/billing/usage-metering.ts` + `batch-writer.ts`  
**Description:** The `BatchWriter.batchInsert` increments usage_records at the actual hour timestamp. The `UsageAccumulator.recordEvents` also writes to usage_records at the month-start timestamp. If both run for the same events, usage is counted twice.

**Fix:** Choose one path for usage recording. Either the batch writer owns it, or the accumulator does, but not both.

### F-15 — HIGH: NULL in Composite Primary Key

**File:** `packages/server/src/cloud/migrations/005_partitioning.sql`  
**Description:** `usage_records` PK is `(org_id, hour, api_key_id)` but `api_key_id` can be NULL. In Postgres, NULL values in PK columns are technically allowed but violate relational model principles and can cause unexpected UPSERT behavior — two rows with `api_key_id = NULL` won't conflict.

**Fix:** Use a sentinel UUID or separate the NULL case.

### F-16 — HIGH: Cross-Org Queries Blocked by RLS

**File:** `packages/server/src/cloud/org-service.ts`  
**Description:** `listUserOrgs` joins `orgs` and `org_members` without setting `app.current_org`. Both tables have RLS requiring `org_id = current_setting('app.current_org')`. This query returns 0 rows unless RLS is bypassed.

Similarly, all methods in OrgService query org_members, org_invitations etc. without tenant context. These are inherently cross-tenant operations (a user can be in multiple orgs).

**Fix:** These queries need to run as a superuser/admin role that bypasses RLS, or use `adminQuery` from tenant-pool. The `users`, `org_members`, `org_invitations` tables may need different RLS policies (e.g., allowing access when `user_id = current_setting('app.current_user')`).

### F-17 — HIGH: Auth Service Queries Hit RLS Without Context

**File:** `packages/server/src/cloud/auth/auth-service.ts`  
**Description:** All user-related queries (`findUserByEmail`, `findUserByOAuth`, etc.) and org creation queries run against RLS-protected tables without calling `SET LOCAL app.current_org`. The `users` table doesn't have RLS (by design), but `org_members`, `orgs`, `org_invitations` do. Creating a default org, checking memberships, etc. will fail.

**Fix:** Auth operations that touch tenant-scoped tables must either bypass RLS or use `withTenantTransaction`.

### F-23 — MEDIUM: DlqDashboard Uses Wrong Context Property

**File:** `packages/dashboard/src/cloud/DlqDashboard.tsx`, line ~15  
**Description:** Uses `const { org } = useOrg()` but `OrgContextValue` provides `currentOrg`, not `org`. This will be `undefined` and the component will show "Select an organization" permanently.

**Fix:** Change to `const { currentOrg: org } = useOrg()`.

### F-24 — MEDIUM: OrgContext Infinite Re-render

**File:** `packages/dashboard/src/cloud/OrgContext.tsx`  
**Description:** `refreshOrgs` depends on `currentOrg` in its `useCallback` deps. But `refreshOrgs` calls `setCurrentOrg`, which changes `currentOrg`, which recreates `refreshOrgs`, which triggers the `useEffect` that calls `refreshOrgs`, creating an infinite loop.

**Fix:** Remove `currentOrg` from the dependency array, or use a ref for the "first load" check:
```ts
const refreshOrgs = useCallback(async () => {
  const list = await getMyOrgs();
  setOrgs(list);
  setCurrentOrg(prev => prev ?? list[0] ?? null);
}, []); // no currentOrg dependency
```

### F-25 — MEDIUM: Rate Limiter Allows Overshoot

**File:** `packages/server/src/cloud/ingestion/rate-limiter.ts`  
**Description:** The Redis sliding window implementation adds entries first, then checks the count. This means a batch of 100 events will be added even if the limit is already at 99/100. The check happens after the fact.

**Fix:** Check count before adding, or use a Lua script for atomic check-and-add.

### F-31 — HIGH: Users Table Has No RLS

**File:** `packages/server/src/cloud/migrations/003_rls_policies.sql`  
**Description:** Comment says "users: no RLS (cross-org resource, accessed via org_members join)" but the `users` table contains `password_hash` and `email`. Any authenticated user with DB access can query all users' password hashes.

**Fix:** Either add RLS to users (e.g., `user_id = current_setting('app.current_user')` or via org_members join), or at minimum ensure the application never selects `password_hash` except in auth flows. Consider a DB view that excludes sensitive columns.

### F-32 — HIGH: _email_tokens Has No RLS

**File:** `packages/server/src/cloud/migrations/004_auth_tokens.sql`  
**Description:** The `_email_tokens` table has no RLS policy. Any query can read all email verification and password reset token hashes. Combined with F-05 (non-timing-safe comparison), this enables token enumeration.

**Fix:** Add RLS or ensure the table is only accessed through the auth service with admin privileges.

### F-33 — MEDIUM: ON CONFLICT Won't Work With Partitioned PK

**File:** `packages/server/src/cloud/ingestion/batch-writer.ts`  
**Description:** `ON CONFLICT (id) DO NOTHING` references column `id` only, but the partitioned events table has PK `(id, timestamp)`. In Postgres, `ON CONFLICT` requires specifying the complete unique constraint. This will error with "there is no unique or exclusion constraint matching the ON CONFLICT specification."

**Fix:** Change to `ON CONFLICT (id, timestamp) DO NOTHING` or add a unique index on `id` alone (if feasible with partitioning).

---

## Positive Observations

1. **Tenant pool design is excellent** — `SET LOCAL` within transactions is the correct pattern for PgBouncer compatibility and connection safety.
2. **API key hashing** — scrypt hashing with timing-safe verify in passwords.ts is properly done.
3. **Audit log** — append-only design with `REVOKE UPDATE, DELETE` on the app role is good defense-in-depth.
4. **Brute-force protection** — properly tracks attempts, clears on success, has lockout.
5. **Backpressure** — stream depth monitoring with cached status checks is well designed.
6. **DLQ** — proper retry counting, DLQ with replay capability, expiry.
7. **Test coverage** — comprehensive test files exist for most modules.
8. **Dashboard components** — proper loading/error states, confirmation dialogs, accessibility attributes.

## Risk Assessment

- **Deployment blockers (CRITICAL):** F-01, F-03/F-09, F-04 must be fixed before any production deployment.
- **Will fail at runtime:** F-08, F-12, F-16, F-17, F-23, F-33 — these will cause errors immediately when exercised.
- **Data integrity risks:** F-10, F-13, F-14, F-15 — may cause silent data loss or corruption.
- **Security hardening needed:** F-05, F-06, F-07, F-31, F-32 — exploitable under various conditions.

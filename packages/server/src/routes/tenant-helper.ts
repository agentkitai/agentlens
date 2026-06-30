/**
 * Tenant Helper — unified tenant extraction and store scoping [F6-S1, F6-S2]
 *
 * getTenantId(c)    — extract tenantId from request context (fail-closed)
 * getTenantStore()  — wrap IEventStore with TenantScopedStore
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { IEventStore } from '@agentkitai/agentlens-core';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { PostgresEventStore } from '../db/postgres-store.js';
import { TenantScopedStore } from '../db/tenant-scoped-store.js';

/**
 * Extract tenantId from request context. [F6-S1]
 *
 * Priority: auth.orgId (F2 unified auth) -> apiKey.tenantId (legacy) -> throw 401
 *
 * When AUTH_DISABLED=true, F2's middleware sets orgId='default',
 * so this still returns 'default' without special-casing.
 */
export function getTenantId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any, any, any>,
): string {
  // Reframe (ADR 0002): the data isolation key is the PROJECT id, carried as
  // projectId on the auth context. For API keys projectId == the key's project
  // (its legacy tenant_id), so this is behavior-preserving until project routing
  // lands. Fall back to orgId for any pre-projectId context, then the legacy key.
  const auth = (c as any).get('auth') as { projectId?: string; orgId?: string } | undefined;
  if (auth?.projectId) return auth.projectId;
  if (auth?.orgId) return auth.orgId;

  // Legacy API key context (backward compat)
  const apiKey = c.get('apiKey');
  if (apiKey?.tenantId) return apiKey.tenantId;

  // No auth context — fail closed
  throw new HTTPException(401, { message: 'No tenant context available' });
}

/**
 * The caller's organization id — the grouping/billing tier above projects
 * (ADR 0002). Distinct from getTenantId, which returns the project (isolation key).
 */
export function getOrgId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any, any, any>,
): string {
  const auth = (c as any).get('auth') as { orgId?: string } | undefined;
  return auth?.orgId ?? 'default';
}

/**
 * Wrap an IEventStore so every operation is scoped to an explicit tenantId.
 *
 * For SqliteEventStore or PostgresEventStore: wraps in TenantScopedStore.
 * For other IEventStore impls (tests, mocks): returns as-is.
 *
 * Use this when the tenant comes from somewhere other than the user auth context
 * — e.g. service-to-service internal routes that take tenantId from the body.
 */
export function tenantScopedStore(
  store: IEventStore,
  tenantId: string,
  scope?: { orgId?: string; projectId?: string },
): IEventStore {
  if (store instanceof SqliteEventStore || store instanceof PostgresEventStore) {
    return new TenantScopedStore(store, tenantId, scope);
  }
  // Test mocks / other IEventStore implementations — return as-is
  return store;
}

/**
 * Get a tenant-scoped event store from request context. [F6-S2]
 */
export function getTenantStore(
  store: IEventStore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any, any, any>,
): IEventStore {
  // The project is the isolation key (getTenantId == projectId, ADR 0002). Reads
  // filter by project; org_id is a grouping-only column, so it is NOT passed as a
  // read scope (filtering by org would exclude data stamped under a different
  // org_id). Stamping the real org on writes (grouping rollups) is tracked
  // separately — it needs stamp-without-filter in TenantScopedStore.
  return tenantScopedStore(store, getTenantId(c));
}

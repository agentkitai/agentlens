/**
 * Tenant Helper — unified tenant extraction and store scoping [F6-S1, F6-S2]
 *
 * getTenantId(c)    — extract tenantId from request context (fail-closed)
 * getTenantStore()  — wrap IEventStore with TenantScopedStore
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
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
  c: Context<{ Variables: AuthVariables }>,
): string {
  // F2 unified auth context (preferred)
  const auth = (c as any).get('auth') as { orgId?: string } | undefined;
  if (auth?.orgId) return auth.orgId;

  // Legacy API key context (backward compat)
  const apiKey = c.get('apiKey');
  if (apiKey?.tenantId) return apiKey.tenantId;

  // No auth context — fail closed
  throw new HTTPException(401, { message: 'No tenant context available' });
}

/**
 * Get a tenant-scoped event store from request context. [F6-S2]
 *
 * For SqliteEventStore or PostgresEventStore: wraps in TenantScopedStore.
 * For other IEventStore impls (tests, mocks): returns as-is.
 */
export function getTenantStore(
  store: IEventStore,
  c: Context<{ Variables: AuthVariables }>,
): IEventStore {
  const tenantId = getTenantId(c);

  if (store instanceof SqliteEventStore || store instanceof PostgresEventStore) {
    return new TenantScopedStore(store, tenantId);
  }

  // Test mocks / other IEventStore implementations — return as-is
  return store;
}

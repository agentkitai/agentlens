/**
 * Helper to create a TenantScopedStore from request context.
 *
 * If the store is a SqliteEventStore and the request has an API key
 * with a tenantId, returns a TenantScopedStore. Otherwise returns
 * the store as-is (backward compatibility for tests, etc.).
 */

import type { Context } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { TenantScopedStore } from '../db/tenant-scoped-store.js';

/**
 * Get a tenant-scoped store from the request context.
 *
 * For SqliteEventStore: wraps in TenantScopedStore with the tenant from auth.
 * For other IEventStore impls (tests, mocks): returns as-is.
 */
export function getTenantStore(
  store: IEventStore,
  c: Context<{ Variables: AuthVariables }>,
): IEventStore {
  const apiKeyInfo = c.get('apiKey');
  if (apiKeyInfo?.tenantId && store instanceof SqliteEventStore) {
    return new TenantScopedStore(store, apiKeyInfo.tenantId);
  }
  return store;
}

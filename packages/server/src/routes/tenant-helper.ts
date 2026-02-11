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
import { createLogger } from '../lib/logger.js';

const log = createLogger('TenantHelper');

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

  // If auth provided a tenantId but the store isn't SqliteEventStore,
  // tenant isolation cannot be applied — warn or reject.
  if (apiKeyInfo?.tenantId && !(store instanceof SqliteEventStore)) {
    const isTest = process.env['NODE_ENV'] === 'test' || process.env['VITEST'];
    if (isTest) {
      log.warn(`Store is not SqliteEventStore; tenant isolation skipped for tenant "${apiKeyInfo.tenantId}".`);
    } else {
      throw new Error(
        `Tenant isolation requires SqliteEventStore but got ${store.constructor.name}. ` +
          `Cannot safely scope data for tenant "${apiKeyInfo.tenantId}".`,
      );
    }
  }

  return store;
}

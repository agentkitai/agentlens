/**
 * Shared test helpers for API tests.
 */

import { randomBytes } from 'node:crypto';
import { createApp } from '../index.js';
import { createTestDb, type SqliteDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { hashApiKey } from '../middleware/auth.js';
import { apiKeys } from '../db/schema.sqlite.js';
import type { Hono } from 'hono';

export interface TestContext {
  app: Hono;
  db: SqliteDb;
  store: SqliteEventStore;
  apiKey: string; // raw key for auth header
}

/**
 * Create a test app with an in-memory database and a pre-created API key.
 * Auth is NOT disabled — use the returned apiKey for Bearer auth.
 */
export async function createTestApp(opts?: { authDisabled?: boolean; tenantId?: string }): Promise<TestContext> {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);

  const rawKey = 'als_testkey123456789abcdef0123456789abcdef0123456789abcdef012345';

  // Pre-insert an API key
  db.insert(apiKeys)
    .values({
      id: 'test-key-id',
      keyHash: hashApiKey(rawKey),
      name: 'Test Key',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: opts?.tenantId ?? 'default',
    })
    .run();

  const { SqliteApiKeyLookup } = await import('../db/api-key-lookup.js');
  const apiKeyLookup = new SqliteApiKeyLookup(db);

  const app = await createApp(store, {
    authDisabled: opts?.authDisabled ?? false,
    db,
    apiKeyLookup,
    corsOrigin: '*',
  });

  return { app: app as unknown as Hono, db, store, apiKey: rawKey };
}

/**
 * Create a raw API key in the database and return it.
 * Useful for multi-tenant tests.
 */
export function createApiKey(db: SqliteDb, opts: {
  id?: string;
  tenantId?: string;
  name?: string;
}): string {
  const rawKey = `als_${randomBytes(32).toString('hex')}`;
  db.insert(apiKeys)
    .values({
      id: opts.id ?? `key-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      keyHash: hashApiKey(rawKey),
      name: opts.name ?? 'Test Key',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: opts.tenantId ?? 'default',
    })
    .run();
  return rawKey;
}

/**
 * Make a request with auth header.
 */
export function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

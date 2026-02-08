/**
 * API Key Authentication Middleware (Story 4.2)
 *
 * Validates `Authorization: Bearer als_xxx` header by hashing the key
 * with SHA-256 and looking it up in the apiKeys table.
 *
 * When AUTH_DISABLED=true, authentication is skipped (dev mode).
 */

import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { SqliteDb } from '../db/index.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * API key info attached to the Hono context.
 */
export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  tenantId: string;
}

/**
 * Type augmentation for Hono context variables.
 */
export type AuthVariables = {
  apiKey: ApiKeyInfo;
};

/**
 * SHA-256 hash a raw API key string.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Create the auth middleware.
 *
 * @param db - Drizzle SQLite database instance
 * @param authDisabled - If true, skip authentication (dev mode)
 */
export function authMiddleware(db: SqliteDb, authDisabled: boolean) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Dev mode: skip auth
    if (authDisabled) {
      c.set('apiKey', { id: 'dev', name: 'dev-mode', scopes: ['*'], tenantId: 'default' });
      return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Missing Authorization header', status: 401 }, 401);
    }

    const match = authHeader.match(/^Bearer\s+(als_\w+)$/);
    if (!match) {
      return c.json({ error: 'Invalid Authorization header format. Expected: Bearer als_xxx', status: 401 }, 401);
    }

    const rawKey = match[1]!;
    const keyHash = hashApiKey(rawKey);

    // Look up the key by hash (not revoked)
    const row = db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .get();

    if (!row) {
      return c.json({ error: 'Invalid or revoked API key', status: 401 }, 401);
    }

    // Fire-and-forget lastUsedAt update
    const now = Math.floor(Date.now() / 1000);
    try {
      db.update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, row.id))
        .run();
    } catch {
      // Non-critical — don't fail the request
    }

    const scopes: string[] = (() => {
      try {
        return JSON.parse(row.scopes) as string[];
      } catch {
        return [];
      }
    })();

    c.set('apiKey', {
      id: row.id,
      name: row.name,
      scopes,
      tenantId: row.tenantId,
    });

    return next();
  });
}

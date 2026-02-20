/**
 * API Key Management Endpoints (Story 4.3)
 *
 * POST /api/keys — create a new API key
 * GET  /api/keys — list all keys (no raw key exposed)
 * DELETE /api/keys/:id — revoke (soft delete) a key
 */

import { Hono } from 'hono';
import { getTenantId } from './tenant-helper.js';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import type { SqliteDb } from '../db/index.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq, and, isNotNull, lte } from 'drizzle-orm';
import { hashApiKey, type AuthVariables } from '../middleware/auth.js';
import { createApiKeySchema } from '../schemas/api-keys.js';
import { formatZodErrors } from '../middleware/validation.js';

export function apiKeysRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/keys — create a new API key
  app.post('/', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }
    const parseResult = createApiKeySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', status: 400, details: formatZodErrors(parseResult.error) }, 400);
    }
    const { name, scopes, tenantId: requestedTenantId } = parseResult.data;

    // Enforce tenant isolation: non-dev callers can only create keys for their own tenant
    const callerKey = c.get('apiKey');
    const callerTenantId = getTenantId(c);
    const isDevMode = callerKey?.id === 'dev';

    // In dev mode, allow specifying tenantId; otherwise force caller's tenant
    const resolvedTenantId = isDevMode
      ? (requestedTenantId ?? 'default')
      : callerTenantId;

    const id = ulid();
    const rawKey = `als_${randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const now = Math.floor(Date.now() / 1000);

    db.insert(apiKeys)
      .values({
        id,
        keyHash,
        name: name ?? 'Unnamed Key',
        scopes: JSON.stringify(scopes ?? ['*']),
        createdAt: now,
        tenantId: resolvedTenantId,
      })
      .run();

    return c.json({
      id,
      key: rawKey,
      name: name ?? 'Unnamed Key',
      scopes: scopes ?? ['*'],
      tenantId: resolvedTenantId,
      createdAt: new Date(now * 1000).toISOString(),
    }, 201);
  });

  // GET /api/keys — list keys for caller's tenant only
  app.get('/', (c) => {
    const callerKey = c.get('apiKey');
    const callerTenantId = getTenantId(c);

    const rows = db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, callerTenantId))
      .all();

    const keys = rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: (() => {
        try { return JSON.parse(row.scopes) as string[]; } catch { return []; }
      })(),
      tenantId: row.tenantId,
      createdAt: new Date(row.createdAt * 1000).toISOString(),
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt * 1000).toISOString() : null,
      revokedAt: row.revokedAt ? new Date(row.revokedAt * 1000).toISOString() : null,
    }));

    return c.json({ keys });
  });

  // POST /api/keys/:id/rotate — rotate a key (admin only, SH-6)
  app.post('/:id/rotate', async (c) => {
    const callerKey = c.get('apiKey');
    const callerTenantId = getTenantId(c);

    // Require admin role (dev mode counts as admin)
    const isDevMode = callerKey?.id === 'dev';
    if (!isDevMode) {
      // Look up the caller's key to check role
      const callerRow = db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, callerKey.id))
        .get();
      if (!callerRow || (callerRow.role !== 'admin' && callerRow.role !== 'owner')) {
        return c.json({ error: 'Forbidden: admin role required', status: 403 }, 403);
      }
    }

    const id = c.req.param('id');
    const existing = db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, callerTenantId)))
      .get();

    if (!existing) {
      return c.json({ error: 'API key not found', status: 404 }, 404);
    }

    if (existing.revokedAt) {
      return c.json({ error: 'Cannot rotate a revoked key', status: 409 }, 409);
    }

    const graceHours = parseInt(process.env.KEY_ROTATION_GRACE_HOURS ?? '24', 10);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + graceHours * 3600;

    // Mark old key as rotated with grace period
    db.update(apiKeys)
      .set({ rotatedAt: now, expiresAt })
      .where(eq(apiKeys.id, id))
      .run();

    // Create new key with same name/scopes/tenant/role
    const newId = ulid();
    const rawKey = `als_${randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);

    db.insert(apiKeys)
      .values({
        id: newId,
        keyHash,
        name: existing.name,
        scopes: existing.scopes,
        createdAt: now,
        tenantId: existing.tenantId,
        createdBy: existing.createdBy,
        role: existing.role,
        rateLimit: existing.rateLimit,
      })
      .run();

    return c.json({
      id: newId,
      key: rawKey,
      name: existing.name,
      rotatedFromId: id,
      oldKeyExpiresAt: new Date(expiresAt * 1000).toISOString(),
    }, 201);
  });

  // DELETE /api/keys/:id — revoke a key (tenant-scoped)
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const now = Math.floor(Date.now() / 1000);
    const callerKey = c.get('apiKey');
    const callerTenantId = getTenantId(c);

    // Look up key scoped to caller's tenant
    const existing = db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, callerTenantId)))
      .get();

    if (!existing) {
      return c.json({ error: 'API key not found', status: 404 }, 404);
    }

    if (existing.revokedAt) {
      return c.json({ error: 'API key already revoked', status: 409 }, 409);
    }

    db.update(apiKeys)
      .set({ revokedAt: now })
      .where(eq(apiKeys.id, id))
      .run();

    return c.json({ id, revoked: true });
  });

  return app;
}

/**
 * Cleanup expired rotated API keys (SH-6).
 * Call periodically (e.g. every hour) to remove keys past their grace period.
 */
export function cleanupExpiredRotatedKeys(db: SqliteDb): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.delete(apiKeys)
    .where(and(isNotNull(apiKeys.expiresAt), lte(apiKeys.expiresAt, now)))
    .run();
  return result.changes;
}

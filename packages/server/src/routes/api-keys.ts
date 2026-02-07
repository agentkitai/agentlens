/**
 * API Key Management Endpoints (Story 4.3)
 *
 * POST /api/keys — create a new API key
 * GET  /api/keys — list all keys (no raw key exposed)
 * DELETE /api/keys/:id — revoke (soft delete) a key
 */

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import type { SqliteDb } from '../db/index.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import { hashApiKey, type AuthVariables } from '../middleware/auth.js';

export function apiKeysRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/keys — create a new API key
  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = (body as Record<string, unknown>).name as string | undefined;
    const scopes = (body as Record<string, unknown>).scopes as string[] | undefined;

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
      })
      .run();

    return c.json({
      id,
      key: rawKey,
      name: name ?? 'Unnamed Key',
      scopes: scopes ?? ['*'],
      createdAt: new Date(now * 1000).toISOString(),
    }, 201);
  });

  // GET /api/keys — list all keys
  app.get('/', (c) => {
    const rows = db.select().from(apiKeys).all();

    const keys = rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: (() => {
        try { return JSON.parse(row.scopes) as string[]; } catch { return []; }
      })(),
      createdAt: new Date(row.createdAt * 1000).toISOString(),
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt * 1000).toISOString() : null,
      revokedAt: row.revokedAt ? new Date(row.revokedAt * 1000).toISOString() : null,
    }));

    return c.json({ keys });
  });

  // DELETE /api/keys/:id — revoke a key
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const now = Math.floor(Date.now() / 1000);

    const existing = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
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

/**
 * SH-6: API Key Rotation Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiKeysRoutes, cleanupExpiredRotatedKeys } from '../api-keys.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { apiKeys } from '../../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

function createApp(db: any, authDisabled = false) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, authDisabled));
  app.route('/api/keys', apiKeysRoutes(db));
  return app;
}

function seedApiKey(db: any, opts: { id: string; role?: string; tenantId?: string }) {
  const rawKey = `als_${randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  db.insert(apiKeys).values({
    id: opts.id,
    keyHash,
    name: 'Test Key',
    scopes: JSON.stringify(['*']),
    createdAt: now,
    tenantId: opts.tenantId ?? 'default',
    role: opts.role ?? 'editor',
  }).run();
  return rawKey;
}

describe('API Key Rotation (SH-6)', () => {
  let db: any;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  describe('POST /api/keys/:id/rotate', () => {
    it('rotates a key and returns new key value (dev mode)', async () => {
      const app = createApp(db, true); // dev mode = admin
      const targetKey = seedApiKey(db, { id: 'target-key' });

      const res = await app.request('/api/keys/target-key/rotate', { method: 'POST' });
      expect(res.status).toBe(201);

      const body = await res.json() as any;
      expect(body.key).toMatch(/^als_/);
      expect(body.rotatedFromId).toBe('target-key');
      expect(body.oldKeyExpiresAt).toBeDefined();
      expect(body.id).toBeDefined();
      expect(body.id).not.toBe('target-key');

      // Old key should have rotatedAt and expiresAt set
      const oldRow = db.select().from(apiKeys).where(eq(apiKeys.id, 'target-key')).get();
      expect(oldRow.rotatedAt).toBeDefined();
      expect(oldRow.expiresAt).toBeDefined();
    });

    it('old key works during grace period', async () => {
      const app = createApp(db, false);
      const adminKey = seedApiKey(db, { id: 'admin-key', role: 'admin' });

      // Create a target key
      const targetKey = seedApiKey(db, { id: 'target-key-2' });

      // Rotate it
      const rotateRes = await app.request('/api/keys/target-key-2/rotate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      expect(rotateRes.status).toBe(201);

      // Old key should still work (within grace period)
      const listRes = await app.request('/api/keys', {
        headers: { Authorization: `Bearer ${targetKey}` },
      });
      expect(listRes.status).toBe(200);
    });

    it('old key rejected after grace period', async () => {
      const app = createApp(db, false);
      const targetKey = seedApiKey(db, { id: 'target-key-3' });

      // Manually set expiresAt in the past
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      db.update(apiKeys)
        .set({ rotatedAt: pastTime - 3600, expiresAt: pastTime })
        .where(eq(apiKeys.id, 'target-key-3'))
        .run();

      const res = await app.request('/api/keys', {
        headers: { Authorization: `Bearer ${targetKey}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toContain('rotated');
    });

    it('only admins can rotate keys', async () => {
      const app = createApp(db, false);
      const editorKey = seedApiKey(db, { id: 'editor-key', role: 'editor' });
      seedApiKey(db, { id: 'target-key-4' });

      const res = await app.request('/api/keys/target-key-4/rotate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${editorKey}` },
      });
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.error).toContain('admin');
    });

    it('returns 404 for nonexistent key', async () => {
      const app = createApp(db, true);
      const res = await app.request('/api/keys/nonexistent/rotate', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 409 for revoked key', async () => {
      const app = createApp(db, true);
      seedApiKey(db, { id: 'revoked-key' });
      db.update(apiKeys)
        .set({ revokedAt: Math.floor(Date.now() / 1000) })
        .where(eq(apiKeys.id, 'revoked-key'))
        .run();

      const res = await app.request('/api/keys/revoked-key/rotate', { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  describe('cleanupExpiredRotatedKeys', () => {
    it('removes expired rotated keys', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      seedApiKey(db, { id: 'expired-key' });
      db.update(apiKeys)
        .set({ rotatedAt: pastTime - 7200, expiresAt: pastTime })
        .where(eq(apiKeys.id, 'expired-key'))
        .run();

      // Also seed a non-expired key
      seedApiKey(db, { id: 'active-key' });

      const removed = cleanupExpiredRotatedKeys(db);
      expect(removed).toBe(1);

      // Active key should still exist
      const active = db.select().from(apiKeys).where(eq(apiKeys.id, 'active-key')).get();
      expect(active).toBeDefined();

      // Expired key should be gone
      const expired = db.select().from(apiKeys).where(eq(apiKeys.id, 'expired-key')).get();
      expect(expired).toBeUndefined();
    });

    it('does not remove keys still within grace period', () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      seedApiKey(db, { id: 'grace-key' });
      db.update(apiKeys)
        .set({ rotatedAt: Math.floor(Date.now() / 1000), expiresAt: futureTime })
        .where(eq(apiKeys.id, 'grace-key'))
        .run();

      const removed = cleanupExpiredRotatedKeys(db);
      expect(removed).toBe(0);
    });
  });
});

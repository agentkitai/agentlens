/**
 * Service Token management (#59) — admin-only CRUD for per-tenant service tokens
 * used by AgentGate on /api/internal. Mirrors api-keys.ts; token storage is the
 * dialect-agnostic ServiceTokenStore, the admin role check reads api_keys (sqlite
 * control plane). The raw token is returned exactly once, at mint/rotate.
 *
 *   POST   /api/service-tokens          — mint (admin/owner)
 *   GET    /api/service-tokens          — list for the caller's tenant (no raw)
 *   POST   /api/service-tokens/:id/rotate — rotate with grace overlap (admin)
 *   DELETE /api/service-tokens/:id      — revoke (admin)
 */
import { Hono, type Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { getTenantId } from './tenant-helper.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { hashApiKey, type AuthVariables } from '../middleware/auth.js';
import { ServiceTokenStore } from '../db/service-token-store.js';
import type { AnyDb } from '../db/dialect-db.js';
import type { SqliteDb } from '../db/index.js';

function newRawToken(): string {
  return `agl_svc_${randomBytes(32).toString('hex')}`;
}

/** Caller must be admin/owner (dev mode counts). Mirrors api-keys.ts rotate guard. */
function isAdmin(c: Context<{ Variables: AuthVariables }>, db: SqliteDb): boolean {
  const callerKey = c.get('apiKey');
  if (callerKey?.id === 'dev') return true;
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, callerKey.id)).get();
  return !!row && (row.role === 'admin' || row.role === 'owner');
}

export function serviceTokensRoutes(anyDb: AnyDb, db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new ServiceTokenStore(anyDb);

  app.post('/', async (c) => {
    if (!isAdmin(c, db)) return c.json({ error: 'Forbidden: admin role required' }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' && body.name ? body.name : 'service-token';
    const tenantId = getTenantId(c);
    const id = ulid();
    const raw = newRawToken();
    const now = Math.floor(Date.now() / 1000);
    await store.create({ id, tokenHash: hashApiKey(raw), tenantId, name, createdAt: now, createdBy: c.get('apiKey')?.id ?? null });
    return c.json({ id, token: raw, name, tenantId, createdAt: new Date(now * 1000).toISOString() }, 201);
  });

  app.get('/', async (c) => {
    const rows = await store.listByTenant(getTenantId(c));
    return c.json({
      tokens: rows.map((r) => ({
        id: r.id,
        name: r.name,
        tenantId: r.tenantId,
        createdAt: new Date(r.createdAt * 1000).toISOString(),
        lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt * 1000).toISOString() : null,
        revokedAt: r.revokedAt ? new Date(r.revokedAt * 1000).toISOString() : null,
        expiresAt: r.expiresAt ? new Date(r.expiresAt * 1000).toISOString() : null,
      })),
    });
  });

  app.post('/:id/rotate', async (c) => {
    if (!isAdmin(c, db)) return c.json({ error: 'Forbidden: admin role required' }, 403);
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const existing = await store.get(tenantId, id);
    if (!existing) return c.json({ error: 'Service token not found' }, 404);
    if (existing.revokedAt) return c.json({ error: 'Cannot rotate a revoked token' }, 409);

    const graceHours = parseInt(process.env['KEY_ROTATION_GRACE_HOURS'] ?? '24', 10);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + graceHours * 3600;
    await store.markRotated(tenantId, id, now, expiresAt);

    const newId = ulid();
    const raw = newRawToken();
    await store.create({ id: newId, tokenHash: hashApiKey(raw), tenantId, name: existing.name, createdAt: now, createdBy: existing.createdBy });
    return c.json({ id: newId, token: raw, name: existing.name, rotatedFromId: id, oldTokenExpiresAt: new Date(expiresAt * 1000).toISOString() }, 201);
  });

  app.delete('/:id', async (c) => {
    if (!isAdmin(c, db)) return c.json({ error: 'Forbidden: admin role required' }, 403);
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const existing = await store.get(tenantId, id);
    if (!existing) return c.json({ error: 'Service token not found' }, 404);
    if (existing.revokedAt) return c.json({ error: 'Service token already revoked' }, 409);
    await store.revoke(tenantId, id, Math.floor(Date.now() / 1000));
    return c.json({ id, revoked: true });
  });

  return app;
}

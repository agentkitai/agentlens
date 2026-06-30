/**
 * Service token management (#59) — admin mint/list/rotate/revoke, end-to-end with
 * /api/internal enforcement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { hashApiKey } from '../middleware/auth.js';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';

function makeKey(db: SqliteDb, role: string, tenantId = 'default'): string {
  const raw = `als_${role}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  db.insert(apiKeys)
    .values({
      id: `k-${role}-${Math.random().toString(36).slice(2)}`,
      keyHash: hashApiKey(raw),
      name: role,
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId,
      role,
    })
    .run();
  return raw;
}

describe('Service token management (#59)', () => {
  let app: Hono;
  let db: SqliteDb;
  let admin: string;

  beforeEach(async () => {
    delete process.env['AGENTGATE_SERVICE_TOKEN']; // exercise the DB-token path only
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    admin = makeKey(db, 'owner');
  });

  const mint = (key: string, name = 'gate') =>
    app.request('/api/service-tokens', {
      method: 'POST',
      headers: { ...authHeaders(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

  const spend = (token: string, tenantId: string) =>
    app.request('/api/internal/spend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: ['a1'], tenantId }),
    });

  it('requires admin/owner to mint (editor → 403, owner → 201)', async () => {
    const editor = makeKey(db, 'editor');
    expect((await mint(editor)).status).toBe(403);
    const res = await mint(admin);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; token: string };
    expect(body.token).toMatch(/^agl_svc_/);
  });

  it('a minted token authorizes its tenant on /api/internal but not another', async () => {
    const { token } = (await (await mint(admin)).json()) as { token: string };
    expect((await spend(token, 'default')).status).toBe(200);
    expect((await spend(token, 'tenant-b')).status).toBe(403);
  });

  it('lists tokens without exposing the raw secret', async () => {
    await mint(admin, 'one');
    const res = await app.request('/api/service-tokens', { headers: authHeaders(admin) });
    const body = (await res.json()) as { tokens: Array<Record<string, unknown>> };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]!.name).toBe('one');
    expect(JSON.stringify(body.tokens[0])).not.toContain('agl_svc_');
  });

  it('revoke makes the token stop working on /api/internal', async () => {
    const { id, token } = (await (await mint(admin)).json()) as { id: string; token: string };
    expect((await spend(token, 'default')).status).toBe(200);
    const del = await app.request(`/api/service-tokens/${id}`, { method: 'DELETE', headers: authHeaders(admin) });
    expect(del.status).toBe(200);
    expect((await spend(token, 'default')).status).toBe(401);
  });

  it('rotate mints a new working token while the old stays valid during grace', async () => {
    const { id, token: oldToken } = (await (await mint(admin)).json()) as { id: string; token: string };
    const rot = await app.request(`/api/service-tokens/${id}/rotate`, { method: 'POST', headers: authHeaders(admin) });
    expect(rot.status).toBe(201);
    const { token: newToken } = (await rot.json()) as { token: string };
    expect((await spend(newToken, 'default')).status).toBe(200);
    expect((await spend(oldToken, 'default')).status).toBe(200); // grace overlap
  });
});

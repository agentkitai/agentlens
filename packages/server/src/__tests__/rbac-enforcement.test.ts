/**
 * RBAC Boundary Enforcement Tests [F2-S4]
 *
 * Verifies the permission matrix from architecture doc is correctly
 * enforced end-to-end across all sensitive route groups.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import { signJwt } from '../cloud/auth/jwt.js';
import { hashApiKey } from '../middleware/auth.js';
import { apiKeys } from '../db/schema.sqlite.js';
import type { Role } from '../cloud/auth/rbac.js';

const JWT_SECRET = 'test-jwt-secret';

function makeJwt(role: Role, orgId = 'org-1') {
  return signJwt(
    { sub: `user-${role}`, email: `${role}@test.com`, name: role, orgs: [{ org_id: orgId, role }] },
    JWT_SECRET,
    3600,
  );
}

function jwtHeaders(role: Role): Record<string, string> {
  return {
    Authorization: `Bearer ${makeJwt(role)}`,
    'Content-Type': 'application/json',
  };
}

async function createAppWithJwt() {
  // Set JWT_SECRET in env for unified auth
  const prev = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = JWT_SECRET;
  const ctx = await createTestApp();
  // Also insert keys with different scope levels
  const readOnlyKey = 'als_readonly_' + 'a'.repeat(50);
  ctx.db.insert(apiKeys).values({
    id: 'read-only-key',
    keyHash: hashApiKey(readOnlyKey),
    name: 'Read Only',
    scopes: JSON.stringify(['read']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default',
  }).run();

  const writeKey = 'als_writekey' + 'b'.repeat(50);
  ctx.db.insert(apiKeys).values({
    id: 'write-key',
    keyHash: hashApiKey(writeKey),
    name: 'Write Key',
    scopes: JSON.stringify(['read', 'write']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default',
  }).run();

  const cleanup = () => { process.env['JWT_SECRET'] = prev; };
  return { ...ctx, readOnlyKey, writeKey, cleanup };
}

describe('RBAC Boundary Enforcement [F2-S4]', () => {
  // ── Viewer role (read only) ────────────────────────────

  it('viewer can GET /api/sessions', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/sessions', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('viewer can GET /api/events', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/events', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('viewer can GET /api/agents', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/agents', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('viewer can GET /api/alerts/rules', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/alerts/rules', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('viewer can GET /api/guardrails', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/guardrails', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('viewer gets 403 on POST /api/alerts/rules', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/alerts/rules', {
      method: 'POST',
      headers: jwtHeaders('viewer'),
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.hint).toBeDefined();
    expect(body.current).toBe('viewer');
    cleanup();
  });

  it('viewer gets 403 on POST /api/guardrails', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/guardrails', {
      method: 'POST',
      headers: jwtHeaders('viewer'),
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(403);
    cleanup();
  });

  // ── Member role (read + write, no manage) ──────────────

  it('member can POST /api/alerts/rules', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/alerts/rules', {
      method: 'POST',
      headers: jwtHeaders('member'),
      body: JSON.stringify({ name: 'test-alert', condition: { metric: 'error_rate', operator: 'gt', threshold: 5 }, actions: [{ type: 'log' }] }),
    });
    // Should not be 403 (may be 400 due to validation, that's fine)
    expect(res.status).not.toBe(403);
    cleanup();
  });

  it('member gets 403 on GET /api/keys', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/keys', { headers: jwtHeaders('member') });
    expect(res.status).toBe(403);
    cleanup();
  });

  it('member gets 403 on GET /api/audit', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/audit', { headers: jwtHeaders('member') });
    expect(res.status).toBe(403);
    cleanup();
  });

  // ── Admin role (read + write + manage) ─────────────────

  it('admin can GET /api/keys', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/keys', { headers: jwtHeaders('admin') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('admin can GET /api/audit', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/audit', { headers: jwtHeaders('admin') });
    expect(res.status).toBe(200);
    cleanup();
  });

  it('admin can POST /api/guardrails', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/guardrails', {
      method: 'POST',
      headers: jwtHeaders('admin'),
      body: JSON.stringify({ name: 'test' }),
    });
    // Should not be 403
    expect(res.status).not.toBe(403);
    cleanup();
  });

  // ── Owner role (all access) ────────────────────────────

  it('owner can access everything', async () => {
    const { app, cleanup } = await createAppWithJwt();
    for (const path of ['/api/keys', '/api/audit', '/api/sessions', '/api/guardrails']) {
      const res = await app.request(path, { headers: jwtHeaders('owner') });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
    cleanup();
  });

  // ── API key scope enforcement ──────────────────────────

  it('read-only API key (viewer role) gets 403 on POST', async () => {
    const { app, readOnlyKey, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(readOnlyKey),
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.current).toBe('viewer');
    cleanup();
  });

  it('full-access API key (admin role) can access manage routes', async () => {
    const { app, apiKey, cleanup } = await createAppWithJwt();
    // Default test key has scopes: ['*'] → admin role
    const res = await app.request('/api/keys', { headers: authHeaders(apiKey) });
    expect(res.status).toBe(200);
    cleanup();
  });

  // ── 403 response format ────────────────────────────────

  it('403 responses contain hint, required, current fields', async () => {
    const { app, cleanup } = await createAppWithJwt();
    const res = await app.request('/api/keys', { headers: jwtHeaders('viewer') });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('hint');
    expect(body).toHaveProperty('required');
    expect(body).toHaveProperty('current');
    expect(body.status).toBe(403);
    cleanup();
  });
});

/**
 * F19-S4: Prompt Management route integration tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { promptRoutes } from '../prompts.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function createApp(db: any) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, false));
  app.route('/api/prompts', promptRoutes(db));
  return app;
}

function seedApiKey(db: any, tenantId = 'default', keyId = 'key1'): string {
  const rawKey = `als_testkey${tenantId}${keyId}pad1234567890abcdef`;
  const keyHash = hashApiKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  db.insert(apiKeys).values({
    id: keyId,
    keyHash,
    name: `Test Key ${keyId}`,
    scopes: JSON.stringify(['*']),
    createdAt: now,
    tenantId,
    role: 'editor',
  }).run();
  return rawKey;
}

describe('Prompt Routes (F19-S4)', () => {
  let db: any;
  let app: any;
  let apiKey: string;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    app = createApp(db);
    apiKey = seedApiKey(db);
  });

  const auth = (key?: string) => ({ Authorization: `Bearer ${key ?? apiKey}` });
  const json = (body: unknown, key?: string) => ({
    method: 'POST',
    headers: { ...auth(key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function createTemplate(overrides?: Record<string, unknown>, key?: string) {
    const res = await app.request('/api/prompts', json({
      name: 'Test Prompt',
      content: 'Hello {{name}}',
      category: 'system',
      ...overrides,
    }, key));
    return { res, body: await res.json() };
  }

  // ── POST /api/prompts ──

  describe('POST /api/prompts', () => {
    it('returns 201 for valid template', async () => {
      const { res, body } = await createTemplate();
      expect(res.status).toBe(201);
      expect(body.template).toBeDefined();
      expect(body.template.name).toBe('Test Prompt');
      expect(body.version).toBeDefined();
      expect(body.version.versionNumber).toBe(1);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/api/prompts', json({ content: 'hello' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('name');
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.request('/api/prompts', json({ name: 'Test' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('content');
    });

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', content: 'hello' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/prompts ──

  describe('GET /api/prompts', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/api/prompts', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.templates).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns created templates', async () => {
      await createTemplate({ name: 'Prompt A' });
      await createTemplate({ name: 'Prompt B' });
      const res = await app.request('/api/prompts', { headers: auth() });
      const body = await res.json();
      expect(body.templates).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('filters by category', async () => {
      await createTemplate({ name: 'A', category: 'system' });
      await createTemplate({ name: 'B', category: 'user' });
      const res = await app.request('/api/prompts?category=system', { headers: auth() });
      const body = await res.json();
      expect(body.templates).toHaveLength(1);
      expect(body.templates[0].name).toBe('A');
    });

    it('filters by search', async () => {
      await createTemplate({ name: 'Alpha Prompt' });
      await createTemplate({ name: 'Beta Prompt' });
      const res = await app.request('/api/prompts?search=Alpha', { headers: auth() });
      const body = await res.json();
      expect(body.templates).toHaveLength(1);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) await createTemplate({ name: `P${i}` });
      const res = await app.request('/api/prompts?limit=2&offset=0', { headers: auth() });
      const body = await res.json();
      expect(body.templates).toHaveLength(2);
      expect(body.total).toBe(5);
    });
  });

  // ── GET /api/prompts/:id ──

  describe('GET /api/prompts/:id', () => {
    it('returns template with versions', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(`/api/prompts/${created.template.id}`, { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.template.id).toBe(created.template.id);
      expect(body.versions).toHaveLength(1);
    });

    it('returns 404 for nonexistent template', async () => {
      const res = await app.request('/api/prompts/nonexistent', { headers: auth() });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/prompts/:id/versions ──

  describe('POST /api/prompts/:id/versions', () => {
    it('returns 201 for new version', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/versions`,
        json({ content: 'Updated content', changelog: 'v2 changes' }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.version.versionNumber).toBe(2);
    });

    it('returns 400 when content is missing', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/versions`,
        json({ changelog: 'no content' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent template', async () => {
      const res = await app.request(
        '/api/prompts/nonexistent/versions',
        json({ content: 'hello' }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/prompts/:id/versions/:vid ──

  describe('GET /api/prompts/:id/versions/:vid', () => {
    it('returns specific version', async () => {
      const { body: created } = await createTemplate();
      const vid = created.version.id;
      const res = await app.request(
        `/api/prompts/${created.template.id}/versions/${vid}`,
        { headers: auth() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version.id).toBe(vid);
    });

    it('returns 404 for nonexistent version', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/versions/nonexistent`,
        { headers: auth() },
      );
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/prompts/:id ──

  describe('DELETE /api/prompts/:id', () => {
    it('returns 204 on soft delete', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(`/api/prompts/${created.template.id}`, {
        method: 'DELETE',
        headers: auth(),
      });
      expect(res.status).toBe(204);
    });

    it('template not found after delete', async () => {
      const { body: created } = await createTemplate();
      await app.request(`/api/prompts/${created.template.id}`, {
        method: 'DELETE',
        headers: auth(),
      });
      const res = await app.request(`/api/prompts/${created.template.id}`, { headers: auth() });
      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent template', async () => {
      const res = await app.request('/api/prompts/nonexistent', {
        method: 'DELETE',
        headers: auth(),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/prompts/fingerprints ──

  describe('GET /api/prompts/fingerprints', () => {
    it('returns empty fingerprints initially', async () => {
      const res = await app.request('/api/prompts/fingerprints', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fingerprints).toEqual([]);
    });
  });

  // ── POST /api/prompts/fingerprints/:hash/link ──

  describe('POST /api/prompts/fingerprints/:hash/link', () => {
    it('returns 400 when templateId is missing', async () => {
      const res = await app.request(
        '/api/prompts/fingerprints/somehash/link',
        json({}),
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent fingerprint', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        '/api/prompts/fingerprints/nonexistent/link',
        json({ templateId: created.template.id }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/prompts/:id/diff ──

  describe('GET /api/prompts/:id/diff', () => {
    it('returns diff between two versions', async () => {
      const { body: created } = await createTemplate({ content: 'Line 1\nLine 2' });
      const v1Id = created.version.id;

      const vRes = await app.request(
        `/api/prompts/${created.template.id}/versions`,
        json({ content: 'Line 1\nLine 3' }),
      );
      const v2Id = (await vRes.json()).version.id;

      const res = await app.request(
        `/api/prompts/${created.template.id}/diff?v1=${v1Id}&v2=${v2Id}`,
        { headers: auth() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.diff).toContain('-');
      expect(body.diff).toContain('+');
    });

    it('returns 400 when v1 or v2 missing', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/diff`,
        { headers: auth() },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when version not found', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/diff?v1=nonexistent&v2=nonexistent`,
        { headers: auth() },
      );
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/prompts/:id/analytics ──

  describe('GET /api/prompts/:id/analytics', () => {
    it('returns analytics for template', async () => {
      const { body: created } = await createTemplate();
      const res = await app.request(
        `/api/prompts/${created.template.id}/analytics`,
        { headers: auth() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.analytics).toBeDefined();
    });
  });

  // ── Tenant Isolation ──

  describe('Tenant Isolation', () => {
    it('tenant A cannot see tenant B templates', async () => {
      const keyA = seedApiKey(db, 'tenantA', 'keyA');
      const keyB = seedApiKey(db, 'tenantB', 'keyB');

      // Create template as tenant A
      const { body: created } = await createTemplate({ name: 'Secret' }, keyA);
      expect(created.template).toBeDefined();

      // Tenant B cannot get it
      const res = await app.request(`/api/prompts/${created.template.id}`, {
        headers: auth(keyB),
      });
      expect(res.status).toBe(404);

      // Tenant B list is empty
      const listRes = await app.request('/api/prompts', { headers: auth(keyB) });
      const listBody = await listRes.json();
      expect(listBody.templates).toHaveLength(0);
    });

    it('tenant A cannot delete tenant B templates', async () => {
      const keyA = seedApiKey(db, 'tenantA2', 'keyA2');
      const keyB = seedApiKey(db, 'tenantB2', 'keyB2');

      const { body: created } = await createTemplate({ name: 'Protected' }, keyA);

      const res = await app.request(`/api/prompts/${created.template.id}`, {
        method: 'DELETE',
        headers: auth(keyB),
      });
      expect(res.status).toBe(404);
    });
  });
});

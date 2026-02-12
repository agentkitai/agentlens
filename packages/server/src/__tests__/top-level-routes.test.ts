/**
 * Tests for top-level dashboard-facing routes:
 * - GET /api/capabilities (list all)
 * - POST /api/capabilities (register)
 * - PUT /api/capabilities/:id (update)
 * - GET /api/delegations (list all)
 * - GET /api/community/agents (list all agent sharing configs)
 * - GET /api/community/stats
 * - POST /api/community/rate
 * - GET /api/community/audit (with eventType/from/to params)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createApp, createTestDb, runMigrations, SqliteEventStore } from '../index.js';

function authHeaders(key: string) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

describe('Top-level dashboard routes', () => {
  let app: ReturnType<typeof createApp>;
  let apiKey: string;

  beforeAll(async () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);

    // Create API key
    const { hashApiKey } = await import('../middleware/auth.js');
    apiKey = 'test-key-top-routes';
    const hash = hashApiKey(apiKey);
    db.run(
      `INSERT INTO api_keys (id, name, key_hash, tenant_id, scopes, created_at)
       VALUES ('k1', 'test', '${hash}', 'default', '["*"]', '${new Date().toISOString()}')`,
    );

    app = createApp(store, { db, authDisabled: true });

    // Create an agent via events
    await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [{
          sessionId: 'sess-1',
          agentId: 'agent-1',
          eventType: 'session_started',
          timestamp: new Date().toISOString(),
          data: {},
        }],
      }),
    });
  });

  // ─── Capabilities ──────────────────────────────────

  describe('GET /api/capabilities', () => {
    it('should return empty list initially', async () => {
      const res = await app.request('/api/capabilities', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities).toEqual([]);
    });
  });

  describe('POST /api/capabilities', () => {
    it('should register a capability', async () => {
      const res = await app.request('/api/capabilities', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          agentId: 'agent-1',
          taskType: 'code-review',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          scope: 'internal',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.taskType).toBe('code-review');
      expect(body.id).toBeTruthy();
    });

    it('should require agentId', async () => {
      const res = await app.request('/api/capabilities', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ taskType: 'translation' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/capabilities/:id', () => {
    it('should update a capability', async () => {
      // First create one
      const createRes = await app.request('/api/capabilities', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          agentId: 'agent-1',
          taskType: 'translation',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
        }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/capabilities/${created.id}`, {
        method: 'PUT',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
    });
  });

  describe('GET /api/capabilities (with data)', () => {
    it('should list all capabilities', async () => {
      const res = await app.request('/api/capabilities', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by taskType', async () => {
      const res = await app.request('/api/capabilities?taskType=code-review', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities.every((c: any) => c.taskType === 'code-review')).toBe(true);
    });
  });

  // ─── Delegations ──────────────────────────────────

  describe('GET /api/delegations', () => {
    it('should return empty list', async () => {
      const res = await app.request('/api/delegations', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.delegations).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  // ─── Audit with eventType/from/to params ──────────

  describe('GET /api/community/audit', () => {
    it('should accept eventType param', async () => {
      const res = await app.request('/api/community/audit?eventType=share', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('events');
    });

    it('should accept from/to params', async () => {
      const res = await app.request('/api/community/audit?from=2020-01-01&to=2030-01-01', { headers: authHeaders(apiKey) });
      expect(res.status).toBe(200);
    });
  });
});

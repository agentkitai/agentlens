/**
 * F7-S2.2: Sessions route integration tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sessionsRoutes } from '../sessions.js';
import { eventsRoutes } from '../events.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function createApp(db: any, store: SqliteEventStore, authDisabled = false) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, authDisabled));
  app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
  app.route('/api/sessions', sessionsRoutes(store));
  return app;
}

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  const keyHash = hashApiKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  db.insert(apiKeys).values({
    id: 'key-1',
    keyHash,
    name: 'Test Key',
    scopes: JSON.stringify(['*']),
    createdAt: now,
    tenantId: 'default',
    role: 'editor',
  }).run();
  return rawKey;
}

describe('Sessions Routes (F7-S2.2)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);
  });

  const auth = () => ({ Authorization: `Bearer ${apiKey}` });

  async function ingestSessionEvents(sessionId: string, agentId = 'agent-1') {
    await app.request('/api/events', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            sessionId,
            agentId,
            eventType: 'session_started',
            payload: {},
          },
          {
            sessionId,
            agentId,
            eventType: 'tool_call',
            payload: { toolName: 'search', callId: 'call-1', arguments: {} },
          },
        ],
      }),
    });
  }

  // ── GET /api/sessions ──

  describe('GET /api/sessions', () => {
    it('returns session list after ingesting events', async () => {
      await ingestSessionEvents('sess-1');
      await ingestSessionEvents('sess-2');

      const res = await app.request('/api/sessions', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions.length).toBeGreaterThanOrEqual(2);
      expect(body.total).toBeGreaterThanOrEqual(2);
    });

    it('filters by agentId', async () => {
      await ingestSessionEvents('sess-a', 'agent-x');
      await ingestSessionEvents('sess-b', 'agent-y');

      const res = await app.request('/api/sessions?agentId=agent-x', { headers: auth() });
      const body = await res.json();
      expect(body.sessions.every((s: any) => s.agentId === 'agent-x')).toBe(true);
    });

    it('paginates with limit and offset', async () => {
      await ingestSessionEvents('sess-p1');
      await ingestSessionEvents('sess-p2');
      await ingestSessionEvents('sess-p3');

      const res = await app.request('/api/sessions?limit=2&offset=0', { headers: auth() });
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.hasMore).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/sessions');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/sessions/:id ──

  describe('GET /api/sessions/:id', () => {
    it('returns session detail', async () => {
      await ingestSessionEvents('sess-detail');

      const res = await app.request('/api/sessions/sess-detail', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('sess-detail');
    });

    it('returns 404 for nonexistent session', async () => {
      const res = await app.request('/api/sessions/does-not-exist', { headers: auth() });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/sessions/:id/timeline ──

  describe('GET /api/sessions/:id/timeline', () => {
    it('returns timeline with chain verification', async () => {
      await ingestSessionEvents('sess-tl');

      const res = await app.request('/api/sessions/sess-tl/timeline', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.chainValid).toBe(true);
    });

    it('returns 404 for nonexistent session timeline', async () => {
      const res = await app.request('/api/sessions/no-session/timeline', { headers: auth() });
      expect(res.status).toBe(404);
    });
  });
});

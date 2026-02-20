/**
 * F7-S2.2: Events route integration tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
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

function validEvent(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    eventType: 'tool_call',
    payload: { toolName: 'search', callId: 'call-1', arguments: { q: 'test' } },
    ...overrides,
  };
}

describe('Events Routes (F7-S2.2)', () => {
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

  // ── POST /api/events ──

  describe('POST /api/events', () => {
    it('returns 201 for valid event batch', async () => {
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [validEvent()] }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(1);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].id).toBeDefined();
      expect(body.events[0].hash).toBeDefined();
    });

    it('returns 400 for invalid JSON', async () => {
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [{ sessionId: '' }] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty events array', async () => {
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [validEvent()] }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/events ──

  describe('GET /api/events', () => {
    async function ingestEvents(count: number, overrides?: Record<string, unknown>) {
      const events = Array.from({ length: count }, (_, i) =>
        validEvent({ ...overrides, payload: { toolName: `tool-${i}`, callId: `call-${i}`, arguments: {} } }),
      );
      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      expect(res.status).toBe(201);
    }

    it('returns events list', async () => {
      await ingestEvents(3);
      const res = await app.request('/api/events', { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toHaveLength(3);
      expect(body.total).toBe(3);
    });

    it('filters by sessionId', async () => {
      await ingestEvents(2, { sessionId: 'sess-a' });
      await ingestEvents(1, { sessionId: 'sess-b' });
      const res = await app.request('/api/events?sessionId=sess-a', { headers: auth() });
      const body = await res.json();
      expect(body.events).toHaveLength(2);
    });

    it('filters by eventType', async () => {
      await ingestEvents(2);
      const res = await app.request('/api/events?eventType=tool_call', { headers: auth() });
      const body = await res.json();
      expect(body.events.length).toBeGreaterThanOrEqual(2);
    });

    it('paginates with limit and offset', async () => {
      await ingestEvents(5);
      const res = await app.request('/api/events?limit=2&offset=0', { headers: auth() });
      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.hasMore).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/events');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/events/:id ──

  describe('GET /api/events/:id', () => {
    it('returns a single event by id', async () => {
      const postRes = await app.request('/api/events', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [validEvent()] }),
      });
      const { events } = await postRes.json();
      const eventId = events[0].id;

      const res = await app.request(`/api/events/${eventId}`, { headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(eventId);
    });

    it('returns 404 for nonexistent event', async () => {
      const res = await app.request('/api/events/nonexistent-id', { headers: auth() });
      expect(res.status).toBe(404);
    });
  });
});

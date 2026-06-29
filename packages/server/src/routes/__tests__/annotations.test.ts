/**
 * Annotation queue lifecycle (#122): pending → in_review → scored/skipped,
 * identity-checked assignment, submit → exactly one chained human_score.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { eventsRoutes } from '../events.js';
import { sessionsRoutes } from '../sessions.js';
import { annotationRoutes } from '../annotations.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function createApp(db: any, store: SqliteEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, false));
  app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
  app.route('/api/sessions', sessionsRoutes(store));
  app.route('/api/annotations', annotationRoutes(db, store));
  return app;
}

function seedApiKey(db: any, id: string): string {
  const rawKey = `als_testkey${id}1234567890abcdef1234567890`;
  db.insert(apiKeys).values({
    id,
    keyHash: hashApiKey(rawKey),
    name: id,
    scopes: JSON.stringify(['*']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default',
    role: 'editor',
  }).run();
  return rawKey;
}

describe('Annotation queues (#122)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let key1: string;
  let key2: string;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    key1 = seedApiKey(db, 'key1');
    key2 = seedApiKey(db, 'key2');
    await app.request('/api/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ sessionId: 's1', agentId: 'agent-1', eventType: 'session_started', payload: {} }] }),
    });
  });

  const auth = (k: string) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' });
  const post = (path: string, body: unknown, k: string) =>
    app.request(path, { method: 'POST', headers: auth(k), body: JSON.stringify(body) });
  const get = (path: string, k: string) => app.request(path, { headers: auth(k) });

  async function makeQueueWithItem(): Promise<{ queueId: string; itemId: string }> {
    const q = await (await post('/api/annotations/queues', { name: 'Review Q' }, key1)).json();
    const items = await (await post(`/api/annotations/queues/${q.queue.id}/items`, { items: [{ sessionId: 's1' }] }, key1)).json();
    return { queueId: q.queue.id, itemId: items.items[0].id };
  }

  it('runs the full lifecycle pending → in_review → scored, emitting one human_score', async () => {
    const { itemId } = await makeQueueWithItem();

    // pending → claim → in_review (assignee = key1)
    const claimed = await (await post(`/api/annotations/items/${itemId}/claim`, {}, key1)).json();
    expect(claimed.item.status).toBe('in_review');
    expect(claimed.item.assignee).toBe('apikey:key1');

    // submit → scored, links a human_score event
    const submitted = await post(`/api/annotations/items/${itemId}/submit`, { score: 0.8, reasoning: 'ok' }, key1);
    expect(submitted.status).toBe(201);
    const sub = await submitted.json();
    expect(sub.item.status).toBe('scored');
    expect(sub.item.scoreEventId).toBe(sub.event.id);

    // Exactly one chained human_score on the session, tagged with the queue item.
    const tl = await (await get('/api/sessions/s1/timeline', key1)).json();
    const scores = tl.events.filter((e: any) => e.eventType === 'human_score');
    expect(scores).toHaveLength(1);
    expect(scores[0].payload.queueItemId).toBe(itemId);
    expect(scores[0].payload.score).toBe(0.8);
    expect(tl.chainValid).toBe(true);
  });

  it('blocks submission by a non-assignee (identity-checked assignment)', async () => {
    const { itemId } = await makeQueueWithItem();
    await post(`/api/annotations/items/${itemId}/claim`, {}, key1); // assignee = key1
    const res = await post(`/api/annotations/items/${itemId}/submit`, { score: 1 }, key2);
    expect(res.status).toBe(403);
  });

  it('cannot claim an already-claimed item', async () => {
    const { itemId } = await makeQueueWithItem();
    await post(`/api/annotations/items/${itemId}/claim`, {}, key1);
    const res = await post(`/api/annotations/items/${itemId}/claim`, {}, key2);
    expect(res.status).toBe(409);
  });

  it('supports skip', async () => {
    const { itemId } = await makeQueueWithItem();
    const res = await post(`/api/annotations/items/${itemId}/skip`, {}, key1);
    expect(res.status).toBe(200);
    expect((await res.json()).item.status).toBe('skipped');
  });

  it('isolates queues by tenant + 404s items from other tenants', async () => {
    const { itemId } = await makeQueueWithItem();
    // A different tenant's key.
    db.insert(apiKeys).values({
      id: 'keyX',
      keyHash: hashApiKey('als_testkeykeyX1234567890abcdef1234567890'),
      name: 'keyX',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'other',
      role: 'editor',
    }).run();
    const res = await post(`/api/annotations/items/${itemId}/claim`, {}, 'als_testkeykeyX1234567890abcdef1234567890');
    expect(res.status).toBe(404);
  });
});

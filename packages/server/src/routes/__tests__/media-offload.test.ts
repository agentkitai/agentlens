/**
 * Media offload (#252): a large base64 data URL in an ingested payload is moved
 * to media_objects (leaving a `media://` ref) and the GET route resolves it back.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { eventsRoutes } from '../events.js';
import { mediaRoutes } from '../media.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { MediaStore } from '../../db/media-store.js';
import { offloadPayload } from '../../lib/media-offload.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys)
    .values({
      id: 'key-1', keyHash: hashApiKey(rawKey), name: 'Test Key',
      scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'default', role: 'editor',
    })
    .run();
  return rawKey;
}

const BIG_B64 = 'A'.repeat(6000);
const DATA_URL = `data:image/png;base64,${BIG_B64}`;

function imageEvent() {
  return {
    sessionId: 's1',
    agentId: 'agt_a',
    eventType: 'llm_call',
    payload: {
      callId: 'c1',
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: DATA_URL } }] }],
    },
  };
}

describe('media offload (#252)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono<{ Variables: AuthVariables }>();
    app.use('/*', authMiddleware(db, false));
    app.route('/api/events', eventsRoutes(store, { embeddingWorker: null, mediaStore: new MediaStore(db) }));
    app.route('/api/media', mediaRoutes(db));
    apiKey = seedApiKey(db);
  });

  it('offloads a large base64 data URL to a media:// ref and resolves it via GET', async () => {
    const res = await app.request('/api/events', { method: 'POST', headers: auth(), body: JSON.stringify({ events: [imageEvent()] }) });
    expect(res.status).toBe(201);

    // The stored payload carries a media:// ref, not the base64.
    const timeline = await store.getSessionTimeline('s1');
    const url = (timeline[0]!.payload as any).messages[0].content[0].image_url.url as string;
    expect(url).toMatch(/^media:\/\//);
    expect(url).not.toContain(BIG_B64);

    // The GET route resolves it back to bytes.
    const id = url.slice('media://'.length);
    const got = await app.request(`/api/media/${id}`, { headers: auth() });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer()).length).toBe(Buffer.from(BIG_B64, 'base64').length);
  });

  it('leaves small strings and non-data-url content untouched', async () => {
    const payload = { messages: [{ role: 'user', content: 'hello' }], note: 'x'.repeat(9000) };
    const out = await offloadPayload(payload, 'default', new MediaStore(db));
    expect(out).toEqual(payload); // no data URL → nothing offloaded
  });

  it('scopes resolution to the tenant (404 for an unknown id)', async () => {
    const got = await app.request('/api/media/does-not-exist', { headers: auth() });
    expect(got.status).toBe(404);
  });
});

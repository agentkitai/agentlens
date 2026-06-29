/**
 * Human scores + feedback + unified scores read (#122).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createEvent } from '@agentkitai/agentlens-core';
import { Hono } from 'hono';
import { eventsRoutes } from '../events.js';
import { scoresRoutes } from '../scores.js';
import { sessionsRoutes } from '../sessions.js';
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
  app.route('/api', scoresRoutes(store));
  return app;
}

function seedApiKey(db: any, id = 'key1'): string {
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

describe('Human scores + feedback (#122)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);
    // Seed an SDK (chained) session.
    await app.request('/api/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          { sessionId: 's1', agentId: 'agent-1', eventType: 'session_started', payload: {} },
          { sessionId: 's1', agentId: 'agent-1', eventType: 'tool_call', payload: { toolName: 't', callId: 'c1', arguments: {} } },
        ],
      }),
    });
  });

  afterEach(() => {
    delete process.env.FEEDBACK_SUBJECT_SECRET;
  });

  const auth = (k = apiKey) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' });
  const post = (path: string, body: unknown, k?: string) =>
    app.request(path, { method: 'POST', headers: auth(k), body: JSON.stringify(body) });

  it('records a human_score as a chained, identity-stamped event', async () => {
    const res = await post('/api/sessions/s1/human-score', { score: 0.9, reasoning: 'looks good', labels: ['helpful'] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.event.prevHash).not.toBeNull(); // chained onto the SDK session

    // Timeline still verifies, and the score is present + identity-stamped.
    const tl = await (await app.request('/api/sessions/s1/timeline', { headers: auth() })).json();
    expect(tl.chainValid).toBe(true);
    expect(tl.chained).toBe(true);
    const hs = tl.events.find((e: any) => e.eventType === 'human_score');
    expect(hs.payload.method).toBe('human');
    expect(hs.payload.score).toBe(0.9);
    expect(hs.payload.annotatorUserId).toBe('apikey:key1'); // server-set, from auth context
  });

  it('accepts a free-form TEXT score (#153) with no numeric/verdict/passed', async () => {
    const res = await post('/api/sessions/s1/human-score', { textValue: 'The answer was thorough but missed the edge case.' });
    expect(res.status).toBe(201);
    const tl = await (await app.request('/api/sessions/s1/timeline', { headers: auth() })).json();
    const hs = tl.events.find((e: any) => e.eventType === 'human_score');
    expect(hs.payload.textValue).toBe('The answer was thorough but missed the edge case.');
    expect(hs.payload.score).toBeUndefined();
  });

  it('rejects a client-forged human_score / feedback via the ingest enum', async () => {
    for (const eventType of ['human_score', 'feedback']) {
      const res = await post('/api/events', { events: [{ sessionId: 's1', agentId: 'agent-1', eventType, payload: {} }] });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('surfaces automated + human scores in the unified read API', async () => {
    await post('/api/sessions/s1/human-score', { verdict: 'pass' });
    const sessionScores = await (await app.request('/api/sessions/s1/scores', { headers: auth() })).json();
    const human = sessionScores.scores.find((s: any) => s.eventType === 'human_score');
    expect(human.method).toBe('human');
    expect(human.identity.kind).toBe('human');
    expect(human.identity.userId).toBe('apikey:key1');

    const cross = await (await app.request('/api/scores?agentId=agent-1', { headers: auth() })).json();
    expect(cross.scores.some((s: any) => s.eventType === 'human_score')).toBe(true);
  });

  it('records feedback bound to the session, with a verified subject when a token is given', async () => {
    process.env.FEEDBACK_SUBJECT_SECRET = 'sekret';
    const subjectId = 'user-42';
    const token = `${Buffer.from(subjectId).toString('base64url')}.${createHmac('sha256', 'sekret').update(subjectId).digest('hex')}`;

    const res = await post('/api/sessions/s1/feedback', { rating: 5, comment: 'great', subjectToken: token });
    expect(res.status).toBe(201);
    expect((await res.json()).subjectAttributed).toBe(true);

    const tl = await (await app.request('/api/sessions/s1/timeline', { headers: auth() })).json();
    const fb = tl.events.find((e: any) => e.eventType === 'feedback');
    expect(fb.payload.rating).toBe(5);
    expect(fb.payload.subjectId).toBe(subjectId); // server-set from the verified token
    expect(tl.chainValid).toBe(true);
  });

  it('does not attribute a subject when the token is invalid / secret unset', async () => {
    // No FEEDBACK_SUBJECT_SECRET set → token ignored, subject not attributed.
    const res = await post('/api/sessions/s1/feedback', { sentiment: 'down', subjectToken: 'anything.deadbeef' });
    expect(res.status).toBe(201);
    expect((await res.json()).subjectAttributed).toBe(false);
  });

  it('404s scoring a session with no events', async () => {
    const res = await post('/api/sessions/does-not-exist/human-score', { score: 1 });
    expect(res.status).toBe(404);
  });

  it('record-integrity (prevHash=null) on an unchained OTLP-style session — no synthesized chain', async () => {
    // Mimic OTLP ingest: events with prevHash=null throughout (record-integrity).
    const mk = (eventType: any) =>
      createEvent({ sessionId: 'otlp1', agentId: 'agent-2', eventType, payload: { type: 'x', data: {} } as any, tenantId: 'default', prevHash: null });
    await store.insertEvents([mk('custom'), mk('custom')]);

    const res = await post('/api/sessions/otlp1/human-score', { score: 0.5 });
    expect(res.status).toBe(201);
    expect((await res.json()).event.prevHash).toBeNull(); // not chained onto the OTLP tail

    const tl = await (await app.request('/api/sessions/otlp1/timeline', { headers: auth() })).json();
    expect(tl.chained).toBe(false); // still record-integrity only
    expect(tl.chainValid).toBe(true); // per-record integrity holds
    expect(tl.events.find((e: any) => e.eventType === 'human_score').prevHash).toBeNull();
  });
});

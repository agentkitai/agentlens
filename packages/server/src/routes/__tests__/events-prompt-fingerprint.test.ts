/**
 * Prompt auto-discovery wiring (#55 Thread 2, box 126):
 * ingesting an llm_call via POST /api/events records a prompt fingerprint.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { verifyChain } from '@agentkitai/agentlens-core';
import { eventsRoutes } from '../events.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { PromptStore, computePromptHash } from '../../db/prompt-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

const SYS = 'You are AgentLens QA. Answer only from the provided context.';

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys).values({
    id: 'key-1', keyHash: hashApiKey(rawKey), name: 'Test Key',
    scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default', role: 'editor',
  }).run();
  return rawKey;
}

function llmCallEvent(systemPrompt?: string) {
  return {
    sessionId: 's1', agentId: 'agt_a', eventType: 'llm_call', timestamp: '2026-01-01T00:00:01.000Z',
    payload: { callId: 'c1', provider: 'anthropic', model: 'claude-haiku-4-5', systemPrompt,
      messages: [{ role: 'user', content: 'hello' }] },
  };
}

describe('POST /api/events → prompt fingerprint auto-discovery', async () => {
  let db: any;
  let store: SqliteEventStore;
  let promptStore: PromptStore;
  let app: any;
  let apiKey: string;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    promptStore = new PromptStore(db);
    app = new Hono<{ Variables: AuthVariables }>();
    app.use('/*', authMiddleware(db, false));
    app.route('/api/events', eventsRoutes(store, { embeddingWorker: null, promptStore }));
    apiKey = seedApiKey(db);
  });

  it('records a fingerprint for the ingested llm_call system prompt', async () => {
    const res = await app.request('/api/events', {
      method: 'POST', headers: auth(), body: JSON.stringify({ events: [llmCallEvent(SYS)] }),
    });
    expect(res.status).toBe(201);

    const fps = await promptStore.getFingerprints('default');
    expect(fps).toHaveLength(1);
    expect(fps[0]!.contentHash).toBe(computePromptHash(SYS));
    expect(fps[0]!.agentId).toBe('agt_a');

    // Fingerprinting is a side table — the event hash chain is untouched.
    const timeline = await await store.getSessionTimeline('s1');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('does not break ingest when there is no system prompt (no fingerprint)', async () => {
    const res = await app.request('/api/events', {
      method: 'POST', headers: auth(), body: JSON.stringify({ events: [llmCallEvent(undefined)] }),
    });
    expect(res.status).toBe(201);
    expect(await promptStore.getFingerprints('default')).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createPoolApp } from '../app.js';
import { InMemoryPoolStore } from '../store.js';
import { RateLimiter } from '../rate-limiter.js';

function makeApp() {
  const store = new InMemoryPoolStore();
  const rateLimiter = new RateLimiter(100, 60_000);
  const app = createPoolApp({ store, rateLimiter });
  return { app, store, rateLimiter };
}

function json(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonDelete(body: unknown) {
  return {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonPut(body: unknown) {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('Pool Server API', () => {
  let app: ReturnType<typeof createPoolApp>;
  let store: InMemoryPoolStore;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    const ctx = makeApp();
    app = ctx.app;
    store = ctx.store;
    rateLimiter = ctx.rateLimiter;
  });

  // ─── Health ───

  describe('GET /health', () => {
    it('returns status ok', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeTypeOf('number');
    });
  });

  // ─── Share ───

  describe('POST /pool/share', () => {
    it('creates a shared lesson', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'debug', title: 'Title', content: 'Content', embedding: [1, 0, 0], redactionApplied: true, redactionFindingsCount: 0,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.category).toBe('debug');
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/share', json({ anonymousContributorId: 'c1' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-array embedding', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: 'not-array',
      }));
      expect(res.status).toBe(400);
    });

    it('accepts qualitySignals', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C',
        embedding: [1], redactionApplied: true, redactionFindingsCount: 0, qualitySignals: { successRate: 0.95 },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.qualitySignals).toEqual({ successRate: 0.95 });
    });

    it('enforces rate limiting', async () => {
      const rl = new RateLimiter(2, 60_000);
      const limited = createPoolApp({ store, rateLimiter: rl });
      const payload = { anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0 };

      await limited.request('/pool/share', json(payload));
      await limited.request('/pool/share', json(payload));
      const res = await limited.request('/pool/share', json(payload));
      expect(res.status).toBe(429);
    });
  });

  // ─── Search ───

  describe('POST /pool/search', () => {
    it('returns matching lessons sorted by similarity', async () => {
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'Close', content: 'C', embedding: [0.9, 0.1], redactionApplied: true, redactionFindingsCount: 0,
      }));
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'Far', content: 'C', embedding: [0, 1], redactionApplied: true, redactionFindingsCount: 0,
      }));

      const res = await app.request('/pool/search', json({ embedding: [1, 0] }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBe(2);
      expect(body.results[0].lesson.title).toBe('Close');
    });

    it('returns 400 for missing embedding', async () => {
      const res = await app.request('/pool/search', json({}));
      expect(res.status).toBe(400);
    });

    it('filters by category', async () => {
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'debug', title: 'T1', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'perf', title: 'T2', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));

      const res = await app.request('/pool/search', json({ embedding: [1], redactionApplied: true, redactionFindingsCount: 0, category: 'debug' }));
      const body = await res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].lesson.category).toBe('debug');
    });

    it('filters by minReputation', async () => {
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));

      const res = await app.request('/pool/search', json({ embedding: [1], redactionApplied: true, redactionFindingsCount: 0, minReputation: 60 }));
      const body = await res.json();
      expect(body.results.length).toBe(0); // default reputation is 50
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await app.request('/pool/share', json({
          anonymousContributorId: 'c1', category: 'a', title: `T${i}`, content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
        }));
      }
      const res = await app.request('/pool/search', json({ embedding: [1], redactionApplied: true, redactionFindingsCount: 0, limit: 2 }));
      const body = await res.json();
      expect(body.results.length).toBe(2);
    });
  });

  // ─── Purge ───

  describe('DELETE /pool/purge', () => {
    it('purges lessons with valid token', async () => {
      await store.setPurgeToken('c1', 'secret');
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T2', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));

      const res = await app.request('/pool/purge', jsonDelete({
        anonymousContributorId: 'c1', token: 'secret',
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(2);
    });

    it('rejects with invalid token', async () => {
      await store.setPurgeToken('c1', 'secret');
      const res = await app.request('/pool/purge', jsonDelete({
        anonymousContributorId: 'c1', token: 'wrong',
      }));
      expect(res.status).toBe(403);
    });

    it('rejects with no token set', async () => {
      const res = await app.request('/pool/purge', jsonDelete({
        anonymousContributorId: 'c1', token: 'any',
      }));
      expect(res.status).toBe(403);
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/purge', jsonDelete({}));
      expect(res.status).toBe(400);
    });
  });

  // ─── Count ───

  describe('GET /pool/count', () => {
    it('returns count for contributor', async () => {
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));
      const res = await app.request('/pool/count?contributorId=c1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(1);
    });

    it('returns 0 after purge', async () => {
      await store.setPurgeToken('c1', 'secret');
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'a', title: 'T', content: 'C', embedding: [1], redactionApplied: true, redactionFindingsCount: 0,
      }));
      await app.request('/pool/purge', jsonDelete({ anonymousContributorId: 'c1', token: 'secret' }));

      const res = await app.request('/pool/count?contributorId=c1');
      const body = await res.json();
      expect(body.count).toBe(0);
    });

    it('returns 400 for missing contributorId', async () => {
      const res = await app.request('/pool/count');
      expect(res.status).toBe(400);
    });
  });

  // ─── Register ───

  describe('POST /pool/register', () => {
    it('registers a capability', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize',
        inputSchema: { type: 'string' }, outputSchema: { type: 'string' },
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.taskType).toBe('summarize');
      expect(body.active).toBe(true);
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/register', json({ anonymousAgentId: 'a1' }));
      expect(res.status).toBe(400);
    });

    it('requires customType when taskType is custom', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'custom',
        inputSchema: {}, outputSchema: {},
      }));
      expect(res.status).toBe(400);
    });

    it('validates customType format', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'custom', customType: 'invalid type!',
        inputSchema: {}, outputSchema: {},
      }));
      expect(res.status).toBe(400);
    });

    it('validates customType max length', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'custom', customType: 'a'.repeat(65),
        inputSchema: {}, outputSchema: {},
      }));
      expect(res.status).toBe(400);
    });

    it('accepts valid customType', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'custom', customType: 'my-custom-type',
        inputSchema: {}, outputSchema: {},
      }));
      expect(res.status).toBe(201);
    });

    it('accepts optional fields', async () => {
      const res = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize',
        inputSchema: {}, outputSchema: {},
        estimatedLatencyMs: 200, estimatedCostUsd: 0.01, scope: 'internal',
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.estimatedLatencyMs).toBe(200);
      expect(body.scope).toBe('internal');
    });
  });

  // ─── Discover ───

  describe('POST /pool/discover', () => {
    it('returns matching capabilities', async () => {
      await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {},
      }));
      await app.request('/pool/register', json({
        anonymousAgentId: 'a2', taskType: 'translate', inputSchema: {}, outputSchema: {},
      }));

      const res = await app.request('/pool/discover', json({ taskType: 'summarize' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBe(1);
    });

    it('returns all when no filters', async () => {
      await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {},
      }));
      await app.request('/pool/register', json({
        anonymousAgentId: 'a2', taskType: 'translate', inputSchema: {}, outputSchema: {},
      }));

      const res = await app.request('/pool/discover', json({}));
      const body = await res.json();
      expect(body.results.length).toBe(2);
    });

    it('filters by minTrust', async () => {
      await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {}, trustScorePercentile: 30,
      }));
      const res = await app.request('/pool/discover', json({ minTrust: 50 }));
      const body = await res.json();
      expect(body.results.length).toBe(0);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await app.request('/pool/register', json({
          anonymousAgentId: `a${i}`, taskType: 'summarize', inputSchema: {}, outputSchema: {},
        }));
      }
      const res = await app.request('/pool/discover', json({ limit: 2 }));
      const body = await res.json();
      expect(body.results.length).toBe(2);
    });
  });

  // ─── Unregister ───

  describe('DELETE /pool/unregister', () => {
    it('deactivates a capability', async () => {
      const regRes = await app.request('/pool/register', json({
        anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {},
      }));
      const { id } = await regRes.json();

      const res = await app.request('/pool/unregister', jsonDelete({ id }));
      expect(res.status).toBe(200);

      // Discover should not return it
      const discoverRes = await app.request('/pool/discover', json({ taskType: 'summarize' }));
      const body = await discoverRes.json();
      expect(body.results.length).toBe(0);
    });

    it('returns 404 for unknown capability', async () => {
      const res = await app.request('/pool/unregister', jsonDelete({ id: 'unknown' }));
      expect(res.status).toBe(404);
    });

    it('returns 400 for missing id', async () => {
      const res = await app.request('/pool/unregister', jsonDelete({}));
      expect(res.status).toBe(400);
    });
  });

  // ─── Delegate ───

  describe('POST /pool/delegate', () => {
    it('creates a delegation request', async () => {
      const res = await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 30000,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('pending');
    });

    it('is idempotent on same ID', async () => {
      const payload = {
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 30000,
      };
      await app.request('/pool/delegate', json(payload));
      const res = await app.request('/pool/delegate', json(payload));
      expect(res.status).toBe(201);
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/delegate', json({ id: 'd1' }));
      expect(res.status).toBe(400);
    });
  });

  // ─── Delegate Inbox ───

  describe('GET /pool/delegate/inbox', () => {
    it('returns pending delegations for target', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));

      const res = await app.request('/pool/delegate/inbox?targetAnonymousId=t1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.requests.length).toBe(1);
    });

    it('returns empty for unknown target', async () => {
      const res = await app.request('/pool/delegate/inbox?targetAnonymousId=unknown');
      const body = await res.json();
      expect(body.requests.length).toBe(0);
    });

    it('returns 400 for missing targetAnonymousId', async () => {
      const res = await app.request('/pool/delegate/inbox');
      expect(res.status).toBe(400);
    });
  });

  // ─── Delegate Status ───

  describe('PUT /pool/delegate/:id/status', () => {
    it('accepts a delegation', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));

      const res = await app.request('/pool/delegate/d1/status', jsonPut({ status: 'accepted' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('accepted');
    });

    it('rejects a delegation', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));

      const res = await app.request('/pool/delegate/d1/status', jsonPut({ status: 'rejected' }));
      const body = await res.json();
      expect(body.status).toBe('rejected');
      expect(body.completedEpoch).toBeTruthy();
    });

    it('completes a delegation with output', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));
      await app.request('/pool/delegate/d1/status', jsonPut({ status: 'accepted' }));

      const res = await app.request('/pool/delegate/d1/status', jsonPut({
        status: 'completed', outputData: '{"summary":"done"}',
      }));
      const body = await res.json();
      expect(body.status).toBe('completed');
      expect(body.outputData).toBe('{"summary":"done"}');
    });

    it('fails a delegation with error status', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));

      const res = await app.request('/pool/delegate/d1/status', jsonPut({ status: 'error' }));
      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.completedEpoch).toBeTruthy();
    });

    it('returns 404 for unknown delegation', async () => {
      const res = await app.request('/pool/delegate/unknown/status', jsonPut({ status: 'accepted' }));
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid status', async () => {
      await app.request('/pool/delegate', json({
        id: 'd1', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
        taskType: 'summarize', inputData: '{}', timeoutMs: 60000,
      }));
      const res = await app.request('/pool/delegate/d1/status', jsonPut({ status: 'invalid' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing status', async () => {
      const res = await app.request('/pool/delegate/d1/status', jsonPut({}));
      expect(res.status).toBe(400);
    });
  });
});

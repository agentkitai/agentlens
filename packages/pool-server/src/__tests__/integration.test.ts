import { describe, it, expect, beforeEach } from 'vitest';
import { createPoolApp } from '../app.js';
import { InMemoryPoolStore } from '../store.js';
import { RateLimiter } from '../rate-limiter.js';

function json(body: unknown) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function jsonDelete(body: unknown) {
  return { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function jsonPut(body: unknown) {
  return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('Integration: full sharing lifecycle', () => {
  let app: ReturnType<typeof createPoolApp>;
  let store: InMemoryPoolStore;

  beforeEach(() => {
    store = new InMemoryPoolStore();
    app = createPoolApp({ store, rateLimiter: new RateLimiter(1000, 60_000) });
  });

  it('share → search → purge → verify count=0', async () => {
    await store.setPurgeToken('c1', 'tok');

    // Share 3 lessons
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1', category: 'debug', title: `Lesson ${i}`,
        content: `Content ${i}`, embedding: [1, 0, 0],
      }));
      expect(res.status).toBe(201);
    }

    // Search
    const searchRes = await app.request('/pool/search', json({ embedding: [1, 0, 0] }));
    const searchBody = await searchRes.json();
    expect(searchBody.results.length).toBe(3);

    // Count
    let countRes = await app.request('/pool/count?contributorId=c1');
    expect((await countRes.json()).count).toBe(3);

    // Purge
    const purgeRes = await app.request('/pool/purge', jsonDelete({ anonymousContributorId: 'c1', token: 'tok' }));
    expect((await purgeRes.json()).deleted).toBe(3);

    // Verify
    countRes = await app.request('/pool/count?contributorId=c1');
    expect((await countRes.json()).count).toBe(0);

    // Search returns empty
    const searchRes2 = await app.request('/pool/search', json({ embedding: [1, 0, 0] }));
    expect((await searchRes2.json()).results.length).toBe(0);
  });
});

describe('Integration: full delegation lifecycle', () => {
  let app: ReturnType<typeof createPoolApp>;

  beforeEach(() => {
    const store = new InMemoryPoolStore();
    app = createPoolApp({ store, rateLimiter: new RateLimiter(1000, 60_000) });
  });

  it('register → discover → delegate → accept → complete', async () => {
    // Register
    const regRes = await app.request('/pool/register', json({
      anonymousAgentId: 'agent-1', taskType: 'summarize',
      inputSchema: { type: 'string' }, outputSchema: { type: 'string' },
    }));
    expect(regRes.status).toBe(201);

    // Discover
    const discRes = await app.request('/pool/discover', json({ taskType: 'summarize' }));
    const { results } = await discRes.json();
    expect(results.length).toBe(1);

    // Delegate
    const delRes = await app.request('/pool/delegate', json({
      id: 'del-1', requesterAnonymousId: 'requester-1',
      targetAnonymousId: 'agent-1', taskType: 'summarize',
      inputData: '{"text":"hello world"}', timeoutMs: 30000,
    }));
    expect(delRes.status).toBe(201);

    // Inbox
    const inboxRes = await app.request('/pool/delegate/inbox?targetAnonymousId=agent-1');
    const inbox = await inboxRes.json();
    expect(inbox.requests.length).toBe(1);

    // Accept
    const acceptRes = await app.request('/pool/delegate/del-1/status', jsonPut({ status: 'accepted' }));
    expect((await acceptRes.json()).status).toBe('accepted');

    // Complete
    const completeRes = await app.request('/pool/delegate/del-1/status', jsonPut({
      status: 'completed', outputData: '{"summary":"hello"}',
    }));
    const completed = await completeRes.json();
    expect(completed.status).toBe('completed');
    expect(completed.outputData).toBe('{"summary":"hello"}');

    // Inbox should be empty
    const inboxRes2 = await app.request('/pool/delegate/inbox?targetAnonymousId=agent-1');
    expect((await inboxRes2.json()).requests.length).toBe(0);
  });

  it('register → discover → unregister → discover returns empty', async () => {
    const regRes = await app.request('/pool/register', json({
      anonymousAgentId: 'agent-1', taskType: 'translate',
      inputSchema: {}, outputSchema: {},
    }));
    const { id } = await regRes.json();

    let discRes = await app.request('/pool/discover', json({ taskType: 'translate' }));
    expect((await discRes.json()).results.length).toBe(1);

    await app.request('/pool/unregister', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });

    discRes = await app.request('/pool/discover', json({ taskType: 'translate' }));
    expect((await discRes.json()).results.length).toBe(0);
  });

  it('delegation with rejection flow', async () => {
    await app.request('/pool/delegate', json({
      id: 'del-rej', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
      taskType: 'summarize', inputData: '{}', timeoutMs: 30000,
    }));

    const rejRes = await app.request('/pool/delegate/del-rej/status', jsonPut({ status: 'rejected' }));
    const body = await rejRes.json();
    expect(body.status).toBe('rejected');
    expect(body.completedEpoch).toBeTruthy();

    // Should not appear in inbox
    const inboxRes = await app.request('/pool/delegate/inbox?targetAnonymousId=t1');
    expect((await inboxRes.json()).requests.length).toBe(0);
  });

  it('delegation with error/fail flow', async () => {
    await app.request('/pool/delegate', json({
      id: 'del-err', requesterAnonymousId: 'r1', targetAnonymousId: 't1',
      taskType: 'summarize', inputData: '{}', timeoutMs: 30000,
    }));
    await app.request('/pool/delegate/del-err/status', jsonPut({ status: 'accepted' }));
    const errRes = await app.request('/pool/delegate/del-err/status', jsonPut({ status: 'error' }));
    expect((await errRes.json()).status).toBe('error');
  });

  it('discover filters by customType', async () => {
    await app.request('/pool/register', json({
      anonymousAgentId: 'a1', taskType: 'custom', customType: 'code-review',
      inputSchema: {}, outputSchema: {},
    }));
    await app.request('/pool/register', json({
      anonymousAgentId: 'a2', taskType: 'custom', customType: 'code-lint',
      inputSchema: {}, outputSchema: {},
    }));
    const res = await app.request('/pool/discover', json({ taskType: 'custom', customType: 'code-review' }));
    expect((await res.json()).results.length).toBe(1);
  });

  it('multiple capabilities per agent', async () => {
    await app.request('/pool/register', json({
      anonymousAgentId: 'a1', taskType: 'summarize', inputSchema: {}, outputSchema: {},
    }));
    await app.request('/pool/register', json({
      anonymousAgentId: 'a1', taskType: 'translate', inputSchema: {}, outputSchema: {},
    }));

    const discRes = await app.request('/pool/discover', json({}));
    expect((await discRes.json()).results.length).toBe(2);
  });
});

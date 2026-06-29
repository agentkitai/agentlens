/**
 * LLM connections API (#143): create (key never returned), masked reads, delete,
 * 503 without an encryption key, and a (mocked) provider test call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp, authHeaders, type TestContext } from '../../__tests__/test-helpers.js';
import { apiKeys } from '../../db/schema.sqlite.js';

let ctx: TestContext;

beforeEach(async () => {
  process.env.AGENTLENS_ENCRYPTION_KEY = 'route-test-key';
  ctx = await createTestApp();
  // manage guard requires a manage-capable role
  ctx.db.update(apiKeys).set({ role: 'admin' }).where(eq(apiKeys.id, 'test-key-id')).run();
});

afterEach(() => {
  delete process.env.AGENTLENS_ENCRYPTION_KEY;
  vi.unstubAllGlobals();
});

function h(): Record<string, string> {
  return { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' };
}

async function create(body: Record<string, unknown>) {
  return ctx.app.request('/api/llm-connections', { method: 'POST', headers: h(), body: JSON.stringify(body) });
}

describe('LLM connections API', () => {
  it('creates a connection and never returns the key', async () => {
    const res = await create({ provider: 'openai', name: 'Prod', apiKey: 'sk-secret-1234' });
    expect(res.status).toBe(201);
    const { connection } = (await res.json()) as any;
    expect(connection.keyLast4).toBe('1234');
    expect(JSON.stringify(connection)).not.toContain('sk-secret');

    const list = (await (await ctx.app.request('/api/llm-connections', { headers: h() })).json()) as any;
    expect(list.connections).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('sk-secret');
  });

  it('rejects an invalid provider / missing fields', async () => {
    expect((await create({ provider: 'nope', name: 'x', apiKey: 'k' })).status).toBe(400);
    expect((await create({ provider: 'openai', name: '', apiKey: 'k' })).status).toBe(400);
  });

  it('returns 503 when no encryption key is configured', async () => {
    delete process.env.AGENTLENS_ENCRYPTION_KEY;
    expect((await create({ provider: 'openai', name: 'x', apiKey: 'k' })).status).toBe(503);
  });

  it('executes a model call against a (mocked) provider via /test', async () => {
    const created = (await (await create({ provider: 'openai', name: 'P', apiKey: 'sk-x-1234', defaultModel: 'gpt-4o' })).json()) as any;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await ctx.app.request(`/api/llm-connections/${created.connection.id}/test`, { method: 'POST', headers: h() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deletes a connection', async () => {
    const created = (await (await create({ provider: 'openai', name: 'P', apiKey: 'sk-y-1234' })).json()) as any;
    expect((await ctx.app.request(`/api/llm-connections/${created.connection.id}`, { method: 'DELETE', headers: h() })).status).toBe(200);
    const list = (await (await ctx.app.request('/api/llm-connections', { headers: h() })).json()) as any;
    expect(list.connections).toHaveLength(0);
  });
});

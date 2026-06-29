/**
 * Playground run endpoint (#144): execute a prompt against a stored connection,
 * return output + cost + latency; compile a stored prompt's variables.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp, authHeaders, type TestContext } from '../../__tests__/test-helpers.js';
import { apiKeys } from '../../db/schema.sqlite.js';

let ctx: TestContext;

beforeEach(async () => {
  process.env.AGENTLENS_ENCRYPTION_KEY = 'playground-test-key';
  ctx = await createTestApp();
  ctx.db.update(apiKeys).set({ role: 'admin' }).where(eq(apiKeys.id, 'test-key-id')).run();
});

afterEach(() => {
  delete process.env.AGENTLENS_ENCRYPTION_KEY;
  vi.unstubAllGlobals();
});

function h(): Record<string, string> {
  return { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' };
}

async function createConnection(): Promise<string> {
  const res = await ctx.app.request('/api/llm-connections', {
    method: 'POST',
    headers: h(),
    body: JSON.stringify({ provider: 'openai', name: 'P', apiKey: 'sk-x-1234', defaultModel: 'gpt-4o' }),
  });
  return ((await res.json()) as any).connection.id;
}

function mockProvider(content = 'pong') {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('POST /api/playground/run', () => {
  it('runs a raw prompt and returns output + cost + latency', async () => {
    const connectionId = await createConnection();
    mockProvider('hello from the model');
    const res = await ctx.app.request('/api/playground/run', {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ connectionId, model: 'gpt-4o', prompt: 'say hi' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.output.content).toBe('hello from the model');
    expect(body.output.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(typeof body.costUsd).toBe('number');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('compiles + runs a stored prompt with variables', async () => {
    const connectionId = await createConnection();
    const created = (await (await ctx.app.request('/api/prompts', {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ name: 'Greeter', content: 'Greet {{name}}', variables: [{ name: 'name' }] }),
    })).json()) as any;

    const fetchMock = mockProvider('Hi Ada!');
    const res = await ctx.app.request('/api/playground/run', {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ connectionId, model: 'gpt-4o', promptId: created.template.id, variables: { name: 'Ada' } }),
    });
    expect(res.status).toBe(200);
    // The compiled user message ("Greet Ada") must reach the provider.
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(sentBody.messages.at(-1).content).toBe('Greet Ada');
  });

  it('validates connection + input', async () => {
    expect((await ctx.app.request('/api/playground/run', { method: 'POST', headers: h(), body: JSON.stringify({ prompt: 'x' }) })).status).toBe(400);
    const connectionId = await createConnection();
    expect(
      (await ctx.app.request('/api/playground/run', { method: 'POST', headers: h(), body: JSON.stringify({ connectionId }) })).status,
    ).toBe(400); // no messages/prompt/promptId
    expect(
      (await ctx.app.request('/api/playground/run', { method: 'POST', headers: h(), body: JSON.stringify({ connectionId: 'nope', prompt: 'x' }) })).status,
    ).toBe(404);
  });
});

/**
 * Prompt runtime primitives (#145): compile a stored prompt (text + chat) with
 * {{variables}} and config, via the server.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp, authHeaders, type TestContext } from '../../__tests__/test-helpers.js';
import { apiKeys } from '../../db/schema.sqlite.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.db.update(apiKeys).set({ role: 'admin' }).where(eq(apiKeys.id, 'test-key-id')).run();
});

function h(): Record<string, string> {
  return { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' };
}

async function createPrompt(body: Record<string, unknown>): Promise<any> {
  const res = await ctx.app.request('/api/prompts', { method: 'POST', headers: h(), body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  return res.json();
}

async function compile(id: string, variables: Record<string, unknown>): Promise<any> {
  const res = await ctx.app.request(`/api/prompts/${id}/compile`, { method: 'POST', headers: h(), body: JSON.stringify({ variables }) });
  expect(res.status).toBe(200);
  return res.json();
}

describe('POST /api/prompts/:id/compile', () => {
  it('compiles a text prompt with variables + config', async () => {
    const { template } = await createPrompt({
      name: 'Summarizer',
      content: 'Summarize: {{doc}}',
      variables: [{ name: 'doc', required: true }],
      config: { model: 'gpt-4o', temperature: 0.2 },
    });
    const out = await compile(template.id, { doc: 'hello world' });
    expect(out.compiled).toMatchObject({ type: 'text', text: 'Summarize: hello world', config: { model: 'gpt-4o', temperature: 0.2 }, missing: [] });
  });

  it('reports missing variables', async () => {
    const { template } = await createPrompt({ name: 'P', content: 'Hi {{name}} from {{org}}', variables: [{ name: 'name' }, { name: 'org' }] });
    const out = await compile(template.id, { name: 'Ada' });
    expect(out.compiled.text).toBe('Hi Ada from {{org}}');
    expect(out.compiled.missing).toEqual(['org']);
  });

  it('compiles a chat prompt into substituted messages', async () => {
    const content = JSON.stringify([
      { role: 'system', content: 'You are {{persona}}.' },
      { role: 'user', content: '{{q}}' },
    ]);
    const { template } = await createPrompt({ name: 'Chatty', content, promptType: 'chat', variables: [{ name: 'persona' }, { name: 'q' }] });
    const out = await compile(template.id, { persona: 'a helpful tutor', q: 'Explain recursion' });
    expect(out.compiled.type).toBe('chat');
    expect(out.compiled.messages).toEqual([
      { role: 'system', content: 'You are a helpful tutor.' },
      { role: 'user', content: 'Explain recursion' },
    ]);
  });

  it('404s for an unknown prompt', async () => {
    const res = await ctx.app.request('/api/prompts/nope/compile', { method: 'POST', headers: h(), body: JSON.stringify({ variables: {} }) });
    expect(res.status).toBe(404);
  });
});

/**
 * Prompt A/B testing routes (#150): start a weighted test, resolve a sticky
 * variant, stop it.
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

async function json(res: Response) {
  return res.json() as Promise<any>;
}

describe('prompt A/B routes', () => {
  it('starts a weighted test and resolves a sticky variant', async () => {
    // template (version 1) + a second version
    const created = await json(await ctx.app.request('/api/prompts', { method: 'POST', headers: h(), body: JSON.stringify({ name: 'P', content: 'v1 {{x}}' }) }));
    const id = created.template.id;
    const v2 = await json(await ctx.app.request(`/api/prompts/${id}/versions`, { method: 'POST', headers: h(), body: JSON.stringify({ content: 'v2 {{x}}' }) }));
    const v1Id = created.version.id;
    const v2Id = v2.version.id;

    const ab = await ctx.app.request(`/api/prompts/${id}/ab`, {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ environment: 'staging', variants: [{ versionId: v1Id, label: 'control', weight: 50 }, { versionId: v2Id, label: 'treatment', weight: 50 }] }),
    });
    expect(ab.status).toBe(201);
    const abTestId = (await json(ab)).abTest.id;

    // resolve is A/B-aware + sticky by key
    const r1 = await json(await ctx.app.request(`/api/prompts/${id}/resolve?environment=staging&key=user-1`, { headers: h() }));
    expect([v1Id, v2Id]).toContain(r1.versionId);
    expect(r1.abTestId).toBe(abTestId);
    const r2 = await json(await ctx.app.request(`/api/prompts/${id}/resolve?environment=staging&key=user-1`, { headers: h() }));
    expect(r2.versionId).toBe(r1.versionId); // sticky

    // stop → no more A/B (and no live version deployed → 404)
    const del = await ctx.app.request(`/api/prompts/${id}/ab/${abTestId}`, { method: 'DELETE', headers: h() });
    expect(del.status).toBe(200);
    const after = await ctx.app.request(`/api/prompts/${id}/resolve?environment=staging`, { headers: h() });
    expect(after.status).toBe(404);
  });

  it('validates variants + environment', async () => {
    const created = await json(await ctx.app.request('/api/prompts', { method: 'POST', headers: h(), body: JSON.stringify({ name: 'Q', content: 'x' }) }));
    const id = created.template.id;
    expect((await ctx.app.request(`/api/prompts/${id}/ab`, { method: 'POST', headers: h(), body: JSON.stringify({ environment: 'nope', variants: [{ versionId: 'v', weight: 1 }] }) })).status).toBe(400);
    expect((await ctx.app.request(`/api/prompts/${id}/ab`, { method: 'POST', headers: h(), body: JSON.stringify({ environment: 'staging', variants: [] }) })).status).toBe(400);
  });
});

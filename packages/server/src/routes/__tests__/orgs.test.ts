/**
 * Orgs / projects / members API (#147, sub-PR 1).
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

describe('orgs API', () => {
  it('lists the default org, creates org → project → member', async () => {
    const list = (await (await ctx.app.request('/api/orgs', { headers: h() })).json()) as any;
    expect(list.orgs.some((o: any) => o.id === 'default')).toBe(true);

    const org = (await (await ctx.app.request('/api/orgs', { method: 'POST', headers: h(), body: JSON.stringify({ name: 'Acme' }) })).json()) as any;
    expect(org.org.slug).toBe('acme');

    const proj = await ctx.app.request(`/api/orgs/${org.org.id}/projects`, { method: 'POST', headers: h(), body: JSON.stringify({ name: 'Web' }) });
    expect(proj.status).toBe(201);

    const mem = await ctx.app.request(`/api/orgs/${org.org.id}/members`, { method: 'POST', headers: h(), body: JSON.stringify({ userId: 'u1', role: 'owner' }) });
    expect(mem.status).toBe(201);

    const full = (await (await ctx.app.request(`/api/orgs/${org.org.id}`, { headers: h() })).json()) as any;
    expect(full.projects).toHaveLength(1);
    expect(full.members).toHaveLength(1);
  });

  it('validates input', async () => {
    expect((await ctx.app.request('/api/orgs', { method: 'POST', headers: h(), body: JSON.stringify({}) })).status).toBe(400);
    expect((await ctx.app.request('/api/orgs/nope', { headers: h() })).status).toBe(404);
  });
});

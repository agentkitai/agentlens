/**
 * Per end-user analytics (#149): /api/analytics/users groups cost/usage by
 * metadata.userId and supports a single-user drill-down filter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createEvent } from '@agentkitai/agentlens-core';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  const ev = (sessionId: string, costUsd: number, userId: string) =>
    createEvent({
      sessionId,
      agentId: 'a',
      tenantId: 'default',
      prevHash: null,
      eventType: 'cost_tracked',
      payload: { model: 'gpt-4o', costUsd, inputTokens: 100, outputTokens: 50 } as never,
      metadata: { userId },
      timestamp: '2026-03-01T10:00:00.000Z',
    });
  await ctx.store.insertEvents([ev('s1', 0.1, 'user_a')]);
  await ctx.store.insertEvents([ev('s2', 0.05, 'user_a')]);
  await ctx.store.insertEvents([ev('s3', 0.25, 'user_b')]);
  // an event with no userId — must be excluded
  await ctx.store.insertEvents([
    createEvent({ sessionId: 's4', agentId: 'a', tenantId: 'default', prevHash: null, eventType: 'tool_call', payload: { toolName: 'x', callId: 'c' } as never, metadata: {}, timestamp: '2026-03-01T10:15:00.000Z' }),
  ]);
});

const range = 'from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z';

describe('GET /api/analytics/users (#149)', () => {
  it('breaks down cost/usage per user, excluding events without a userId', async () => {
    const res = await ctx.app.request(`/api/analytics/users?${range}`, { headers: authHeaders(ctx.apiKey) });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: Array<{ userId: string; eventCount: number; sessionCount: number; totalCostUsd: number }> };
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ userId: 'user_b', sessionCount: 1 }); // ordered by cost desc
    expect(users[0].totalCostUsd).toBeCloseTo(0.25);
    const a = users.find((u) => u.userId === 'user_a')!;
    expect(a.totalCostUsd).toBeCloseTo(0.15);
    expect(a.sessionCount).toBe(2);
    expect(a.eventCount).toBe(2);
  });

  it('filters to a single user via ?userId=', async () => {
    const res = await ctx.app.request(`/api/analytics/users?userId=user_b&${range}`, { headers: authHeaders(ctx.apiKey) });
    const { users } = (await res.json()) as { users: Array<{ userId: string }> };
    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe('user_b');
  });
});

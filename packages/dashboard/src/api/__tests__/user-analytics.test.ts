// @vitest-environment jsdom
/**
 * Per end-user analytics API client (#149).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AnalyticsApi from '../analytics';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

let api: typeof AnalyticsApi;

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../analytics');
});

describe('getUserAnalytics', () => {
  it('fetches the per-user breakdown', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ users: [{ userId: 'u1', eventCount: 3, sessionCount: 2, totalCostUsd: 0.5 }] }));
    const res = await api.getUserAnalytics({ from: '2026-01-01', to: '2026-02-01' });
    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/analytics/users');
    expect(res.users[0].userId).toBe('u1');
  });

  it('passes the userId drill-down filter', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ users: [] }));
    await api.getUserAnalytics({ userId: 'u2' });
    expect(String(mockFetch.mock.calls[0][0])).toContain('userId=u2');
  });
});

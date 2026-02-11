// @vitest-environment jsdom
/**
 * S-5.3 — API Client Core Tests
 *
 * Tests for request(), ApiError, and toQueryString helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

let api: typeof import('../client');

beforeEach(async () => {
  mockFetch.mockReset();
  // Re-import to get fresh module with our mocked fetch
  api = await import('../client');
});

// ─── ApiError ───────────────────────────────────────────────────

describe('ApiError', () => {
  it('has correct name, status, and message', () => {
    const err = new api.ApiError(404, 'Not Found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not Found');
  });

  it('inherits from Error', () => {
    const err = new api.ApiError(500, 'Internal');
    expect(err instanceof Error).toBe(true);
    expect(err.stack).toBeDefined();
  });
});

// ─── request() via public API functions ─────────────────────────
// We test request() indirectly through exported functions since it's not exported.

describe('request() — success', () => {
  it('returns parsed JSON on 200', async () => {
    const payload = { agents: [{ id: 'a1' }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await api.getAgents();
    expect(result).toEqual([{ id: 'a1' }]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sends Content-Type application/json', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ agents: [] }));
    await api.getAgents();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends POST with JSON body', async () => {
    const created = { id: 'k1', name: 'test', key: 'al_xxx', scopes: ['*'], createdAt: '', lastUsedAt: null, revokedAt: null };
    mockFetch.mockResolvedValueOnce(jsonResponse(created));

    await api.createKey('test', ['*']);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/keys');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'test', scopes: ['*'] });
  });
});

describe('request() — errors', () => {
  it('throws ApiError on 404 with correct status', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse('Not Found', 404));

    try {
      await api.getStats();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(api.ApiError);
      expect(e.status).toBe(404);
    }
  });

  it('throws ApiError on 500 with body text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(api.getStats()).rejects.toThrow('Internal Server Error');
  });

  it('throws ApiError with fallback message when body is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error()),
      text: () => Promise.resolve(''),
    });

    await expect(api.getStats()).rejects.toThrow('HTTP 502');
  });

  it('handles network error (fetch rejects)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.getAgents()).rejects.toThrow('Failed to fetch');
  });
});

// ─── toQueryString (tested indirectly) ──────────────────────────

describe('toQueryString (via API calls)', () => {
  it('builds query string with simple params', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ buckets: [], totals: {} }));

    await api.getAnalytics({ from: '2024-01-01', granularity: 'day' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('from=2024-01-01');
    expect(url).toContain('granularity=day');
  });

  it('omits undefined params', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ buckets: [], totals: {} }));

    await api.getAnalytics({});
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/analytics');
  });

  it('joins array values with commas', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ events: [], total: 0, hasMore: false }));

    await api.getEvents({ eventType: ['tool_call', 'llm_call'] as any, limit: 10 });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('eventType=tool_call%2Cllm_call');
    expect(url).toContain('limit=10');
  });
});

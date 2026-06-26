// @vitest-environment jsdom
/**
 * Lore dashboard API client — memory provenance (#82).
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

let lore: typeof import('../lore');

beforeEach(async () => {
  mockFetch.mockReset();
  lore = await import('../lore');
});

describe('getMemoryProvenance (#82)', () => {
  const provenance = {
    id: 'mem 1', owner: 'alice', visibility: 'shared', source: 'capture',
    tags: ['pii'], redactionTags: ['pii'], trustSignal: 'owned',
    supersessionChain: [{ memoryId: 'mem 1', supersededBy: 'm2', reason: 'merged', ts: 't', agent: 'auto' }],
    supersessionSources: [], createdAt: 't',
  };

  it('calls the proxy provenance route with an encoded id and returns the shape', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(provenance));
    const result = await lore.getMemoryProvenance('mem 1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/lore/memories/mem%201/provenance',
      expect.any(Object),
    );
    expect(result?.trustSignal).toBe('owned');
    expect(result?.supersessionChain[0].supersededBy).toBe('m2');
  });

  it('returns null on 404 (missing memory / Lore predates the endpoint)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Memory not found', code: 'NOT_FOUND' }, 404));
    expect(await lore.getMemoryProvenance('missing')).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 502));
    await expect(lore.getMemoryProvenance('x')).rejects.toThrow();
  });
});

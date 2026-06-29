// @vitest-environment jsdom
/**
 * Prompt A/B testing API client (#150).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AbApi from '../prompt-ab';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

let api: typeof AbApi;

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../prompt-ab');
});

describe('prompt-ab API client', () => {
  it('starts an A/B test with variants in the body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ abTest: { id: 'ab1' } }, 201));
    await api.startAbTest('p1', 'staging', [{ versionId: 'v1', label: 'a', weight: 50 }, { versionId: 'v2', label: 'b', weight: 50 }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/prompts/p1/ab');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ environment: 'staging', variants: [{ versionId: 'v1' }, { versionId: 'v2' }] });
  });

  it('lists and stops A/B tests', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ abTests: [] }));
    await api.listAbTests('p1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/prompts/p1/ab');

    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.stopAbTest('p1', 'ab1');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/prompts/p1/ab/ab1');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });
});

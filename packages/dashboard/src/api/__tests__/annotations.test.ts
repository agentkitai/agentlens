// @vitest-environment jsdom
/**
 * Annotation review API client (#146).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AnnotationsApi from '../annotations';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

let api: typeof AnnotationsApi;

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../annotations');
});

describe('annotations API client', () => {
  it('lists queues', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ queues: [{ id: 'q1', name: 'Q' }] }));
    const res = await api.listQueues();
    expect(mockFetch).toHaveBeenCalledWith('/api/annotations/queues', expect.any(Object));
    expect(res.queues[0].id).toBe('q1');
  });

  it('gets a queue with items and encodes the id', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ queue: { id: 'q 1' }, items: [] }));
    await api.getQueue('q 1');
    expect(mockFetch).toHaveBeenCalledWith('/api/annotations/queues/q%201', expect.any(Object));
  });

  it('lists items with status filter as a query string', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [] }));
    await api.listItems('q1', { status: 'pending' });
    expect(mockFetch).toHaveBeenCalledWith('/api/annotations/queues/q1/items?status=pending', expect.any(Object));
  });

  it('claims an item via POST', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ item: { id: 'i1', status: 'in_review' } }));
    const res = await api.claimItem('i1');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/annotations/items/i1/claim');
    expect(init.method).toBe('POST');
    expect(res.item.status).toBe('in_review');
  });

  it('submits a score with the human-score body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ item: { id: 'i1', status: 'scored' }, event: { id: 'e1', hash: 'h', prevHash: null } }, 201));
    const res = await api.submitScore('i1', { verdict: 'pass', passed: true, score: 0.9, reasoning: 'looks good' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/annotations/items/i1/submit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ verdict: 'pass', passed: true, score: 0.9, reasoning: 'looks good' });
    expect(res.event.id).toBe('e1');
  });

  it('skips an item via POST', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ item: { id: 'i1', status: 'skipped' } }));
    await api.skipItem('i1');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/annotations/items/i1/skip');
    expect(init.method).toBe('POST');
  });
});

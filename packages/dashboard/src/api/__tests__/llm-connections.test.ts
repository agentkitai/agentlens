// @vitest-environment jsdom
/**
 * LLM connections API client (#143).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ConnApi from '../llm-connections';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

let api: typeof ConnApi;

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../llm-connections');
});

describe('llm-connections API client', () => {
  it('lists connections', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ connections: [{ id: 'c1', keyLast4: '1234' }] }));
    const res = await api.listConnections();
    expect(mockFetch).toHaveBeenCalledWith('/api/llm-connections', expect.any(Object));
    expect(res.connections[0].keyLast4).toBe('1234');
  });

  it('creates a connection with the apiKey in the body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ connection: { id: 'c1', keyLast4: '9999' } }, 201));
    await api.createConnection({ provider: 'openai', name: 'P', apiKey: 'sk-secret-9999' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/llm-connections');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ provider: 'openai', name: 'P', apiKey: 'sk-secret-9999' });
  });

  it('tests and deletes a connection by id', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, model: 'gpt-4o' }));
    await api.testConnection('c 1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/llm-connections/c%201/test');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');

    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.deleteConnection('c1');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/llm-connections/c1');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });
});

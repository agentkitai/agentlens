/**
 * Tests for AgentLensClient.recall() (Story 6.1)
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentLensClient } from '../client.js';

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'als_test123',
    fetch: fetchFn,
  });
}

describe('AgentLensClient.recall', () => {
  it('sends query as URL param', async () => {
    const fn = mockFetch(200, { results: [], query: 'test', totalResults: 0 });
    const client = createClient(fn);

    await client.recall({ query: 'test search' });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/recall');
    expect(url).toContain('query=test+search');
  });

  it('sends optional params when provided', async () => {
    const fn = mockFetch(200, { results: [], query: 'test', totalResults: 0 });
    const client = createClient(fn);

    await client.recall({
      query: 'test',
      scope: 'lesson',
      agentId: 'agent-1',
      limit: 5,
      minScore: 0.7,
      from: '2025-01-01',
      to: '2025-01-31',
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('scope=lesson');
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('limit=5');
    expect(url).toContain('minScore=0.7');
    expect(url).toContain('from=2025-01-01');
    expect(url).toContain('to=2025-01-31');
  });

  it('returns typed RecallResult', async () => {
    const expected = {
      results: [
        { sourceType: 'event', sourceId: 'ev_1', score: 0.95, text: 'hello' },
      ],
      query: 'hello',
      totalResults: 1,
    };
    const fn = mockFetch(200, expected);
    const client = createClient(fn);

    const result = await client.recall({ query: 'hello' });
    expect(result.totalResults).toBe(1);
    expect(result.results[0]!.score).toBe(0.95);
    expect(result.query).toBe('hello');
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, { results: [], query: 'test', totalResults: 0 });
    const client = createClient(fn);

    await client.recall({ query: 'test' });

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});

// @vitest-environment jsdom
/**
 * Playground API client (#144).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as PgApi from '../playground';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

let api: typeof PgApi;

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../playground');
});

describe('playground API client', () => {
  it('runs a prompt and returns output + cost + latency', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ output: { content: 'hi', model: 'gpt-4o', usage: { inputTokens: 1, outputTokens: 1 } }, costUsd: 0.001, latencyMs: 50 }),
    );
    const res = await api.runPlayground({ connectionId: 'c1', model: 'gpt-4o', prompt: 'say hi' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/playground/run');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ connectionId: 'c1', model: 'gpt-4o', prompt: 'say hi' });
    expect(res.output.content).toBe('hi');
    expect(res.costUsd).toBe(0.001);
  });
});

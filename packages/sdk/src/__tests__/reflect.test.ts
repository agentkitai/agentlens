/**
 * Tests for AgentLensClient.reflect() (Story 6.1)
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

const sampleReflectResult = {
  analysis: 'error_patterns' as const,
  insights: [
    {
      type: 'error_pattern',
      summary: 'Timeout errors spike on Mondays',
      data: { count: 42, pattern: 'TIMEOUT' },
      confidence: 0.85,
    },
  ],
  metadata: {
    sessionsAnalyzed: 100,
    eventsAnalyzed: 5000,
    timeRange: { from: '2025-01-01', to: '2025-01-31' },
  },
};

describe('AgentLensClient.reflect', () => {
  it('sends analysis type as URL param', async () => {
    const fn = mockFetch(200, sampleReflectResult);
    const client = createClient(fn);

    await client.reflect({ analysis: 'error_patterns' });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/reflect');
    expect(url).toContain('analysis=error_patterns');
  });

  it('sends optional params when provided', async () => {
    const fn = mockFetch(200, sampleReflectResult);
    const client = createClient(fn);

    await client.reflect({
      analysis: 'cost_analysis',
      agentId: 'agent-1',
      from: '2025-01-01',
      to: '2025-01-31',
      limit: 50,
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('analysis=cost_analysis');
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('from=2025-01-01');
    expect(url).toContain('to=2025-01-31');
    expect(url).toContain('limit=50');
  });

  it('returns typed ReflectResult', async () => {
    const fn = mockFetch(200, sampleReflectResult);
    const client = createClient(fn);

    const result = await client.reflect({ analysis: 'error_patterns' });
    expect(result.analysis).toBe('error_patterns');
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]!.confidence).toBe(0.85);
    expect(result.metadata.sessionsAnalyzed).toBe(100);
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, sampleReflectResult);
    const client = createClient(fn);

    await client.reflect({ analysis: 'tool_sequences' });

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});

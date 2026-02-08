/**
 * Tests for AgentLensClient.getContext() (Story 6.1)
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

const sampleContextResult = {
  topic: 'deployment process',
  sessions: [
    {
      sessionId: 'ses_001',
      agentId: 'agent-1',
      startedAt: '2025-01-01T00:00:00Z',
      endedAt: '2025-01-01T01:00:00Z',
      summary: 'Deployed v2.0',
      relevanceScore: 0.92,
      keyEvents: [
        {
          id: 'ev_001',
          eventType: 'tool_call',
          summary: 'Called deploy tool',
          timestamp: '2025-01-01T00:30:00Z',
        },
      ],
    },
  ],
  lessons: [
    {
      id: 'les_001',
      title: 'Always run tests before deploy',
      content: 'Run the full test suite before deploying.',
      category: 'deployment',
      importance: 'high' as const,
      relevanceScore: 0.88,
    },
  ],
  summary: 'Context related to deployment process',
};

describe('AgentLensClient.getContext', () => {
  it('sends topic as URL param', async () => {
    const fn = mockFetch(200, sampleContextResult);
    const client = createClient(fn);

    await client.getContext({ topic: 'deployment process' });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/context');
    expect(url).toContain('topic=deployment+process');
  });

  it('sends optional params when provided', async () => {
    const fn = mockFetch(200, sampleContextResult);
    const client = createClient(fn);

    await client.getContext({
      topic: 'test',
      userId: 'user-1',
      agentId: 'agent-1',
      limit: 5,
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('userId=user-1');
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('limit=5');
  });

  it('returns typed ContextResult', async () => {
    const fn = mockFetch(200, sampleContextResult);
    const client = createClient(fn);

    const result = await client.getContext({ topic: 'deployment process' });
    expect(result.topic).toBe('deployment process');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.relevanceScore).toBe(0.92);
    expect(result.sessions[0]!.keyEvents).toHaveLength(1);
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0]!.relevanceScore).toBe(0.88);
    expect(result.summary).toBe('Context related to deployment process');
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, sampleContextResult);
    const client = createClient(fn);

    await client.getContext({ topic: 'test' });

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});

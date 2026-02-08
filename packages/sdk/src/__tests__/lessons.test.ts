/**
 * Tests for AgentLensClient lesson methods (Story 6.1)
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

const sampleLesson = {
  id: 'les_001',
  tenantId: 'tenant_1',
  agentId: 'agent_1',
  category: 'error-handling',
  title: 'Always retry on timeout',
  content: 'When a tool call times out, retry once before failing.',
  context: {},
  importance: 'high' as const,
  accessCount: 3,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('AgentLensClient.createLesson', () => {
  it('sends POST to /api/lessons', async () => {
    const fn = mockFetch(200, sampleLesson);
    const client = createClient(fn);

    await client.createLesson({
      title: 'Always retry on timeout',
      content: 'When a tool call times out, retry once before failing.',
      category: 'error-handling',
      importance: 'high',
    });

    const [url, opts] = (fn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('/api/lessons');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('Always retry on timeout');
    expect(body.importance).toBe('high');
  });

  it('returns the created Lesson', async () => {
    const fn = mockFetch(200, sampleLesson);
    const client = createClient(fn);

    const result = await client.createLesson({
      title: 'Always retry on timeout',
      content: 'Content',
    });
    expect(result.id).toBe('les_001');
    expect(result.importance).toBe('high');
  });
});

describe('AgentLensClient.getLessons', () => {
  it('sends GET to /api/lessons with no params by default', async () => {
    const fn = mockFetch(200, { lessons: [], total: 0 });
    const client = createClient(fn);

    await client.getLessons();

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/lessons');
  });

  it('sends filter params when provided', async () => {
    const fn = mockFetch(200, { lessons: [], total: 0 });
    const client = createClient(fn);

    await client.getLessons({
      category: 'error-handling',
      importance: 'high',
      search: 'timeout',
      limit: 10,
      offset: 5,
      includeArchived: true,
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('category=error-handling');
    expect(url).toContain('importance=high');
    expect(url).toContain('search=timeout');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=5');
    expect(url).toContain('includeArchived=true');
  });

  it('returns lessons and total', async () => {
    const fn = mockFetch(200, { lessons: [sampleLesson], total: 1 });
    const client = createClient(fn);

    const result = await client.getLessons();
    expect(result.total).toBe(1);
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0]!.id).toBe('les_001');
  });
});

describe('AgentLensClient.getLesson', () => {
  it('sends GET to /api/lessons/:id', async () => {
    const fn = mockFetch(200, sampleLesson);
    const client = createClient(fn);

    const result = await client.getLesson('les_001');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/lessons/les_001');
    expect(result.id).toBe('les_001');
  });
});

describe('AgentLensClient.updateLesson', () => {
  it('sends PUT to /api/lessons/:id', async () => {
    const updated = { ...sampleLesson, title: 'Updated title' };
    const fn = mockFetch(200, updated);
    const client = createClient(fn);

    await client.updateLesson('les_001', { title: 'Updated title' });

    const [url, opts] = (fn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('/api/lessons/les_001');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('Updated title');
  });
});

describe('AgentLensClient.deleteLesson', () => {
  it('sends DELETE to /api/lessons/:id', async () => {
    const fn = mockFetch(200, { id: 'les_001', archived: true });
    const client = createClient(fn);

    const result = await client.deleteLesson('les_001');

    const [url, opts] = (fn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('/api/lessons/les_001');
    expect(opts.method).toBe('DELETE');
    expect(result.archived).toBe(true);
  });
});

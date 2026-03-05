/**
 * Tests for Lore Read Adapter + Proxy Routes (v0.5.0 integration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { fromLoreLesson, LoreReadAdapter, LoreError, createLoreAdapter } from '../lib/lore-client.js';
import { loreProxyRoutes } from '../routes/lore-proxy.js';

// ─── fromLoreLesson mapping ─────────────────────────────

describe('fromLoreLesson', () => {
  it('maps problem → content and meta.type → type', () => {
    const result = fromLoreLesson({
      id: '01',
      problem: 'Always use retry logic',
      resolution: 'Always use retry logic',
      context: 'API calls',
      tags: ['reliability'],
      confidence: 0.9,
      source: 'agent-1',
      project: 'my-project',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      expires_at: null,
      upvotes: 3,
      downvotes: 1,
      meta: { type: 'lesson', custom: 'value' },
    });

    expect(result).toEqual({
      id: '01',
      content: 'Always use retry logic',
      type: 'lesson',
      context: 'API calls',
      tags: ['reliability'],
      confidence: 0.9,
      source: 'agent-1',
      project: 'my-project',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      expiresAt: null,
      upvotes: 3,
      downvotes: 1,
      metadata: { custom: 'value' },
    });
  });

  it('stores resolution in metadata._resolution when different from problem', () => {
    const result = fromLoreLesson({
      id: '02',
      problem: 'Timeout errors',
      resolution: 'Add 30s timeout to all API calls',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      meta: {},
    });

    expect(result.content).toBe('Timeout errors');
    expect(result.metadata).toEqual({ _resolution: 'Add 30s timeout to all API calls' });
  });

  it('does not store _resolution when resolution === problem', () => {
    const result = fromLoreLesson({
      id: '03',
      problem: 'Same content',
      resolution: 'Same content',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      meta: {},
    });

    expect(result.metadata).toBeNull();
  });

  it('defaults missing fields correctly', () => {
    const result = fromLoreLesson({
      id: '04',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    expect(result.content).toBe('');
    expect(result.type).toBe('general');
    expect(result.context).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBeNull();
    expect(result.project).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(result.upvotes).toBe(0);
    expect(result.downvotes).toBe(0);
    expect(result.metadata).toBeNull();
  });

  it('handles null meta gracefully', () => {
    const result = fromLoreLesson({
      id: '05',
      problem: 'test',
      resolution: 'test',
      meta: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    expect(result.type).toBe('general');
    expect(result.metadata).toBeNull();
  });
});

// ─── createLoreAdapter factory ──────────────────────────

describe('createLoreAdapter', () => {
  it('returns null when disabled', () => {
    const adapter = createLoreAdapter({ loreEnabled: false });
    expect(adapter).toBeNull();
  });

  it('returns null when loreEnabled is undefined', () => {
    const adapter = createLoreAdapter({});
    expect(adapter).toBeNull();
  });

  it('returns LoreReadAdapter when enabled with url and key', () => {
    const adapter = createLoreAdapter({
      loreEnabled: true,
      loreApiUrl: 'http://localhost:8765',
      loreApiKey: 'test-key',
    });
    expect(adapter).toBeInstanceOf(LoreReadAdapter);
  });

  it('throws when enabled but missing URL', () => {
    expect(() => createLoreAdapter({
      loreEnabled: true,
      loreApiKey: 'test-key',
    })).toThrow('LORE_API_URL');
  });

  it('throws when enabled but missing API key', () => {
    expect(() => createLoreAdapter({
      loreEnabled: true,
      loreApiUrl: 'http://localhost:8765',
    })).toThrow('LORE_API_KEY');
  });
});

// ─── LoreReadAdapter ────────────────────────────────────

describe('LoreReadAdapter', () => {
  it('adds Authorization header to all requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lessons: [], total: 0, limit: 50, offset: 0 }), { status: 200 }),
    );
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'mykey' });
    await adapter.listMemories({});

    expect(fetchSpy.mock.calls[0][1]!.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer mykey' }),
    );

    fetchSpy.mockRestore();
  });

  it('listMemories maps Lore response to LoreListResponse', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        lessons: [{ id: '01', problem: 'test', resolution: 'test', meta: { type: 'lesson' }, created_at: 't', updated_at: 't' }],
        total: 1, limit: 50, offset: 0,
      }), { status: 200 }),
    );
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'key' });
    const result = await adapter.listMemories({ search: 'hello', limit: 10 });

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].content).toBe('test');
    expect(result.memories[0].type).toBe('lesson');
    expect(result.total).toBe(1);

    // Verify query params
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('query=hello');
    expect(url).toContain('limit=10');

    fetchSpy.mockRestore();
  });

  it('getMemory returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 }),
    );
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'key' });
    const result = await adapter.getMemory('missing');
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it('throws LoreError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'bad' });
    await expect(adapter.listMemories({})).rejects.toThrow(LoreError);

    vi.restoreAllMocks();
  });

  it('checkHealth returns true on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'key' });
    expect(await adapter.checkHealth()).toBe(true);

    vi.restoreAllMocks();
  });

  it('checkHealth returns false on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'key' });
    expect(await adapter.checkHealth()).toBe(false);

    vi.restoreAllMocks();
  });
});

// ─── Proxy Routes ───────────────────────────────────────

describe('Lore proxy routes', () => {
  let adapter: LoreReadAdapter;
  let app: Hono;

  beforeEach(() => {
    adapter = new LoreReadAdapter({ apiUrl: 'http://lore:8765', apiKey: 'key' });
    app = new Hono();
    app.route('/api/lore', loreProxyRoutes(adapter));
  });

  it('GET /api/lore/memories returns mapped memories', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        lessons: [{ id: '01', problem: 'mem', resolution: 'mem', meta: {}, created_at: 't', updated_at: 't' }],
        total: 1, limit: 50, offset: 0,
      }), { status: 200 }),
    );

    const res = await app.request('/api/lore/memories?search=test&limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].content).toBe('mem');

    vi.restoreAllMocks();
  });

  it('GET /api/lore/memories/:id returns single memory', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: '01', problem: 'found', resolution: 'found', meta: { type: 'code' },
        created_at: 't', updated_at: 't',
      }), { status: 200 }),
    );

    const res = await app.request('/api/lore/memories/01');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('found');
    expect(body.type).toBe('code');

    vi.restoreAllMocks();
  });

  it('GET /api/lore/memories/:id returns 404 for missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 }),
    );

    const res = await app.request('/api/lore/memories/missing');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');

    vi.restoreAllMocks();
  });

  it('GET /api/lore/stats returns aggregated stats', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        lessons: [
          { id: '1', meta: { type: 'lesson' } },
          { id: '2', meta: { type: 'lesson' } },
          { id: '3', meta: { type: 'code' } },
        ],
        total: 3, limit: 200, offset: 0,
      }), { status: 200 }),
    );

    const res = await app.request('/api/lore/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.byType).toEqual({ lesson: 2, code: 1 });

    vi.restoreAllMocks();
  });

  it('returns 502 on Lore auth failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const res = await app.request('/api/lore/memories');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('LORE_AUTH_ERROR');

    vi.restoreAllMocks();
  });

  it('returns 502 on Lore server error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal error', { status: 500 }),
    );

    const res = await app.request('/api/lore/memories');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('LORE_SERVER_ERROR');

    vi.restoreAllMocks();
  });
});

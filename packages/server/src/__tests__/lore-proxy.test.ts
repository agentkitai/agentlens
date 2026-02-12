/**
 * Tests for Batch 2: Lore Adapter + Proxy Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { LoreAdapter } from '../lib/lore-client.js';
import { RemoteLoreAdapter, LoreError, createLoreAdapter } from '../lib/lore-client.js';
import { loreProxyRoutes, loreCommunityProxyRoutes } from '../routes/lore-proxy.js';

// ─── Mock Adapter ────────────────────────────────────────

function createMockAdapter(): LoreAdapter & { [K in keyof LoreAdapter]: ReturnType<typeof vi.fn> } {
  return {
    createLesson: vi.fn(),
    listLessons: vi.fn(),
    getLesson: vi.fn(),
    updateLesson: vi.fn(),
    deleteLesson: vi.fn(),
    searchCommunity: vi.fn(),
  };
}

// ─── Proxy Routes ────────────────────────────────────────

describe('Lore proxy routes', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let app: Hono;

  beforeEach(() => {
    adapter = createMockAdapter();
    app = new Hono();
    app.route('/api/lessons', loreProxyRoutes(adapter));
    app.route('/api/community', loreCommunityProxyRoutes(adapter));
  });

  it('POST /api/lessons creates a lesson', async () => {
    adapter.createLesson.mockResolvedValue({ id: '1', title: 'Test' });
    const res = await app.request('/api/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', content: 'Body' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '1', title: 'Test' });
    expect(adapter.createLesson).toHaveBeenCalledWith({ title: 'Test', content: 'Body' });
  });

  it('GET /api/lessons lists lessons with query params', async () => {
    adapter.listLessons.mockResolvedValue({ lessons: [], total: 0, hasMore: false });
    const res = await app.request('/api/lessons?category=error&limit=10');
    expect(res.status).toBe(200);
    expect(adapter.listLessons).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'error', limit: 10 }),
    );
  });

  it('GET /api/lessons/:id gets a lesson', async () => {
    adapter.getLesson.mockResolvedValue({ id: 'abc', title: 'Found' });
    const res = await app.request('/api/lessons/abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'abc', title: 'Found' });
  });

  it('PUT /api/lessons/:id updates a lesson', async () => {
    adapter.updateLesson.mockResolvedValue({ id: 'abc', title: 'Updated' });
    const res = await app.request('/api/lessons/abc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(res.status).toBe(200);
    expect(adapter.updateLesson).toHaveBeenCalledWith('abc', { title: 'Updated' });
  });

  it('DELETE /api/lessons/:id deletes a lesson', async () => {
    adapter.deleteLesson.mockResolvedValue({ id: 'abc', archived: true });
    const res = await app.request('/api/lessons/abc', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'abc', archived: true });
  });

  it('GET /api/community/search searches community', async () => {
    adapter.searchCommunity.mockResolvedValue({ lessons: [], total: 0 });
    const res = await app.request('/api/community/search?q=test&limit=5');
    expect(res.status).toBe(200);
    expect(adapter.searchCommunity).toHaveBeenCalledWith('test', { limit: 5 });
  });

  it('returns 404 from adapter as proper HTTP status', async () => {
    adapter.getLesson.mockRejectedValue(new LoreError(404, 'Not found'));
    const res = await app.request('/api/lessons/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('returns 500 for unexpected errors', async () => {
    adapter.listLessons.mockRejectedValue(new Error('Connection refused'));
    const res = await app.request('/api/lessons');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Connection refused' });
  });
});

// ─── Adapter Factory ─────────────────────────────────────

describe('createLoreAdapter', () => {
  it('creates RemoteLoreAdapter for remote mode', () => {
    const adapter = createLoreAdapter({ loreMode: 'remote', loreApiUrl: 'http://localhost:3000', loreApiKey: 'key' });
    expect(adapter).toBeInstanceOf(RemoteLoreAdapter);
  });

  it('throws if remote mode without URL', () => {
    expect(() => createLoreAdapter({ loreMode: 'remote' })).toThrow('LORE_API_URL is required');
  });

  it('throws for local mode (lore-sdk not installed)', () => {
    expect(() => createLoreAdapter({ loreMode: 'local' })).toThrow('lore-sdk is not installed');
  });
});

// ─── RemoteLoreAdapter format mapping ────────────────────

describe('RemoteLoreAdapter', () => {
  it('maps title/content to problem/resolution in requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ problem: 'T', resolution: 'C', tags: ['cat'] }), { status: 200 }),
    );
    const adapter = new RemoteLoreAdapter('http://lore:3000', 'key');
    const result = await adapter.createLesson({ title: 'T', content: 'C', category: 'cat' });

    // Verify request body mapping
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(callBody).toEqual({ problem: 'T', resolution: 'C', tags: ['cat'] });

    // Verify response mapping back
    expect(result).toEqual({ title: 'T', content: 'C', category: 'cat' });

    fetchSpy.mockRestore();
  });

  it('adds Authorization header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lessons: [], total: 0, hasMore: false }), { status: 200 }),
    );
    const adapter = new RemoteLoreAdapter('http://lore:3000', 'mykey');
    await adapter.listLessons({});

    expect(fetchSpy.mock.calls[0][1]!.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer mykey' }),
    );

    fetchSpy.mockRestore();
  });

  it('throws LoreError on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad request', { status: 400 }),
    );
    const adapter = new RemoteLoreAdapter('http://lore:3000', 'key');
    await expect(adapter.getLesson('1')).rejects.toThrow(LoreError);

    fetchSpy.mockRestore();
  });
});

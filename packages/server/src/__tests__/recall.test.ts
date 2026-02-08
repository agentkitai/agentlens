/**
 * Tests for GET /api/recall endpoint (Story 2.6)
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { EmbeddingService } from '../lib/embeddings/index.js';

function createMockEmbeddingService(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
    embedBatch: vi.fn().mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])]),
    dimensions: 3,
    modelName: 'test-model',
  };
}

describe('GET /api/recall (Story 2.6)', () => {
  it('returns 503 when embedding service is not configured', async () => {
    const { app, apiKey } = createTestApp();
    // Default: no embedding service configured
    const res = await app.request('/api/recall?query=test', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('Embedding service not configured');
  });

  it('returns 400 when query parameter is missing', async () => {
    const { app, apiKey, db } = createTestApp();
    // We need an app with embedding service configured
    // But for this test, even without it, the 503 will trigger before 400
    // Let's create a custom app
    const { createApp } = await import('../index.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const store = new SqliteEventStore(db);
    const mockService = createMockEmbeddingService();

    const appWithEmbeddings = createApp(store, {
      authDisabled: true,
      db,
      embeddingService: mockService,
    });

    const res = await appWithEmbeddings.request('/api/recall');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('query parameter is required');
  });

  it('returns results with correct structure', async () => {
    const { db } = createTestApp();
    const { createApp } = await import('../index.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const { EmbeddingStore } = await import('../db/embedding-store.js');
    const store = new SqliteEventStore(db);
    const embeddingStore = new EmbeddingStore(db);
    const mockService = createMockEmbeddingService();

    // Pre-populate an embedding
    await embeddingStore.store(
      'default',
      'event',
      'ev-123',
      'tool_error: readFile - File not found',
      new Float32Array([0.1, 0.2, 0.3]), // same vector as mock returns
      'test-model',
      3,
    );

    const appWithEmbeddings = createApp(store, {
      authDisabled: true,
      db,
      embeddingService: mockService,
    });

    const res = await appWithEmbeddings.request('/api/recall?query=file+error');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      results: Array<{
        sourceType: string;
        sourceId: string;
        score: number;
        text: string;
        metadata: Record<string, unknown>;
      }>;
      query: string;
      totalResults: number;
    };

    expect(body.query).toBe('file error');
    expect(body.totalResults).toBeGreaterThanOrEqual(1);
    expect(body.results[0]).toHaveProperty('sourceType', 'event');
    expect(body.results[0]).toHaveProperty('sourceId', 'ev-123');
    expect(body.results[0]).toHaveProperty('score');
    expect(body.results[0]).toHaveProperty('text');
    expect(body.results[0]).toHaveProperty('metadata');
  });

  it('respects scope parameter', async () => {
    const { db } = createTestApp();
    const { createApp } = await import('../index.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const { EmbeddingStore } = await import('../db/embedding-store.js');
    const store = new SqliteEventStore(db);
    const embeddingStore = new EmbeddingStore(db);
    const mockService = createMockEmbeddingService();

    // Insert embeddings for different source types
    await embeddingStore.store(
      'default', 'event', 'ev-1', 'event text',
      new Float32Array([0.1, 0.2, 0.3]), 'test-model', 3,
    );
    await embeddingStore.store(
      'default', 'lesson', 'les-1', 'lesson text',
      new Float32Array([0.1, 0.2, 0.3]), 'test-model', 3,
    );

    const appWithEmbeddings = createApp(store, {
      authDisabled: true,
      db,
      embeddingService: mockService,
    });

    // Search only lessons
    const res = await appWithEmbeddings.request('/api/recall?query=test&scope=lessons');
    expect(res.status).toBe(200);

    const body = await res.json() as { results: Array<{ sourceType: string }>; totalResults: number };
    // All results should be lessons
    for (const r of body.results) {
      expect(r.sourceType).toBe('lesson');
    }
  });

  it('respects limit parameter', async () => {
    const { db } = createTestApp();
    const { createApp } = await import('../index.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const { EmbeddingStore } = await import('../db/embedding-store.js');
    const store = new SqliteEventStore(db);
    const embeddingStore = new EmbeddingStore(db);
    const mockService = createMockEmbeddingService();

    // Insert several embeddings
    for (let i = 0; i < 5; i++) {
      await embeddingStore.store(
        'default', 'event', `ev-${i}`, `text ${i}`,
        new Float32Array([0.1, 0.2, 0.3]), 'test-model', 3,
      );
    }

    const appWithEmbeddings = createApp(store, {
      authDisabled: true,
      db,
      embeddingService: mockService,
    });

    const res = await appWithEmbeddings.request('/api/recall?query=test&limit=2');
    expect(res.status).toBe(200);

    const body = await res.json() as { results: Array<unknown>; totalResults: number };
    expect(body.results.length).toBeLessThanOrEqual(2);
  });

  it('requires auth when auth is enabled', async () => {
    const { app } = createTestApp({ authDisabled: false });
    const res = await app.request('/api/recall?query=test');
    expect(res.status).toBe(401);
  });

  it('returns empty results for unmatched queries', async () => {
    const { db } = createTestApp();
    const { createApp } = await import('../index.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const store = new SqliteEventStore(db);
    const mockService = createMockEmbeddingService();

    const appWithEmbeddings = createApp(store, {
      authDisabled: true,
      db,
      embeddingService: mockService,
    });

    const res = await appWithEmbeddings.request('/api/recall?query=nothing+here');
    expect(res.status).toBe(200);

    const body = await res.json() as { results: Array<unknown>; totalResults: number };
    expect(body.results).toEqual([]);
    expect(body.totalResults).toBe(0);
  });
});

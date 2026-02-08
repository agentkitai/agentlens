/**
 * Tests for EmbeddingStore (Story 2.2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { EmbeddingStore } from '../embedding-store.js';
import type { SqliteDb } from '../index.js';

// Helper: create a deterministic Float32Array embedding
function makeEmbedding(seed: number, dims = 4): Float32Array {
  const arr = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  return arr;
}

// Helper: normalize a vector (unit length)
function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

describe('EmbeddingStore', () => {
  let db: SqliteDb;
  let store: EmbeddingStore;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new EmbeddingStore(db);
  });

  describe('store()', () => {
    it('stores an embedding and returns an ID', async () => {
      const emb = makeEmbedding(1);
      const id = await store.store('tenant1', 'event', 'evt-1', 'test text', emb, 'test-model', 4);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('deduplicates by content hash (same text, same tenant)', async () => {
      const emb1 = makeEmbedding(1);
      const emb2 = makeEmbedding(2);
      const id1 = await store.store('tenant1', 'event', 'evt-1', 'same text', emb1, 'model', 4);
      const id2 = await store.store('tenant1', 'event', 'evt-2', 'same text', emb2, 'model', 4);
      // Should return the same ID (updated in place)
      expect(id2).toBe(id1);
      // Count should still be 1
      const count = await store.count('tenant1');
      expect(count).toBe(1);
    });

    it('does NOT deduplicate across tenants', async () => {
      const emb = makeEmbedding(1);
      const id1 = await store.store('tenant1', 'event', 'evt-1', 'same text', emb, 'model', 4);
      const id2 = await store.store('tenant2', 'event', 'evt-1', 'same text', emb, 'model', 4);
      expect(id1).not.toBe(id2);
    });

    it('stores different texts as separate embeddings', async () => {
      const emb1 = makeEmbedding(1);
      const emb2 = makeEmbedding(2);
      await store.store('tenant1', 'event', 'evt-1', 'text one', emb1, 'model', 4);
      await store.store('tenant1', 'event', 'evt-2', 'text two', emb2, 'model', 4);
      const count = await store.count('tenant1');
      expect(count).toBe(2);
    });
  });

  describe('getBySource()', () => {
    it('returns stored embedding with correct fields', async () => {
      const emb = makeEmbedding(42);
      await store.store('tenant1', 'session', 'sess-1', 'session summary', emb, 'all-MiniLM-L6-v2', 4);

      const result = await store.getBySource('tenant1', 'session', 'sess-1');
      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe('tenant1');
      expect(result!.sourceType).toBe('session');
      expect(result!.sourceId).toBe('sess-1');
      expect(result!.textContent).toBe('session summary');
      expect(result!.embeddingModel).toBe('all-MiniLM-L6-v2');
      expect(result!.dimensions).toBe(4);
      expect(result!.embedding.length).toBe(4);
      // Verify vector content survived serialization round-trip
      for (let i = 0; i < 4; i++) {
        expect(result!.embedding[i]).toBeCloseTo(emb[i]!, 5);
      }
    });

    it('returns null for non-existent source', async () => {
      const result = await store.getBySource('tenant1', 'event', 'nonexistent');
      expect(result).toBeNull();
    });

    it('enforces tenant isolation on getBySource', async () => {
      const emb = makeEmbedding(1);
      await store.store('tenant1', 'event', 'evt-1', 'text', emb, 'model', 4);
      const result = await store.getBySource('tenant2', 'event', 'evt-1');
      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    it('deletes existing embedding', async () => {
      const emb = makeEmbedding(1);
      await store.store('tenant1', 'event', 'evt-1', 'text', emb, 'model', 4);
      const deleted = await store.delete('tenant1', 'event', 'evt-1');
      expect(deleted).toBe(1);
      const result = await store.getBySource('tenant1', 'event', 'evt-1');
      expect(result).toBeNull();
    });

    it('returns 0 for non-existent source', async () => {
      const deleted = await store.delete('tenant1', 'event', 'nonexistent');
      expect(deleted).toBe(0);
    });

    it('delete is tenant-scoped', async () => {
      const emb = makeEmbedding(1);
      await store.store('tenant1', 'event', 'evt-1', 'text', emb, 'model', 4);
      // Try to delete from different tenant
      const deleted = await store.delete('tenant2', 'event', 'evt-1');
      expect(deleted).toBe(0);
      // Original still exists
      const result = await store.getBySource('tenant1', 'event', 'evt-1');
      expect(result).not.toBeNull();
    });
  });

  describe('count()', () => {
    it('returns 0 for empty tenant', async () => {
      const count = await store.count('tenant1');
      expect(count).toBe(0);
    });

    it('counts only the specified tenant', async () => {
      const emb = makeEmbedding(1);
      await store.store('tenant1', 'event', 'evt-1', 'text1', emb, 'model', 4);
      await store.store('tenant1', 'event', 'evt-2', 'text2', emb, 'model', 4);
      await store.store('tenant2', 'event', 'evt-3', 'text3', emb, 'model', 4);

      expect(await store.count('tenant1')).toBe(2);
      expect(await store.count('tenant2')).toBe(1);
    });
  });

  describe('similaritySearch()', () => {
    it('returns results sorted by similarity score', async () => {
      // Store embeddings with known similarity relationships
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const similar = normalize(new Float32Array([0.9, 0.1, 0, 0]));
      const lessSimilar = normalize(new Float32Array([0.5, 0.5, 0, 0]));
      const dissimilar = normalize(new Float32Array([0, 0, 0, 1]));

      await store.store('t1', 'event', 'evt-similar', 'similar', similar, 'model', 4);
      await store.store('t1', 'event', 'evt-less', 'less similar', lessSimilar, 'model', 4);
      await store.store('t1', 'event', 'evt-dissimilar', 'dissimilar', dissimilar, 'model', 4);

      const results = await store.similaritySearch('t1', query);
      expect(results.length).toBe(3);
      expect(results[0]!.sourceId).toBe('evt-similar');
      expect(results[1]!.sourceId).toBe('evt-less');
      expect(results[2]!.sourceId).toBe('evt-dissimilar');
      // Scores should be descending
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
      expect(results[1]!.score).toBeGreaterThan(results[2]!.score);
    });

    it('filters by minScore', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const similar = normalize(new Float32Array([0.99, 0.01, 0, 0]));
      const dissimilar = normalize(new Float32Array([0, 0, 0, 1]));

      await store.store('t1', 'event', 'evt-1', 'similar', similar, 'model', 4);
      await store.store('t1', 'event', 'evt-2', 'dissimilar', dissimilar, 'model', 4);

      const results = await store.similaritySearch('t1', query, { minScore: 0.5 });
      expect(results.length).toBe(1);
      expect(results[0]!.sourceId).toBe('evt-1');
    });

    it('respects limit parameter', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      for (let i = 0; i < 5; i++) {
        const v = normalize(new Float32Array([1 - i * 0.1, i * 0.1, 0, 0]));
        await store.store('t1', 'event', `evt-${i}`, `text ${i}`, v, 'model', 4);
      }

      const results = await store.similaritySearch('t1', query, { limit: 2 });
      expect(results.length).toBe(2);
    });

    it('filters by sourceType', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const emb = normalize(new Float32Array([0.9, 0.1, 0, 0]));

      await store.store('t1', 'event', 'evt-1', 'event text', emb, 'model', 4);
      await store.store('t1', 'session', 'sess-1', 'session text', emb, 'model', 4);
      await store.store('t1', 'lesson', 'lesson-1', 'lesson text', emb, 'model', 4);

      const results = await store.similaritySearch('t1', query, { sourceType: 'session' });
      expect(results.length).toBe(1);
      expect(results[0]!.sourceType).toBe('session');
    });

    it('enforces tenant isolation in search', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const emb = normalize(new Float32Array([0.99, 0.01, 0, 0]));

      await store.store('tenant1', 'event', 'evt-1', 'text', emb, 'model', 4);
      await store.store('tenant2', 'event', 'evt-2', 'text2', emb, 'model', 4);

      const results = await store.similaritySearch('tenant1', query);
      expect(results.length).toBe(1);
      expect(results[0]!.sourceId).toBe('evt-1');
    });

    it('returns empty array when no embeddings exist', async () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = await store.similaritySearch('t1', query);
      expect(results).toEqual([]);
    });

    it('filters by time range (from)', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const emb = normalize(new Float32Array([0.9, 0.1, 0, 0]));

      // Store with known created_at times
      await store.store('t1', 'event', 'evt-old', 'old text', emb, 'model', 4);

      // We need to test the time filter but store() sets created_at automatically.
      // Let's verify the search returns results for the default case.
      const results = await store.similaritySearch('t1', query, {
        from: '2000-01-01T00:00:00Z',
      });
      expect(results.length).toBe(1);

      // Future date should return no results
      const futureResults = await store.similaritySearch('t1', query, {
        from: '2099-01-01T00:00:00Z',
      });
      expect(futureResults.length).toBe(0);
    });

    it('filters by time range (to)', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const emb = normalize(new Float32Array([0.9, 0.1, 0, 0]));

      await store.store('t1', 'event', 'evt-1', 'text', emb, 'model', 4);

      // Past date should return no results
      const pastResults = await store.similaritySearch('t1', query, {
        to: '2000-01-01T00:00:00Z',
      });
      expect(pastResults.length).toBe(0);

      // Future date should return all results
      const futureResults = await store.similaritySearch('t1', query, {
        to: '2099-01-01T00:00:00Z',
      });
      expect(futureResults.length).toBe(1);
    });

    it('result includes text and metadata fields', async () => {
      const query = normalize(new Float32Array([1, 0, 0, 0]));
      const emb = normalize(new Float32Array([0.9, 0.1, 0, 0]));

      await store.store('t1', 'event', 'evt-1', 'hello world', emb, 'test-model', 4);

      const results = await store.similaritySearch('t1', query);
      expect(results.length).toBe(1);
      expect(results[0]!.text).toBe('hello world');
      expect(results[0]!.sourceType).toBe('event');
      expect(results[0]!.sourceId).toBe('evt-1');
      expect(results[0]!.embeddingModel).toBe('test-model');
      expect(typeof results[0]!.score).toBe('number');
      expect(typeof results[0]!.createdAt).toBe('string');
    });
  });

  describe('Float32Array serialization round-trip', () => {
    it('preserves embedding values through store/retrieve cycle', async () => {
      // Use a variety of float values including negatives and small numbers
      const original = new Float32Array([0.123456, -0.789012, 0.0000001, 999.999]);
      await store.store('t1', 'event', 'evt-1', 'test', original, 'model', 4);

      const retrieved = await store.getBySource('t1', 'event', 'evt-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.embedding.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(retrieved!.embedding[i]).toBeCloseTo(original[i]!, 5);
      }
    });

    it('handles 384-dimensional vectors (MiniLM)', async () => {
      const dims = 384;
      const emb = new Float32Array(dims);
      for (let i = 0; i < dims; i++) {
        emb[i] = Math.sin(i * 0.1) * 0.5;
      }
      await store.store('t1', 'event', 'evt-1', 'test', emb, 'model', dims);

      const retrieved = await store.getBySource('t1', 'event', 'evt-1');
      expect(retrieved!.embedding.length).toBe(dims);
      for (let i = 0; i < dims; i++) {
        expect(retrieved!.embedding[i]).toBeCloseTo(emb[i]!, 5);
      }
    });
  });
});

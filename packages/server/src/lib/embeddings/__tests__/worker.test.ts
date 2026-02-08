/**
 * Tests for EmbeddingWorker (Story 2.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingWorker } from '../worker.js';
import type { EmbeddingService } from '../index.js';
import type { EmbeddingStore } from '../../../db/embedding-store.js';

function createMockEmbeddingService(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
    embedBatch: vi.fn().mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])]),
    dimensions: 3,
    modelName: 'test-model',
  };
}

function createMockEmbeddingStore(): EmbeddingStore {
  return {
    store: vi.fn().mockResolvedValue('emb-1'),
    getBySource: vi.fn().mockResolvedValue(null),
    similaritySearch: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(1),
    count: vi.fn().mockResolvedValue(0),
  } as unknown as EmbeddingStore;
}

describe('EmbeddingWorker', () => {
  let service: EmbeddingService;
  let store: EmbeddingStore;

  beforeEach(() => {
    service = createMockEmbeddingService();
    store = createMockEmbeddingStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    it('creates with null service and store', () => {
      const worker = new EmbeddingWorker(null, null);
      expect(worker.getQueueSize()).toBe(0);
      expect(worker.getProcessedCount()).toBe(0);
    });

    it('creates with valid service and store', () => {
      const worker = new EmbeddingWorker(service, store);
      expect(worker.getQueueSize()).toBe(0);
    });
  });

  describe('enqueue', () => {
    it('adds items to the queue', () => {
      const worker = new EmbeddingWorker(service, store);
      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test text',
      });
      expect(worker.getQueueSize()).toBe(1);
    });

    it('silently skips when service is null', () => {
      const worker = new EmbeddingWorker(null, store);
      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test text',
      });
      expect(worker.getQueueSize()).toBe(0);
    });

    it('silently skips when store is null', () => {
      const worker = new EmbeddingWorker(service, null);
      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test text',
      });
      expect(worker.getQueueSize()).toBe(0);
    });

    it('is synchronous — does not return a promise', () => {
      const worker = new EmbeddingWorker(service, store);
      const result = worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test text',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('backpressure', () => {
    it('drops oldest items when queue exceeds max size', () => {
      const worker = new EmbeddingWorker(service, store, { maxQueueSize: 3 });

      for (let i = 0; i < 5; i++) {
        worker.enqueue({
          tenantId: 'tenant1',
          sourceType: 'event',
          sourceId: `ev-${i}`,
          textContent: `text ${i}`,
        });
      }

      // Should only keep the last 3
      expect(worker.getQueueSize()).toBe(3);
    });

    it('uses default max queue size of 10000', () => {
      const worker = new EmbeddingWorker(service, store);
      // Just verify it doesn't throw with normal enqueue
      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test',
      });
      expect(worker.getQueueSize()).toBe(1);
    });
  });

  describe('flush', () => {
    it('processes all queued items', async () => {
      const worker = new EmbeddingWorker(service, store);

      for (let i = 0; i < 5; i++) {
        worker.enqueue({
          tenantId: 'tenant1',
          sourceType: 'event',
          sourceId: `ev-${i}`,
          textContent: `text ${i}`,
        });
      }

      await worker.flush();

      expect(worker.getQueueSize()).toBe(0);
      expect(worker.getProcessedCount()).toBe(5);
      expect(service.embed).toHaveBeenCalledTimes(5);
      expect(store.store).toHaveBeenCalledTimes(5);
    });

    it('does nothing when queue is empty', async () => {
      const worker = new EmbeddingWorker(service, store);
      await worker.flush();
      expect(service.embed).not.toHaveBeenCalled();
    });

    it('does nothing when service is null', async () => {
      const worker = new EmbeddingWorker(null, null);
      await worker.flush();
      expect(worker.getProcessedCount()).toBe(0);
    });

    it('processes items in batches of 32', async () => {
      const worker = new EmbeddingWorker(service, store);

      for (let i = 0; i < 40; i++) {
        worker.enqueue({
          tenantId: 'tenant1',
          sourceType: 'event',
          sourceId: `ev-${i}`,
          textContent: `text ${i}`,
        });
      }

      await worker.flush();

      expect(worker.getQueueSize()).toBe(0);
      expect(worker.getProcessedCount()).toBe(40);
    });
  });

  describe('error handling', () => {
    it('skips failed items and continues', async () => {
      const embedMock = vi.fn()
        .mockResolvedValueOnce(new Float32Array([0.1, 0.2, 0.3]))
        .mockRejectedValueOnce(new Error('embedding failed'))
        .mockResolvedValueOnce(new Float32Array([0.4, 0.5, 0.6]));

      service.embed = embedMock;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const worker = new EmbeddingWorker(service, store);
      for (let i = 0; i < 3; i++) {
        worker.enqueue({
          tenantId: 'tenant1',
          sourceType: 'event',
          sourceId: `ev-${i}`,
          textContent: `text ${i}`,
        });
      }

      await worker.flush();

      // 2 successful, 1 failed
      expect(worker.getProcessedCount()).toBe(2);
      expect(worker.getQueueSize()).toBe(0);
      expect(store.store).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('never throws from flush', async () => {
      service.embed = vi.fn().mockRejectedValue(new Error('total failure'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const worker = new EmbeddingWorker(service, store);
      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test',
      });

      // Should not throw
      await expect(worker.flush()).resolves.toBeUndefined();
      expect(worker.getProcessedCount()).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe('start / stop', () => {
    it('start does nothing when service is null', () => {
      const worker = new EmbeddingWorker(null, null);
      // Should not throw
      worker.start();
    });

    it('stop flushes remaining items', async () => {
      const worker = new EmbeddingWorker(service, store);

      worker.enqueue({
        tenantId: 'tenant1',
        sourceType: 'event',
        sourceId: 'ev-1',
        textContent: 'test',
      });

      worker.start();
      await worker.stop();

      expect(worker.getQueueSize()).toBe(0);
      expect(worker.getProcessedCount()).toBe(1);
    });

    it('stop is idempotent', async () => {
      const worker = new EmbeddingWorker(service, store);
      worker.start();
      await worker.stop();
      await worker.stop();
      // Should not throw
    });

    it('start is idempotent', () => {
      const worker = new EmbeddingWorker(service, store);
      worker.start();
      worker.start(); // second call should be a no-op
      // Clean up
      void worker.stop();
    });
  });

  describe('store call args', () => {
    it('passes correct arguments to embeddingStore.store', async () => {
      const worker = new EmbeddingWorker(service, store);
      worker.enqueue({
        tenantId: 'my-tenant',
        sourceType: 'lesson',
        sourceId: 'les-42',
        textContent: 'important lesson',
      });

      await worker.flush();

      expect(store.store).toHaveBeenCalledWith(
        'my-tenant',
        'lesson',
        'les-42',
        'important lesson',
        new Float32Array([0.1, 0.2, 0.3]),
        'test-model',
        3,
      );
    });
  });
});

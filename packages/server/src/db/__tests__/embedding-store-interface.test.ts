/**
 * Test that EmbeddingStore (SQLite) implements IEmbeddingStore correctly (Story 2)
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingStore } from '../embedding-store.js';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';

describe('EmbeddingStore implements IEmbeddingStore', () => {
  it('has all required methods', () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new EmbeddingStore(db);

    expect(typeof store.store).toBe('function');
    expect(typeof store.getBySource).toBe('function');
    expect(typeof store.similaritySearch).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(typeof store.count).toBe('function');
  });

  it('store and retrieve work with await (Promise-compatible)', async () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new EmbeddingStore(db);

    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    const id = await store.store('t1', 'event', 'e1', 'hello', embedding, 'test-model', 3);
    expect(typeof id).toBe('string');

    const result = await store.getBySource('t1', 'event', 'e1');
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('hello');

    const count = await store.count('t1');
    expect(count).toBe(1);

    const deleted = await store.delete('t1', 'event', 'e1');
    expect(deleted).toBe(1);
  });
});

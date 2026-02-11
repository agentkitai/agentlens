import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPoolStore } from '../store.js';
import type { ShareLessonInput } from '../types.js';

function makeLesson(overrides: Partial<ShareLessonInput> = {}): ShareLessonInput {
  return {
    anonymousContributorId: overrides.anonymousContributorId ?? 'contrib-1',
    category: overrides.category ?? 'testing',
    title: overrides.title ?? 'Test Lesson',
    content: overrides.content ?? 'content',
    embedding: overrides.embedding ?? [1, 0, 0],
    qualitySignals: {},
  };
}

describe('InMemoryPoolStore secondary indexes', () => {
  let store: InMemoryPoolStore;

  beforeEach(() => {
    store = new InMemoryPoolStore();
  });

  // ─── Contributor index ───

  it('countLessonsByContributor uses index for O(1) lookup', async () => {
    await store.shareLesson(makeLesson({ anonymousContributorId: 'a' }));
    await store.shareLesson(makeLesson({ anonymousContributorId: 'a' }));
    await store.shareLesson(makeLesson({ anonymousContributorId: 'b' }));
    expect(await store.countLessonsByContributor('a')).toBe(2);
    expect(await store.countLessonsByContributor('b')).toBe(1);
    expect(await store.countLessonsByContributor('none')).toBe(0);
  });

  it('deleteLessonsByContributor cleans up indexes', async () => {
    await store.shareLesson(makeLesson({ anonymousContributorId: 'a', category: 'cat1' }));
    await store.shareLesson(makeLesson({ anonymousContributorId: 'a', category: 'cat1' }));
    await store.shareLesson(makeLesson({ anonymousContributorId: 'b', category: 'cat1' }));
    const deleted = await store.deleteLessonsByContributor('a');
    expect(deleted).toBe(2);
    expect(await store.countLessonsByContributor('a')).toBe(0);
    // category index should still have b's lesson
    const results = await store.searchLessons({ embedding: [1, 0, 0], category: 'cat1' });
    expect(results).toHaveLength(1);
  });

  // ─── Category index ───

  it('searchLessons uses category index for pre-filtering', async () => {
    await store.shareLesson(makeLesson({ category: 'alpha', embedding: [1, 0, 0] }));
    await store.shareLesson(makeLesson({ category: 'beta', embedding: [0, 1, 0] }));
    await store.shareLesson(makeLesson({ category: 'alpha', embedding: [0.9, 0.1, 0] }));

    const results = await store.searchLessons({ embedding: [1, 0, 0], category: 'alpha' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.lesson.category === 'alpha')).toBe(true);
  });

  it('searchLessons returns empty for non-existent category', async () => {
    await store.shareLesson(makeLesson({ category: 'alpha' }));
    const results = await store.searchLessons({ embedding: [1, 0, 0], category: 'nope' });
    expect(results).toHaveLength(0);
  });

  it('search pre-filters by category before cosine similarity', async () => {
    // beta lesson has perfect match embedding but wrong category
    await store.shareLesson(makeLesson({ category: 'beta', embedding: [1, 0, 0] }));
    await store.shareLesson(makeLesson({ category: 'alpha', embedding: [0, 1, 0] }));

    const results = await store.searchLessons({ embedding: [1, 0, 0], category: 'alpha' });
    expect(results).toHaveLength(1);
    expect(results[0].lesson.category).toBe('alpha');
  });

  // ─── Moderation queue pagination ───

  it('getModerationQueue returns all items by default', async () => {
    for (let i = 0; i < 5; i++) {
      const lesson = await store.shareLesson(makeLesson());
      await store.setLessonHidden(lesson.id, true);
    }
    const queue = await store.getModerationQueue();
    expect(queue).toHaveLength(5);
  });

  it('getModerationQueue supports limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      const lesson = await store.shareLesson(makeLesson({ title: `Lesson ${i}` }));
      await store.setLessonHidden(lesson.id, true);
    }
    const page1 = await store.getModerationQueue({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await store.getModerationQueue({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = await store.getModerationQueue({ limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);

    // No overlap
    const allIds = [...page1, ...page2, ...page3].map((r) => r.lesson.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('getModerationQueue with offset beyond range returns empty', async () => {
    const lesson = await store.shareLesson(makeLesson());
    await store.setLessonHidden(lesson.id, true);
    const result = await store.getModerationQueue({ offset: 10 });
    expect(result).toHaveLength(0);
  });

  // ─── maxLessons with LRU eviction ───

  it('evicts oldest lessons when maxLessons exceeded', async () => {
    const capped = new InMemoryPoolStore({ maxLessons: 3 });
    const l1 = await capped.shareLesson(makeLesson({ title: 'L1' }));
    const l2 = await capped.shareLesson(makeLesson({ title: 'L2' }));
    const l3 = await capped.shareLesson(makeLesson({ title: 'L3' }));
    // All 3 present
    expect(await capped.getLessonById(l1.id)).not.toBeNull();

    // Adding 4th evicts oldest (l1) — but getLessonById touched l1, so re-check
    // Reset to avoid LRU touch from above
    const capped2 = new InMemoryPoolStore({ maxLessons: 3 });
    const a = await capped2.shareLesson(makeLesson({ title: 'A' }));
    const b = await capped2.shareLesson(makeLesson({ title: 'B' }));
    const c = await capped2.shareLesson(makeLesson({ title: 'C' }));
    const d = await capped2.shareLesson(makeLesson({ title: 'D' }));
    // a should be evicted
    expect(await capped2.getLessonById(a.id)).toBeNull();
    expect(await capped2.getLessonById(b.id)).not.toBeNull();
    expect(await capped2.getLessonById(d.id)).not.toBeNull();
  });

  it('LRU eviction respects access order', async () => {
    const capped = new InMemoryPoolStore({ maxLessons: 3 });
    const a = await capped.shareLesson(makeLesson({ title: 'A' }));
    const b = await capped.shareLesson(makeLesson({ title: 'B' }));
    const c = await capped.shareLesson(makeLesson({ title: 'C' }));

    // Touch a, making b the least recently used
    await capped.getLessonById(a.id);

    const d = await capped.shareLesson(makeLesson({ title: 'D' }));
    // b should be evicted (LRU), a should survive
    expect(await capped.getLessonById(b.id)).toBeNull();
    expect(await capped.getLessonById(a.id)).not.toBeNull();
  });

  it('eviction cleans up contributor/category indexes', async () => {
    const capped = new InMemoryPoolStore({ maxLessons: 2 });
    await capped.shareLesson(makeLesson({ anonymousContributorId: 'x', category: 'cat' }));
    await capped.shareLesson(makeLesson({ anonymousContributorId: 'y', category: 'cat' }));
    // Evict first
    await capped.shareLesson(makeLesson({ anonymousContributorId: 'z', category: 'other' }));

    expect(await capped.countLessonsByContributor('x')).toBe(0);
  });
});

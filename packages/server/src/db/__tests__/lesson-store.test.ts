/**
 * Tests for LessonStore (Story 3.1)
 *
 * Full CRUD + tenant isolation tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { LessonStore } from '../lesson-store.js';
import { NotFoundError } from '../errors.js';

let store: LessonStore;

beforeEach(() => {
  const db = createTestDb();
  runMigrations(db);
  store = new LessonStore(db);
});

describe('LessonStore.create', () => {
  it('creates a lesson with required fields', () => {
    const lesson = store.create('tenant-a', {
      title: 'Always validate inputs',
      content: 'User inputs should be validated at the API boundary.',
    });

    expect(lesson.id).toBeTruthy();
    expect(lesson.tenantId).toBe('tenant-a');
    expect(lesson.title).toBe('Always validate inputs');
    expect(lesson.content).toBe('User inputs should be validated at the API boundary.');
    expect(lesson.category).toBe('general');
    expect(lesson.importance).toBe('normal');
    expect(lesson.accessCount).toBe(0);
    expect(lesson.context).toEqual({});
    expect(lesson.createdAt).toBeTruthy();
    expect(lesson.updatedAt).toBeTruthy();
    expect(lesson.archivedAt).toBeUndefined();
    expect(lesson.agentId).toBeUndefined();
    expect(lesson.lastAccessedAt).toBeUndefined();
  });

  it('creates a lesson with all optional fields', () => {
    const lesson = store.create('tenant-a', {
      title: 'Use semantic search',
      content: 'Semantic search gives better results than keyword search.',
      category: 'architecture',
      importance: 'high',
      agentId: 'agent-1',
      context: { project: 'agentlens', sprint: 3 },
      sourceSessionId: 'ses_123',
      sourceEventId: 'evt_456',
    });

    expect(lesson.category).toBe('architecture');
    expect(lesson.importance).toBe('high');
    expect(lesson.agentId).toBe('agent-1');
    expect(lesson.context).toEqual({ project: 'agentlens', sprint: 3 });
    expect(lesson.sourceSessionId).toBe('ses_123');
    expect(lesson.sourceEventId).toBe('evt_456');
  });

  it('generates unique IDs', () => {
    const lesson1 = store.create('tenant-a', { title: 'L1', content: 'C1' });
    const lesson2 = store.create('tenant-a', { title: 'L2', content: 'C2' });
    expect(lesson1.id).not.toBe(lesson2.id);
  });
});

describe('LessonStore.get', () => {
  it('returns a lesson by ID', () => {
    const created = store.create('tenant-a', {
      title: 'Test lesson',
      content: 'Test content',
    });

    const fetched = store.get('tenant-a', created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe('Test lesson');
  });

  it('increments access_count on get', () => {
    const created = store.create('tenant-a', {
      title: 'Test lesson',
      content: 'Test content',
    });

    const first = store.get('tenant-a', created.id);
    expect(first!.accessCount).toBe(1);

    const second = store.get('tenant-a', created.id);
    expect(second!.accessCount).toBe(2);
  });

  it('updates lastAccessedAt on get', () => {
    const created = store.create('tenant-a', {
      title: 'Test lesson',
      content: 'Test content',
    });
    expect(created.lastAccessedAt).toBeUndefined();

    const fetched = store.get('tenant-a', created.id);
    expect(fetched!.lastAccessedAt).toBeTruthy();
  });

  it('returns null for non-existent ID', () => {
    const result = store.get('tenant-a', 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for wrong tenant', () => {
    const created = store.create('tenant-a', {
      title: 'Test lesson',
      content: 'Test content',
    });

    const result = store.get('tenant-b', created.id);
    expect(result).toBeNull();
  });
});

describe('LessonStore.list', () => {
  it('returns empty list when no lessons', () => {
    const results = store.list('tenant-a');
    expect(results).toEqual([]);
  });

  it('returns lessons for tenant', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1' });
    store.create('tenant-a', { title: 'L2', content: 'C2' });
    store.create('tenant-b', { title: 'L3', content: 'C3' });

    const results = store.list('tenant-a');
    expect(results).toHaveLength(2);
  });

  it('excludes archived lessons by default', () => {
    const l1 = store.create('tenant-a', { title: 'Active', content: 'Active content' });
    const l2 = store.create('tenant-a', { title: 'Archived', content: 'Archived content' });
    store.archive('tenant-a', l2.id);

    const results = store.list('tenant-a');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Active');
  });

  it('includes archived lessons when requested', () => {
    store.create('tenant-a', { title: 'Active', content: 'Active content' });
    const l2 = store.create('tenant-a', { title: 'Archived', content: 'Archived content' });
    store.archive('tenant-a', l2.id);

    const results = store.list('tenant-a', { includeArchived: true });
    expect(results).toHaveLength(2);
  });

  it('filters by category', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1', category: 'architecture' });
    store.create('tenant-a', { title: 'L2', content: 'C2', category: 'debugging' });
    store.create('tenant-a', { title: 'L3', content: 'C3', category: 'architecture' });

    const results = store.list('tenant-a', { category: 'architecture' });
    expect(results).toHaveLength(2);
  });

  it('filters by importance', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1', importance: 'high' });
    store.create('tenant-a', { title: 'L2', content: 'C2', importance: 'low' });
    store.create('tenant-a', { title: 'L3', content: 'C3', importance: 'high' });

    const results = store.list('tenant-a', { importance: 'high' });
    expect(results).toHaveLength(2);
  });

  it('filters by agentId', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1', agentId: 'agent-1' });
    store.create('tenant-a', { title: 'L2', content: 'C2', agentId: 'agent-2' });

    const results = store.list('tenant-a', { agentId: 'agent-1' });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-1');
  });

  it('filters by search (title match)', () => {
    store.create('tenant-a', { title: 'Always validate inputs', content: 'C1' });
    store.create('tenant-a', { title: 'Use semantic search', content: 'C2' });

    const results = store.list('tenant-a', { search: 'validate' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Always validate inputs');
  });

  it('filters by search (content match)', () => {
    store.create('tenant-a', { title: 'L1', content: 'Use rate limiting on API endpoints' });
    store.create('tenant-a', { title: 'L2', content: 'Test everything thoroughly' });

    const results = store.list('tenant-a', { search: 'rate limiting' });
    expect(results).toHaveLength(1);
  });

  it('applies limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.create('tenant-a', { title: `Lesson ${i}`, content: `Content ${i}` });
    }

    const page1 = store.list('tenant-a', { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = store.list('tenant-a', { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = store.list('tenant-a', { limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });

  it('combines multiple filters', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1', category: 'arch', importance: 'high', agentId: 'agent-1' });
    store.create('tenant-a', { title: 'L2', content: 'C2', category: 'arch', importance: 'low', agentId: 'agent-1' });
    store.create('tenant-a', { title: 'L3', content: 'C3', category: 'debug', importance: 'high', agentId: 'agent-1' });

    const results = store.list('tenant-a', { category: 'arch', importance: 'high' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('L1');
  });
});

describe('LessonStore.update', () => {
  it('updates title', () => {
    const created = store.create('tenant-a', { title: 'Old title', content: 'Content' });
    const updated = store.update('tenant-a', created.id, { title: 'New title' });

    expect(updated.title).toBe('New title');
    expect(updated.content).toBe('Content'); // unchanged
  });

  it('updates content', () => {
    const created = store.create('tenant-a', { title: 'Title', content: 'Old content' });
    const updated = store.update('tenant-a', created.id, { content: 'New content' });

    expect(updated.content).toBe('New content');
  });

  it('updates category and importance', () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C' });
    const updated = store.update('tenant-a', created.id, {
      category: 'debugging',
      importance: 'critical',
    });

    expect(updated.category).toBe('debugging');
    expect(updated.importance).toBe('critical');
  });

  it('updates context', () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C', context: { old: true } });
    const updated = store.update('tenant-a', created.id, { context: { new: true, version: 2 } });

    expect(updated.context).toEqual({ new: true, version: 2 });
  });

  it('updates updatedAt timestamp', async () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C' });
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    const updated = store.update('tenant-a', created.id, { title: 'Updated' });

    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    expect(updated.title).toBe('Updated');
  });

  it('throws NotFoundError for non-existent lesson', () => {
    expect(() => {
      store.update('tenant-a', 'nonexistent', { title: 'Updated' });
    }).toThrow(NotFoundError);
  });

  it('throws NotFoundError for wrong tenant', () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C' });
    expect(() => {
      store.update('tenant-b', created.id, { title: 'Updated' });
    }).toThrow(NotFoundError);
  });
});

describe('LessonStore.archive', () => {
  it('soft-deletes a lesson', () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C' });
    store.archive('tenant-a', created.id);

    // Should not appear in default list
    const results = store.list('tenant-a');
    expect(results).toHaveLength(0);

    // Should appear when includeArchived
    const all = store.list('tenant-a', { includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0].archivedAt).toBeTruthy();
  });

  it('throws NotFoundError for non-existent lesson', () => {
    expect(() => {
      store.archive('tenant-a', 'nonexistent');
    }).toThrow(NotFoundError);
  });

  it('throws NotFoundError for wrong tenant', () => {
    const created = store.create('tenant-a', { title: 'T', content: 'C' });
    expect(() => {
      store.archive('tenant-b', created.id);
    }).toThrow(NotFoundError);
  });
});

describe('LessonStore.count', () => {
  it('returns 0 when no lessons', () => {
    expect(store.count('tenant-a')).toBe(0);
  });

  it('counts lessons for tenant', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1' });
    store.create('tenant-a', { title: 'L2', content: 'C2' });
    store.create('tenant-b', { title: 'L3', content: 'C3' });

    expect(store.count('tenant-a')).toBe(2);
    expect(store.count('tenant-b')).toBe(1);
  });

  it('excludes archived by default', () => {
    const l1 = store.create('tenant-a', { title: 'L1', content: 'C1' });
    store.create('tenant-a', { title: 'L2', content: 'C2' });
    store.archive('tenant-a', l1.id);

    expect(store.count('tenant-a')).toBe(1);
    expect(store.count('tenant-a', { includeArchived: true })).toBe(2);
  });

  it('counts with filters', () => {
    store.create('tenant-a', { title: 'L1', content: 'C1', category: 'arch' });
    store.create('tenant-a', { title: 'L2', content: 'C2', category: 'debug' });
    store.create('tenant-a', { title: 'L3', content: 'C3', category: 'arch' });

    expect(store.count('tenant-a', { category: 'arch' })).toBe(2);
    expect(store.count('tenant-a', { category: 'debug' })).toBe(1);
  });
});

describe('Tenant Isolation', () => {
  it('tenant A cannot see tenant B lessons', () => {
    store.create('tenant-a', { title: 'A lesson', content: 'A content' });
    store.create('tenant-b', { title: 'B lesson', content: 'B content' });

    const aLessons = store.list('tenant-a');
    expect(aLessons).toHaveLength(1);
    expect(aLessons[0].title).toBe('A lesson');

    const bLessons = store.list('tenant-b');
    expect(bLessons).toHaveLength(1);
    expect(bLessons[0].title).toBe('B lesson');
  });

  it('tenant A cannot get tenant B lesson by ID', () => {
    const bLesson = store.create('tenant-b', { title: 'B lesson', content: 'B content' });
    expect(store.get('tenant-a', bLesson.id)).toBeNull();
  });

  it('tenant A cannot update tenant B lesson', () => {
    const bLesson = store.create('tenant-b', { title: 'B lesson', content: 'B content' });
    expect(() => {
      store.update('tenant-a', bLesson.id, { title: 'Hacked' });
    }).toThrow(NotFoundError);
  });

  it('tenant A cannot archive tenant B lesson', () => {
    const bLesson = store.create('tenant-b', { title: 'B lesson', content: 'B content' });
    expect(() => {
      store.archive('tenant-a', bLesson.id);
    }).toThrow(NotFoundError);
  });

  it('tenant A count does not include tenant B lessons', () => {
    store.create('tenant-a', { title: 'A1', content: 'C1' });
    store.create('tenant-b', { title: 'B1', content: 'C2' });
    store.create('tenant-b', { title: 'B2', content: 'C3' });

    expect(store.count('tenant-a')).toBe(1);
    expect(store.count('tenant-b')).toBe(2);
  });
});

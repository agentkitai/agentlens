/**
 * Lesson Store (Story 3.1)
 *
 * CRUD operations for the lessons table with tenant isolation.
 */

import { eq, and, like, or, sql, isNull, isNotNull } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import { lessons } from './schema.sqlite.js';
import type { Lesson, LessonQuery, LessonImportance } from '@agentlensai/core';
import { NotFoundError } from './errors.js';

/** Input for creating a new lesson */
export interface CreateLessonInput {
  title: string;
  content: string;
  category?: string;
  importance?: LessonImportance;
  agentId?: string;
  context?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceEventId?: string;
}

/** Input for updating an existing lesson */
export interface UpdateLessonInput {
  title?: string;
  content?: string;
  category?: string;
  importance?: LessonImportance;
  agentId?: string;
  context?: Record<string, unknown>;
}

/** Generate a simple ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Parse a DB row into a Lesson */
function rowToLesson(row: typeof lessons.$inferSelect): Lesson {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId ?? undefined,
    category: row.category,
    title: row.title,
    content: row.content,
    context: JSON.parse(row.context) as Record<string, unknown>,
    importance: row.importance as LessonImportance,
    sourceSessionId: row.sourceSessionId ?? undefined,
    sourceEventId: row.sourceEventId ?? undefined,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
  };
}

export class LessonStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Create a new lesson.
   */
  create(tenantId: string, input: CreateLessonInput): Lesson {
    const now = new Date().toISOString();
    const id = generateId();

    const row = {
      id,
      tenantId,
      agentId: input.agentId ?? null,
      category: input.category ?? 'general',
      title: input.title,
      content: input.content,
      context: JSON.stringify(input.context ?? {}),
      importance: input.importance ?? 'normal',
      sourceSessionId: input.sourceSessionId ?? null,
      sourceEventId: input.sourceEventId ?? null,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    this.db.insert(lessons).values(row).run();

    return rowToLesson(row);
  }

  /**
   * Get a lesson by ID. Increments access_count and updates last_accessed_at.
   */
  get(tenantId: string, id: string): Lesson | null {
    const row = this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .get();

    if (!row) return null;

    // Increment access_count and update last_accessed_at
    const now = new Date().toISOString();
    this.db
      .update(lessons)
      .set({
        accessCount: row.accessCount + 1,
        lastAccessedAt: now,
      })
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .run();

    return rowToLesson({
      ...row,
      accessCount: row.accessCount + 1,
      lastAccessedAt: now,
    });
  }

  /**
   * List lessons with optional filters.
   */
  list(tenantId: string, query?: LessonQuery): Lesson[] {
    const conditions = [eq(lessons.tenantId, tenantId)];

    if (!query?.includeArchived) {
      conditions.push(isNull(lessons.archivedAt));
    }

    if (query?.agentId) {
      conditions.push(eq(lessons.agentId, query.agentId));
    }
    if (query?.category) {
      conditions.push(eq(lessons.category, query.category));
    }
    if (query?.importance) {
      conditions.push(eq(lessons.importance, query.importance));
    }
    if (query?.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          like(lessons.title, pattern),
          like(lessons.content, pattern),
        )!,
      );
    }

    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const rows = this.db
      .select()
      .from(lessons)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(sql`${lessons.createdAt} DESC`)
      .all();

    return rows.map(rowToLesson);
  }

  /**
   * Update a lesson (partial update).
   */
  update(tenantId: string, id: string, updates: UpdateLessonInput): Lesson {
    // Check existence
    const existing = this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .get();

    if (!existing) {
      throw new NotFoundError(`Lesson ${id} not found`);
    }

    const now = new Date().toISOString();
    const setValues: Record<string, unknown> = { updatedAt: now };

    if (updates.title !== undefined) setValues['title'] = updates.title;
    if (updates.content !== undefined) setValues['content'] = updates.content;
    if (updates.category !== undefined) setValues['category'] = updates.category;
    if (updates.importance !== undefined) setValues['importance'] = updates.importance;
    if (updates.agentId !== undefined) setValues['agentId'] = updates.agentId;
    if (updates.context !== undefined) setValues['context'] = JSON.stringify(updates.context);

    this.db
      .update(lessons)
      .set(setValues)
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .run();

    // Fetch updated row
    const updated = this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .get();

    return rowToLesson(updated!);
  }

  /**
   * Soft-delete (archive) a lesson.
   */
  archive(tenantId: string, id: string): void {
    const existing = this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .get();

    if (!existing) {
      throw new NotFoundError(`Lesson ${id} not found`);
    }

    const now = new Date().toISOString();
    this.db
      .update(lessons)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId)))
      .run();
  }

  /**
   * Count lessons matching filters.
   */
  count(tenantId: string, query?: LessonQuery): number {
    const conditions = [eq(lessons.tenantId, tenantId)];

    if (!query?.includeArchived) {
      conditions.push(isNull(lessons.archivedAt));
    }

    if (query?.agentId) {
      conditions.push(eq(lessons.agentId, query.agentId));
    }
    if (query?.category) {
      conditions.push(eq(lessons.category, query.category));
    }
    if (query?.importance) {
      conditions.push(eq(lessons.importance, query.importance));
    }
    if (query?.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          like(lessons.title, pattern),
          like(lessons.content, pattern),
        )!,
      );
    }

    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(lessons)
      .where(and(...conditions))
      .get();

    return result?.count ?? 0;
  }
}

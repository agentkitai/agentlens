/**
 * Lessons REST Endpoints (Story 3.2)
 *
 * POST   /api/lessons       — Create lesson
 * GET    /api/lessons       — List lessons with filters
 * GET    /api/lessons/:id   — Get single lesson (increments access_count)
 * PUT    /api/lessons/:id   — Update lesson
 * DELETE /api/lessons/:id   — Archive (soft delete)
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { LessonStore } from '../db/lesson-store.js';
import { NotFoundError } from '../db/errors.js';
import type { LessonImportance } from '@agentlensai/core';

// TODO: enqueue embedding on lesson create/update

export function lessonsRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new LessonStore(db);

  // POST /api/lessons — Create lesson
  app.post('/', async (c) => {
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';

    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const { title, content, category, importance, agentId, context, sourceSessionId, sourceEventId } = rawBody as Record<string, unknown>;

    if (!title || typeof title !== 'string') {
      return c.json({ error: 'title is required and must be a string', status: 400 }, 400);
    }
    if (!content || typeof content !== 'string') {
      return c.json({ error: 'content is required and must be a string', status: 400 }, 400);
    }

    // Validate importance if provided
    const validImportance = ['low', 'normal', 'high', 'critical'];
    if (importance !== undefined && !validImportance.includes(importance as string)) {
      return c.json({ error: `importance must be one of: ${validImportance.join(', ')}`, status: 400 }, 400);
    }

    const lesson = store.create(tenantId, {
      title: title as string,
      content: content as string,
      category: category as string | undefined,
      importance: importance as LessonImportance | undefined,
      agentId: agentId as string | undefined,
      context: context as Record<string, unknown> | undefined,
      sourceSessionId: sourceSessionId as string | undefined,
      sourceEventId: sourceEventId as string | undefined,
    });

    return c.json(lesson, 201);
  });

  // GET /api/lessons — List with query params
  app.get('/', async (c) => {
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';

    const category = c.req.query('category');
    const agentId = c.req.query('agentId');
    const importance = c.req.query('importance') as LessonImportance | undefined;
    const search = c.req.query('search');
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');
    const includeArchived = c.req.query('includeArchived') === 'true';

    const limit = limitStr ? Math.max(1, Math.min(parseInt(limitStr, 10) || 50, 500)) : 50;
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

    const query = {
      category: category ?? undefined,
      agentId: agentId ?? undefined,
      importance: importance ?? undefined,
      search: search ?? undefined,
      limit,
      offset,
      includeArchived,
    };

    const items = store.list(tenantId, query);
    const total = store.count(tenantId, query);

    return c.json({
      lessons: items,
      total,
      hasMore: offset + items.length < total,
    });
  });

  // GET /api/lessons/:id — Get single lesson
  app.get('/:id', async (c) => {
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';
    const id = c.req.param('id');

    const lesson = store.get(tenantId, id);
    if (!lesson) {
      return c.json({ error: 'Lesson not found', status: 404 }, 404);
    }

    return c.json(lesson);
  });

  // PUT /api/lessons/:id — Update lesson
  app.put('/:id', async (c) => {
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';
    const id = c.req.param('id');

    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const { title, content, category, importance, agentId, context } = rawBody as Record<string, unknown>;

    // Validate importance if provided
    const validImportance = ['low', 'normal', 'high', 'critical'];
    if (importance !== undefined && !validImportance.includes(importance as string)) {
      return c.json({ error: `importance must be one of: ${validImportance.join(', ')}`, status: 400 }, 400);
    }

    try {
      const lesson = store.update(tenantId, id, {
        title: title as string | undefined,
        content: content as string | undefined,
        category: category as string | undefined,
        importance: importance as LessonImportance | undefined,
        agentId: agentId as string | undefined,
        context: context as Record<string, unknown> | undefined,
      });

      return c.json(lesson);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'Lesson not found', status: 404 }, 404);
      }
      throw err;
    }
  });

  // DELETE /api/lessons/:id — Archive (soft delete)
  app.delete('/:id', async (c) => {
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';
    const id = c.req.param('id');

    try {
      store.archive(tenantId, id);
      return c.json({ id, archived: true });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'Lesson not found', status: 404 }, 404);
      }
      throw err;
    }
  });

  return app;
}

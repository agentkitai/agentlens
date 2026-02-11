/**
 * Context REST Endpoint (Story 5.4)
 *
 * GET /api/context?topic=...&userId=...&agentId=...&from=...&to=...&limit=...
 *
 * Returns cross-session context combining session summaries, lessons,
 * and key events, ranked by relevance.
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { EmbeddingService } from '../lib/embeddings/index.js';
import type { EmbeddingStore } from '../db/embedding-store.js';
import type { SqliteDb } from '../db/index.js';
import { SessionSummaryStore } from '../db/session-summary-store.js';
import { LessonStore } from '../db/lesson-store.js';
import { ContextRetriever } from '../lib/context/retrieval.js';
import { getTenantStore } from './tenant-helper.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Context');

export interface ContextRouteDeps {
  db: SqliteDb;
  embeddingService: EmbeddingService | null;
  embeddingStore: EmbeddingStore | null;
}

export function contextRoutes(store: IEventStore, deps: ContextRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const sessionSummaryStore = new SessionSummaryStore(deps.db);
  const lessonStore = new LessonStore(deps.db);

  // GET /api/context
  app.get('/', async (c) => {
    const topic = c.req.query('topic');
    if (!topic) {
      return c.json({ error: 'Missing required query parameter: topic', status: 400 }, 400);
    }

    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';
    const tenantStore = getTenantStore(store, c);

    const userId = c.req.query('userId') || undefined;
    const agentId = c.req.query('agentId') || undefined;
    const from = c.req.query('from') || undefined;
    const to = c.req.query('to') || undefined;
    const limitStr = c.req.query('limit');
    const limit = limitStr ? Math.max(1, Math.min(parseInt(limitStr, 10) || 10, 100)) : 10;

    try {
      const retriever = new ContextRetriever(
        deps.embeddingStore,
        deps.embeddingService,
        sessionSummaryStore,
        lessonStore,
        tenantStore,
      );

      const result = await retriever.retrieve(tenantId, {
        topic,
        userId,
        agentId,
        from,
        to,
        limit,
      });

      return c.json(result);
    } catch (error) {
      log.error('Retrieval failed', { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: 'Context retrieval failed', status: 500 }, 500);
    }
  });

  return app;
}

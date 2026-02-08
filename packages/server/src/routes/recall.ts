/**
 * Recall REST Endpoint (Story 2.6)
 *
 * GET /api/recall — Semantic search over embeddings
 *
 * Embeds the query text, performs cosine similarity search,
 * and returns enriched results.
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { EmbeddingService } from '../lib/embeddings/index.js';
import type { EmbeddingStore, SimilaritySearchOptions } from '../db/embedding-store.js';

export interface RecallRouteDeps {
  embeddingService: EmbeddingService | null;
  embeddingStore: EmbeddingStore | null;
  eventStore?: IEventStore;
}

export function recallRoutes(deps: RecallRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/recall?query=...&scope=...&limit=...&minScore=...&agentId=...&from=...&to=...
  app.get('/', async (c) => {
    const { embeddingService, embeddingStore } = deps;

    if (!embeddingService || !embeddingStore) {
      return c.json(
        { error: 'Embedding service not configured', status: 503 },
        503,
      );
    }

    const query = c.req.query('query');
    if (!query) {
      return c.json({ error: 'query parameter is required', status: 400 }, 400);
    }

    const scope = c.req.query('scope'); // 'events' | 'sessions' | 'lessons' | 'all'
    const agentId = c.req.query('agentId');
    const limitStr = c.req.query('limit');
    const minScoreStr = c.req.query('minScore');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const limit = limitStr ? Math.max(1, Math.min(parseInt(limitStr, 10) || 10, 100)) : 10;
    const minScore = minScoreStr ? Math.max(0, Math.min(parseFloat(minScoreStr) || 0, 1)) : 0;

    // Get tenantId from auth context
    const apiKeyInfo = c.get('apiKey');
    const tenantId = apiKeyInfo?.tenantId ?? 'default';

    try {
      // Embed the query text
      const queryVector = await embeddingService.embed(query);

      // Map scope to sourceType for the store
      let sourceType: string | undefined;
      if (scope && scope !== 'all') {
        // Normalize: 'events' -> 'event', 'sessions' -> 'session', 'lessons' -> 'lesson'
        sourceType = scope.replace(/s$/, '');
      }

      const searchOpts: SimilaritySearchOptions = {
        sourceType,
        from: from ?? undefined,
        to: to ?? undefined,
        limit,
        minScore,
      };

      let results = await embeddingStore.similaritySearch(
        tenantId,
        queryVector,
        searchOpts,
      );

      // Post-hoc agentId filter: if agentId is specified, keep only results
      // whose source session belongs to that agent.
      if (agentId && deps.eventStore) {
        const filtered = [];
        for (const r of results) {
          // For session-scoped embeddings, sourceId is the sessionId
          if (r.sourceType === 'session' || r.sourceType === 'event') {
            const session = await deps.eventStore.getSession(
              r.sourceType === 'session' ? r.sourceId : r.sourceId,
            );
            if (session && session.agentId === agentId) {
              filtered.push(r);
            }
          } else {
            // Lessons and other types don't have agentId — include them
            filtered.push(r);
          }
        }
        results = filtered;
      }

      return c.json({
        results: results.map((r) => ({
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          score: Math.round(r.score * 10000) / 10000, // 4 decimal places
          text: r.text,
          metadata: {
            embeddingModel: r.embeddingModel,
            createdAt: r.createdAt,
          },
        })),
        query,
        totalResults: results.length,
      });
    } catch (err) {
      console.error('[recall] Search failed:', err instanceof Error ? err.message : err);
      return c.json(
        { error: 'Recall search failed', status: 500 },
        500,
      );
    }
  });

  return app;
}

/**
 * Redaction Test Endpoint (Story 2.4)
 *
 * POST /api/community/redaction/test
 * Accepts raw content, runs it through the redaction pipeline,
 * and returns the redacted output WITHOUT sharing.
 * For testing/debugging purposes only.
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { RedactionPipeline } from '../lib/redaction/pipeline.js';
import { createRawLessonContent } from '@agentlensai/core';
import type { RedactionContext } from '@agentlensai/core';

export function redactionTestRoutes() {
  const app = new Hono<{ Variables: AuthVariables }>();
  const pipeline = new RedactionPipeline();

  app.post('/test', async (c) => {
    const body = await c.req.json<{
      title?: string;
      content: string;
      context?: Record<string, unknown>;
      tenantId?: string;
      agentId?: string;
      knownTenantTerms?: string[];
      denyListPatterns?: string[];
    }>();

    if (!body.content) {
      return c.json({ error: 'content is required' }, 400);
    }

    const raw = createRawLessonContent(
      body.title ?? 'Test',
      body.content,
      body.context ?? {},
    );

    const redactionCtx: RedactionContext = {
      tenantId: body.tenantId ?? 'test',
      agentId: body.agentId,
      category: 'general',
      denyListPatterns: body.denyListPatterns ?? [],
      knownTenantTerms: body.knownTenantTerms ?? [],
    };

    const result = await pipeline.process(raw, redactionCtx);

    return c.json(result);
  });

  return app;
}

/**
 * SSE Stream Endpoint (Story 14.1, Arch §7.2)
 *
 * GET /api/stream — Server-Sent Events endpoint for real-time dashboard updates.
 *
 * Query params:
 *   sessionId?  — filter to a specific session
 *   agentId?    — filter to a specific agent
 *   eventType?  — filter by event type (comma-separated)
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { createSSEStream, type SSEFilters } from '../lib/sse.js';

export function streamRoutes() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get('/', (c) => {
    // Parse filter params
    const filters: SSEFilters = {};

    const sessionId = c.req.query('sessionId');
    if (sessionId) filters.sessionId = sessionId;

    const agentId = c.req.query('agentId');
    if (agentId) filters.agentId = agentId;

    const eventType = c.req.query('eventType');
    if (eventType) {
      filters.eventTypes = eventType.split(',').filter(Boolean);
    }

    // Create SSE stream
    const stream = createSSEStream(filters, c.req.raw.signal);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  });

  return app;
}

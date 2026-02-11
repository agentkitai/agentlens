/**
 * Event Endpoints (Stories 4.4 + 4.5)
 *
 * POST /api/events       — ingest events
 * GET  /api/events       — query events with filters
 * GET  /api/events/:id   — get single event
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  ingestEventSchema,
  computeEventHash,
  truncatePayload,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@agentlensai/core';
import type { AgentLensEvent, EventQuery, EventType, EventSeverity } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { eventBus } from '../lib/event-bus.js';
import { getTenantStore } from './tenant-helper.js';
import { summarizeEvent, summarizeSession } from '../lib/embeddings/summarizer.js';
import type { EmbeddingWorker } from '../lib/embeddings/worker.js';
import type { SessionSummaryStore } from '../db/session-summary-store.js';

/** Schema for the batch ingestion request body */
const ingestBatchSchema = z.object({
  events: z.array(ingestEventSchema).min(1).max(1000),
});

export function eventsRoutes(
  store: IEventStore,
  deps?: {
    embeddingWorker: EmbeddingWorker | null;
    sessionSummaryStore?: SessionSummaryStore | null;
  },
) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/events — ingest events
  app.post('/', async (c) => {
    const tenantStore = getTenantStore(store, c);

    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = ingestBatchSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: parseResult.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }, 400);
    }

    const { events: inputEvents } = parseResult.data;

    // Group events by sessionId to handle per-session hash chains
    const bySession = new Map<string, typeof inputEvents>();
    for (const ev of inputEvents) {
      const arr = bySession.get(ev.sessionId) ?? [];
      arr.push(ev);
      bySession.set(ev.sessionId, arr);
    }

    const allProcessed: AgentLensEvent[] = [];

    // Phase 1: Build all events (validate and compute hashes) without writing
    for (const [sessionId, sessionEvents] of bySession) {
      // Get the last event hash for this session to chain from (optimized)
      let prevHash: string | null = await tenantStore.getLastEventHash(sessionId);

      for (const input of sessionEvents) {
        const id = ulid();
        const timestamp = input.timestamp ?? new Date().toISOString();
        const severity = input.severity ?? 'info';
        const metadata = input.metadata ?? {};
        const payload = truncatePayload(input.payload as AgentLensEvent['payload']);

        const hash = computeEventHash({
          id,
          timestamp,
          sessionId: input.sessionId,
          agentId: input.agentId,
          eventType: input.eventType,
          severity,
          payload,
          metadata,
          prevHash,
        });

        const event: AgentLensEvent = {
          id,
          timestamp,
          sessionId: input.sessionId,
          agentId: input.agentId,
          eventType: input.eventType as AgentLensEvent['eventType'],
          severity: severity as AgentLensEvent['severity'],
          payload,
          metadata,
          prevHash,
          hash,
          tenantId: 'default',
        };

        allProcessed.push(event);
        prevHash = hash;
      }
    }

    // Phase 2: Insert all events atomically per session group.
    // Group by session for hash-chain integrity, but insertEvents already
    // runs inside a transaction, and if any session group fails the whole
    // request is an error (no partial success).
    const sessionGroups = new Map<string, AgentLensEvent[]>();
    for (const event of allProcessed) {
      const arr = sessionGroups.get(event.sessionId) ?? [];
      arr.push(event);
      sessionGroups.set(event.sessionId, arr);
    }

    try {
      for (const [, sessionProcessed] of sessionGroups) {
        await tenantStore.insertEvents(sessionProcessed);
      }
    } catch (error) {
      // If any session group fails, the entire batch is rejected
      console.error('[events] Batch insert failed:', error);
      return c.json({ error: 'Batch insert failed: Internal server error', status: 500 }, 500);
    }

    // Emit events to EventBus for SSE fan-out (async, non-blocking)
    const now = new Date().toISOString();
    for (const event of allProcessed) {
      eventBus.emit({ type: 'event_ingested', event, timestamp: now });
    }

    // Enqueue embeddable events for background embedding
    const worker = deps?.embeddingWorker;
    if (worker) {
      const tenantId = allProcessed[0]?.tenantId ?? 'default';
      for (const event of allProcessed) {
        try {
          const text = summarizeEvent(event);
          if (text) {
            worker.enqueue({
              tenantId,
              sourceType: 'event',
              sourceId: event.id,
              textContent: text,
            });
          }
        } catch {
          // Never crash on embedding failures
        }
      }
    }

    // Emit session updates for affected sessions
    const affectedSessionIds = new Set(allProcessed.map((e) => e.sessionId));
    for (const sessionId of affectedSessionIds) {
      const session = await tenantStore.getSession(sessionId);
      if (session) {
        eventBus.emit({ type: 'session_updated', session, timestamp: now });
      }
    }

    // Generate session summaries for sessions that just ended (fail-safe)
    const summaryStore = deps?.sessionSummaryStore;
    if (summaryStore) {
      const endedEvents = allProcessed.filter((e) => e.eventType === 'session_ended');
      for (const endedEvent of endedEvents) {
        try {
          const session = await tenantStore.getSession(endedEvent.sessionId);
          if (!session) continue;

          const timeline = await tenantStore.getSessionTimeline(endedEvent.sessionId);
          const summaryResult = summarizeSession(session, timeline);

          summaryStore.save(
            endedEvent.tenantId,
            endedEvent.sessionId,
            summaryResult.summary,
            summaryResult.topics,
            summaryResult.toolSequence,
            summaryResult.errorSummary || null,
            summaryResult.outcome,
          );

          // Enqueue the summary for embedding
          if (worker) {
            worker.enqueue({
              tenantId: endedEvent.tenantId,
              sourceType: 'session',
              sourceId: endedEvent.sessionId,
              textContent: summaryResult.summary,
            });
          }
        } catch (err) {
          // Fail-safe: log and continue — never block event ingest
          console.error(
            `[events] Failed to generate session summary for ${endedEvent.sessionId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    return c.json({
      ingested: allProcessed.length,
      events: allProcessed.map((e) => ({ id: e.id, hash: e.hash })),
    }, 201);
  });

  // GET /api/events — query events
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const query: EventQuery = {};

    const sessionId = c.req.query('sessionId');
    if (sessionId) query.sessionId = sessionId;

    const agentId = c.req.query('agentId');
    if (agentId) query.agentId = agentId;

    const eventType = c.req.query('eventType');
    if (eventType) {
      query.eventType = eventType.includes(',')
        ? eventType.split(',') as EventType[]
        : eventType as EventType;
    }

    const severity = c.req.query('severity');
    if (severity) {
      query.severity = severity.includes(',')
        ? severity.split(',') as EventSeverity[]
        : severity as EventSeverity;
    }

    const from = c.req.query('from');
    if (from) query.from = from;

    const to = c.req.query('to');
    if (to) query.to = to;

    const search = c.req.query('search');
    if (search) query.search = search;

    const limitStr = c.req.query('limit');
    query.limit = limitStr
      ? Math.max(1, Math.min(parseInt(limitStr, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
      : DEFAULT_PAGE_SIZE;

    const offsetStr = c.req.query('offset');
    query.offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

    const order = c.req.query('order');
    if (order === 'asc' || order === 'desc') query.order = order;

    const result = await tenantStore.queryEvents(query);

    return c.json({
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
    });
  });

  // GET /api/events/:id — single event
  app.get('/:id', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');
    const event = await tenantStore.getEvent(id);

    if (!event) {
      return c.json({ error: 'Event not found', status: 404 }, 404);
    }

    return c.json(event);
  });

  return app;
}

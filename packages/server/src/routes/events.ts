/**
 * Event Endpoints (Stories 4.4 + 4.5)
 *
 * POST /api/events       — ingest events
 * GET  /api/events       — query events with filters
 * GET  /api/events/:id   — get single event
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { nextEventId } from '../lib/event-id.js';
import { z } from 'zod';
import {
  ingestEventSchema,
  computeEventHash,
  truncatePayload,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@agentkitai/agentlens-core';
import type { AgentLensEvent, EventQuery, EventType, EventSeverity } from '@agentkitai/agentlens-core';
import type { IEventStore } from '@agentkitai/agentlens-core';
import type { AuthVariables } from '../middleware/auth.js';
import { eventBus } from '../lib/event-bus.js';
import { verifyAgentTokenWithMethod, stampVerifiedAgent } from '../lib/agent-identity.js';
import { getTenantId, getTenantStore } from './tenant-helper.js';
import { offloadPayload } from '../lib/media-offload.js';
import type { MediaStore } from '../db/media-store.js';
import { runLiveEval, type LiveEvalStore } from '../lib/eval/live-eval.js';
import { summarizeEvent, summarizeSession } from '../lib/embeddings/summarizer.js';
import type { EmbeddingWorker } from '../lib/embeddings/worker.js';
import type { SessionSummaryStore } from '../db/session-summary-store.js';
import type { PromptStore } from '../db/prompt-store.js';
import { recordPromptFingerprints } from '../lib/prompt-fingerprint.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Events');

/** Schema for the batch ingestion request body */
const ingestBatchSchema = z.object({
  events: z.array(ingestEventSchema).min(1).max(1000),
});

export function eventsRoutes(
  store: IEventStore,
  deps?: {
    embeddingWorker: EmbeddingWorker | null;
    sessionSummaryStore?: SessionSummaryStore | null;
    promptStore?: PromptStore | null;
    mediaStore?: MediaStore | null;
    liveEvalStore?: LiveEvalStore | null;
  },
) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // H-4 FIX: Body size limit (10MB) to prevent abuse
  app.use('*', bodyLimit({ maxSize: 10 * 1024 * 1024 }));

  // POST /api/events — ingest events
  app.post('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const tenantId = getTenantId(c);
    const mediaStore = deps?.mediaStore ?? null;

    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = ingestBatchSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      }, 400);
    }

    const { events: inputEvents } = parseResult.data;

    // Agent-identity (#12): verify an AgentGate agent token once for the batch.
    // When present + valid, every event gets a server-authoritative
    // `verifiedAgentId` stamped into its (hashed) metadata; otherwise the
    // reserved keys are stripped so a client can never forge them.
    const verified = await verifyAgentTokenWithMethod(c.req.header('x-agent-token'));
    const verifiedAgentId = verified?.id ?? null;
    const verifiedAgentMethod = verified?.method ?? 'agentgate_token';

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

      // Resolve timestamps, then chain in chronological order. Verification reads
      // events ordered by (timestamp, id), so building the chain in that same order
      // — with monotonic ids breaking same-millisecond ties — keeps a batch
      // verifiable no matter what order the events arrived in. (Array.sort is
      // stable, so events sharing a timestamp keep their arrival order.)
      const ordered = sessionEvents
        .map((input) => ({ input, timestamp: input.timestamp ?? new Date().toISOString() }))
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

      for (const { input, timestamp } of ordered) {
        const id = nextEventId();
        const severity = input.severity ?? 'info';
        const metadata = stampVerifiedAgent(input.metadata ?? {}, verifiedAgentId, verifiedAgentMethod);
        // #252: offload large base64 media to media_objects, leaving media:// refs
        // (before truncate/hash, so the ref is what's hashed + stored).
        const rawPayload = mediaStore
          ? await offloadPayload(input.payload, tenantId, mediaStore)
          : input.payload;
        const payload = truncatePayload(rawPayload as AgentLensEvent['payload']);

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
          tenantId: getTenantId(c),
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
      log.error('Batch insert failed', { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: 'Batch insert failed: Internal server error', status: 500 }, 500);
    }

    // Emit events to EventBus for SSE fan-out (async, non-blocking)
    const now = new Date().toISOString();
    for (const event of allProcessed) {
      eventBus.emit({ type: 'event_ingested', event, timestamp: now });
    }

    // #254: online-eval — sample completed sessions + score them (fire-and-forget,
    // never blocks ingest; failures are swallowed).
    const liveEvalStore = deps?.liveEvalStore;
    if (liveEvalStore) {
      const ended = new Map<string, string>();
      for (const e of allProcessed) if (e.eventType === 'session_ended') ended.set(e.sessionId, e.agentId);
      if (ended.size > 0) {
        void liveEvalStore
          .get(tenantId)
          .then((config) => {
            if (!config?.enabled) return;
            return Promise.all(
              [...ended].map(([sessionId, agentId]) =>
                runLiveEval({ tenantId, sessionId, agentId, store: tenantStore, config }).catch(() => undefined),
              ),
            );
          })
          .catch(() => undefined);
      }
    }

    // Auto-discover prompt templates from ingested llm_call events (best-effort).
    await recordPromptFingerprints(deps?.promptStore ?? null, allProcessed);

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
          log.error(`Failed to generate session summary for ${endedEvent.sessionId}`, { error: err instanceof Error ? err.message : String(err) });
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

    if (c.req.query('excludeMetrics') === 'true') query.excludeMetrics = true;

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

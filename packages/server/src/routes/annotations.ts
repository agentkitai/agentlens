/**
 * Annotation queues (#122) — human-review queue lifecycle. Mounted at
 * /api/annotations. Submitting a review writes exactly one chained `human_score`
 * event (via the shared recordHumanScore) and marks the item scored.
 */
import { Hono } from 'hono';
import { humanScoreRequestSchema } from '@agentkitai/agentlens-core';
import type { IEventStore } from '@agentkitai/agentlens-core';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { AnnotationStore, type AnnotationItemStatus, type AddItemInput } from '../db/annotation-store.js';
import { getTenantId, getTenantStore } from './tenant-helper.js';
import { recordHumanScore } from '../lib/human-score.js';
import { resolveAnnotator, sessionVerifiedAgentId, submitterId } from '../lib/annotator-identity.js';

export function annotationRoutes(db?: SqliteDb, store?: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const getStore = (): AnnotationStore | null => (db ? new AnnotationStore(db) : null);

  // POST /api/annotations/queues
  app.post('/queues', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    if (!body?.name || typeof body.name !== 'string') return c.json({ error: 'name is required' }, 400);
    const annotator = await resolveAnnotator(c);
    const queue = await qs.createQueue(tenantId, {
      name: body.name,
      description: typeof body.description === 'string' ? body.description : undefined,
      config: typeof body.config === 'object' && body.config ? body.config : undefined,
      createdBy: submitterId(annotator),
    });
    return c.json({ queue }, 201);
  });

  // GET /api/annotations/queues
  app.get('/queues', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    return c.json({ queues: await qs.listQueues(getTenantId(c)) });
  });

  // GET /api/annotations/queues/:id
  app.get('/queues/:id', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const queue = await qs.getQueue(tenantId, c.req.param('id'));
    if (!queue) return c.json({ error: 'Queue not found' }, 404);
    return c.json({ queue, items: await qs.listItems(tenantId, queue.id) });
  });

  // POST /api/annotations/queues/:id/items  — body: { items: [{sessionId, traceId?, dueAt?}] } or a single item
  app.post('/queues/:id/items', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    const raw: unknown[] = Array.isArray(body?.items) ? body.items : body?.sessionId ? [body] : [];
    const inputs: AddItemInput[] = raw
      .filter((i): i is { sessionId: string; traceId?: string; dueAt?: string } => typeof (i as { sessionId?: unknown })?.sessionId === 'string')
      .map((i) => ({ sessionId: i.sessionId, traceId: i.traceId, dueAt: i.dueAt }));
    if (inputs.length === 0) return c.json({ error: 'items (each with a sessionId) are required' }, 400);
    const items = await qs.addItems(tenantId, c.req.param('id'), inputs);
    if (items.length === 0) return c.json({ error: 'Queue not found' }, 404);
    return c.json({ items }, 201);
  });

  // GET /api/annotations/queues/:id/items?status=&assignee=
  app.get('/queues/:id/items', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const status = c.req.query('status') as AnnotationItemStatus | undefined;
    const assignee = c.req.query('assignee') || undefined;
    return c.json({ items: await qs.listItems(tenantId, c.req.param('id'), { status, assignee }) });
  });

  // POST /api/annotations/items/:id/claim
  app.post('/items/:id/claim', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const me = submitterId(await resolveAnnotator(c));
    if (!me) return c.json({ error: 'an identified reviewer is required to claim items' }, 403);
    const res = await qs.claimItem(tenantId, c.req.param('id'), me);
    if (!res.ok) return c.json({ error: res.reason ?? 'cannot claim', item: res.item }, res.reason === 'not_found' ? 404 : 409);
    return c.json({ item: res.item });
  });

  // POST /api/annotations/items/:id/submit  — writes exactly one human_score event
  app.post('/items/:id/submit', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    if (!store) return c.json({ error: 'Event store not available' }, 500);
    const tenantId = getTenantId(c);
    const item = await qs.getItem(tenantId, c.req.param('id'));
    if (!item) return c.json({ error: 'Item not found' }, 404);
    if (item.status === 'scored') return c.json({ error: 'Item already scored', item }, 409);

    const parsed = humanScoreRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);

    const annotator = await resolveAnnotator(c);
    const me = submitterId(annotator);
    // Identity-checked assignment: a claimed item may only be submitted by its assignee.
    if (item.assignee && me && item.assignee !== me) {
      return c.json({ error: `item is assigned to ${item.assignee}` }, 403);
    }

    const tenantStore = getTenantStore(store, c);
    const timeline = await tenantStore.getSessionTimeline(item.sessionId);
    if (timeline.length === 0) return c.json({ error: 'Item session not found or has no events' }, 404);

    const { event } = await recordHumanScore(tenantStore, {
      tenantId,
      sessionId: item.sessionId,
      agentId: timeline[0]!.agentId,
      verifiedAgentId: sessionVerifiedAgentId(timeline),
      unchained: timeline.every((e) => e.prevHash === null),
      annotator,
      input: { ...parsed.data, traceId: parsed.data.traceId ?? item.traceId, queueItemId: item.id },
    });
    const updated = await qs.markScored(tenantId, item.id, event.id);
    return c.json({ item: updated, event: { id: event.id, hash: event.hash, prevHash: event.prevHash } }, 201);
  });

  // POST /api/annotations/items/:id/skip
  app.post('/items/:id/skip', async (c) => {
    const qs = getStore();
    if (!qs) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const item = await qs.getItem(tenantId, c.req.param('id'));
    if (!item) return c.json({ error: 'Item not found' }, 404);
    return c.json({ item: await qs.skipItem(tenantId, item.id) });
  });

  return app;
}

/**
 * Human scores + end-user feedback + the unified scores read API (#122).
 *
 * Mounted at /api. Mirrors the eval session-scoring routes: server-emitted,
 * identity-stamped, chained into the session's audit trail via
 * appendEventToSession. The new event types (`human_score`, `feedback`) are
 * server-only — excluded from the client-ingest enum — so a caller can't POST a
 * forged one. Annotator/subject identity is resolved server-side and stamped
 * onto the event; the request body carries no identity fields.
 *
 * Chain semantics: on SDK (chained) sessions the new event extends the hash
 * chain; on OTLP (unchained) sessions it is record-integrity stamped
 * (prevHash=null) so we never synthesize a chain (keeps `chained: false`).
 */
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { humanScoreRequestSchema, feedbackRequestSchema } from '@agentkitai/agentlens-core';
import type { AgentLensEvent, HumanScorePayload, FeedbackPayload, IEventStore, EventType } from '@agentkitai/agentlens-core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId, getTenantStore } from './tenant-helper.js';
import { appendEventToSession } from '../lib/append-event.js';
import { recordHumanScore } from '../lib/human-score.js';
import { resolveAnnotator, sessionVerifiedAgentId } from '../lib/annotator-identity.js';

/**
 * Verify an end-user subject token (HMAC-SHA256 over the subject id, keyed by
 * FEEDBACK_SUBJECT_SECRET): `base64url(subjectId).hex(hmac)`. Returns null when
 * unconfigured or invalid — the subject is then NOT attributed (never trust the
 * raw client value).
 */
function verifySubjectToken(token: string): { subjectId: string; method: string } | null {
  const secret = process.env.FEEDBACK_SUBJECT_SECRET?.trim();
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  let subjectId: string;
  try {
    subjectId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!subjectId) return null;
  const expected = createHmac('sha256', secret).update(subjectId).digest('hex');
  const got = Buffer.from(token.slice(dot + 1));
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
  return { subjectId, method: 'hmac_subject_token' };
}

interface ScoreView {
  eventId: string;
  sessionId: string;
  agentId: string;
  eventType: 'eval_result' | 'human_score';
  method: 'deterministic' | 'llm_judge' | 'human';
  scorerType?: string;
  score?: number;
  passed?: boolean;
  verdict?: string;
  reasoning?: string;
  identity: { kind: 'agent' | 'human' | 'system'; verifiedAgentId?: string; userId?: string; role?: string };
  timestamp: string;
}

/** Project an eval_result / human_score event into the unified score view. */
function toScoreView(e: AgentLensEvent): ScoreView | null {
  const base = { eventId: e.id, sessionId: e.sessionId, agentId: e.agentId, timestamp: e.timestamp };
  if (e.eventType === 'eval_result') {
    const p = e.payload as { method?: ScoreView['method']; scorerType?: string; score?: number; passed?: boolean; reasoning?: string };
    const v = e.metadata?.verifiedAgentId;
    return {
      ...base,
      eventType: 'eval_result',
      method: p.method ?? 'deterministic',
      scorerType: p.scorerType,
      score: p.score,
      passed: p.passed,
      reasoning: p.reasoning,
      identity: { kind: 'system', verifiedAgentId: typeof v === 'string' ? v : undefined },
    };
  }
  if (e.eventType === 'human_score') {
    const p = e.payload as HumanScorePayload;
    return {
      ...base,
      eventType: 'human_score',
      method: 'human',
      score: p.score,
      passed: p.passed,
      verdict: p.verdict,
      reasoning: p.reasoning,
      identity: p.annotatorAgentId
        ? { kind: 'agent', verifiedAgentId: p.annotatorAgentId }
        : { kind: 'human', userId: p.annotatorUserId, role: p.annotatorRole },
    };
  }
  return null;
}

export function scoresRoutes(store?: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/sessions/:sessionId/human-score
  app.post('/sessions/:sessionId/human-score', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);
    const tenantStore = getTenantStore(store, c);
    const tenantId = getTenantId(c);
    const sessionId = c.req.param('sessionId');

    const parsed = humanScoreRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);

    const timeline = await tenantStore.getSessionTimeline(sessionId);
    if (timeline.length === 0) return c.json({ error: 'Session not found or has no events' }, 404);
    const agentId = timeline[0]!.agentId;
    const verifiedAgentId = sessionVerifiedAgentId(timeline);
    const unchained = timeline.every((e) => e.prevHash === null);

    const annotator = await resolveAnnotator(c);
    const d = parsed.data;

    let result;
    try {
      result = await recordHumanScore(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        verifiedAgentId,
        unchained,
        annotator,
        input: d,
      });
    } catch (err) {
      return c.json({ error: `Failed to record human score: ${(err as Error).message}` }, 409);
    }

    const { event, passed } = result;
    return c.json(
      { sessionId, score: d.score, verdict: d.verdict, passed, event: { id: event.id, hash: event.hash, prevHash: event.prevHash } },
      201,
    );
  });

  // POST /api/sessions/:sessionId/feedback
  app.post('/sessions/:sessionId/feedback', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);
    const tenantStore = getTenantStore(store, c);
    const tenantId = getTenantId(c);
    const sessionId = c.req.param('sessionId');

    const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);

    const timeline = await tenantStore.getSessionTimeline(sessionId);
    if (timeline.length === 0) return c.json({ error: 'Session not found or has no events' }, 404);
    const agentId = timeline[0]!.agentId;
    const verifiedAgentId = sessionVerifiedAgentId(timeline);
    const unchained = timeline.every((e) => e.prevHash === null);

    const d = parsed.data;
    const subject = d.subjectToken ? verifySubjectToken(d.subjectToken) : null;
    const kind: FeedbackPayload['kind'] = d.kind ?? (d.sentiment ? 'thumbs' : 'rating');

    const payload: FeedbackPayload = {
      kind,
      ...(d.rating !== undefined ? { rating: d.rating } : {}),
      ...(d.sentiment ? { sentiment: d.sentiment } : {}),
      ...(d.comment ? { comment: d.comment } : {}),
      ...(verifiedAgentId ? { verifiedAgentId } : {}),
      ...(subject ? { subjectId: subject.subjectId, subjectMethod: subject.method } : {}),
    };

    let event;
    try {
      event = await appendEventToSession(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        eventType: 'feedback',
        severity: d.sentiment === 'down' ? 'warn' : 'info',
        payload,
        metadata: { source: 'feedback', ...(verifiedAgentId ? { verifiedAgentId } : {}) },
        unchained,
      });
    } catch (err) {
      return c.json({ error: `Failed to record feedback: ${(err as Error).message}` }, 409);
    }

    return c.json({ sessionId, subjectAttributed: !!subject, event: { id: event.id, hash: event.hash, prevHash: event.prevHash } }, 201);
  });

  // GET /api/sessions/:sessionId/scores — automated + human scores for a session
  app.get('/sessions/:sessionId/scores', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);
    const tenantStore = getTenantStore(store, c);
    const sessionId = c.req.param('sessionId');
    const timeline = await tenantStore.getSessionTimeline(sessionId);
    const scores = timeline.map(toScoreView).filter((s): s is ScoreView => s !== null);
    return c.json({ sessionId, scores });
  });

  // GET /api/scores?agentId=&from=&to=&limit= — cross-session unified scores
  app.get('/scores', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);
    const tenantStore = getTenantStore(store, c);
    const agentId = c.req.query('agentId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = c.req.query('limit') ? Math.min(Math.max(parseInt(c.req.query('limit')!, 10) || 100, 1), 500) : 100;

    const result = await tenantStore.queryEvents({
      ...(agentId ? { agentId } : {}),
      eventType: ['eval_result', 'human_score'] as EventType[],
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit,
      order: 'desc',
    });
    const scores = result.events.map(toScoreView).filter((s): s is ScoreView => s !== null);
    return c.json({ scores, total: result.total, hasMore: result.hasMore });
  });

  return app;
}

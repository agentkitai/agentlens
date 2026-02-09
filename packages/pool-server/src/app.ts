// Pool server Hono application

import { Hono } from 'hono';
import type { PoolStore } from './store.js';
import { RateLimiter } from './rate-limiter.js';

export interface PoolAppOptions {
  store: PoolStore;
  rateLimiter?: RateLimiter;
}

export function createPoolApp(options: PoolAppOptions): Hono {
  const { store } = options;
  const rateLimiter = options.rateLimiter ?? new RateLimiter(100, 60_000);

  const app = new Hono();

  // ─── Health ───

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() });
  });

  // ─── Pool Lesson API ───

  app.post('/pool/share', async (c) => {
    const body = await c.req.json();
    const { anonymousContributorId, category, title, content, embedding, qualitySignals } = body;

    if (!anonymousContributorId || !category || !title || !content || !Array.isArray(embedding)) {
      return c.json({ error: 'Missing required fields: anonymousContributorId, category, title, content, embedding' }, 400);
    }

    if (!rateLimiter.isAllowed(anonymousContributorId)) {
      return c.json({ error: 'Rate limit exceeded (100 req/min)' }, 429);
    }

    const lesson = await store.shareLesson({
      anonymousContributorId,
      category,
      title,
      content,
      embedding,
      qualitySignals,
    });
    return c.json(lesson, 201);
  });

  app.post('/pool/search', async (c) => {
    const body = await c.req.json();
    const { embedding, category, minReputation, limit } = body;

    if (!Array.isArray(embedding)) {
      return c.json({ error: 'Missing required field: embedding (array)' }, 400);
    }

    const results = await store.searchLessons({ embedding, category, minReputation, limit });
    return c.json({ results });
  });

  app.delete('/pool/purge', async (c) => {
    const body = await c.req.json();
    const { anonymousContributorId, token } = body;

    if (!anonymousContributorId || !token) {
      return c.json({ error: 'Missing required fields: anonymousContributorId, token' }, 400);
    }

    const purgeToken = await store.getPurgeToken(anonymousContributorId);
    if (!purgeToken || purgeToken.tokenHash !== token) {
      return c.json({ error: 'Invalid purge token' }, 403);
    }

    const deleted = await store.deleteLessonsByContributor(anonymousContributorId);
    return c.json({ deleted });
  });

  app.get('/pool/count', async (c) => {
    const contributorId = c.req.query('contributorId');
    if (!contributorId) {
      return c.json({ error: 'Missing query parameter: contributorId' }, 400);
    }

    const count = await store.countLessonsByContributor(contributorId);
    return c.json({ count });
  });

  // ─── Pool Discovery & Delegation API ───

  app.post('/pool/register', async (c) => {
    const body = await c.req.json();
    const { anonymousAgentId, taskType, inputSchema, outputSchema } = body;

    if (!anonymousAgentId || !taskType || !inputSchema || !outputSchema) {
      return c.json({ error: 'Missing required fields: anonymousAgentId, taskType, inputSchema, outputSchema' }, 400);
    }

    if (taskType === 'custom' && !body.customType) {
      return c.json({ error: 'customType is required when taskType is "custom"' }, 400);
    }

    if (body.customType && (typeof body.customType !== 'string' || body.customType.length > 64 || !/^[a-zA-Z0-9-]+$/.test(body.customType))) {
      return c.json({ error: 'customType must be alphanumeric+hyphens, max 64 chars' }, 400);
    }

    const cap = await store.registerCapability({
      anonymousAgentId,
      taskType,
      customType: body.customType,
      inputSchema,
      outputSchema,
      qualityMetrics: body.qualityMetrics,
      trustScorePercentile: body.trustScorePercentile,
      estimatedLatencyMs: body.estimatedLatencyMs,
      estimatedCostUsd: body.estimatedCostUsd,
      maxInputBytes: body.maxInputBytes,
      scope: body.scope,
    });
    return c.json(cap, 201);
  });

  app.post('/pool/discover', async (c) => {
    const body = await c.req.json();
    const results = await store.discoverCapabilities({
      taskType: body.taskType,
      customType: body.customType,
      minTrust: body.minTrust,
      maxLatencyMs: body.maxLatencyMs,
      maxCostUsd: body.maxCostUsd,
      limit: body.limit,
    });
    return c.json({ results });
  });

  app.delete('/pool/unregister', async (c) => {
    const body = await c.req.json();
    const { id } = body;

    if (!id) {
      return c.json({ error: 'Missing required field: id' }, 400);
    }

    const removed = await store.unregisterCapability(id);
    if (!removed) {
      return c.json({ error: 'Capability not found' }, 404);
    }
    return c.json({ success: true });
  });

  app.post('/pool/delegate', async (c) => {
    const body = await c.req.json();
    const { id, requesterAnonymousId, targetAnonymousId, taskType, inputData, timeoutMs } = body;

    if (!id || !requesterAnonymousId || !targetAnonymousId || !taskType || inputData === undefined || !timeoutMs) {
      return c.json({ error: 'Missing required fields: id, requesterAnonymousId, targetAnonymousId, taskType, inputData, timeoutMs' }, 400);
    }

    const delegation = await store.createDelegation({
      id,
      requesterAnonymousId,
      targetAnonymousId,
      taskType,
      inputData,
      timeoutMs,
    });
    return c.json(delegation, 201);
  });

  app.get('/pool/delegate/inbox', async (c) => {
    const targetId = c.req.query('targetAnonymousId');
    if (!targetId) {
      return c.json({ error: 'Missing query parameter: targetAnonymousId' }, 400);
    }

    const requests = await store.getDelegationInbox(targetId);
    return c.json({ requests });
  });

  // ─── Pool Reputation API ───

  app.post('/pool/reputation/rate', async (c) => {
    const body = await c.req.json();
    const { lessonId, voterAnonymousId, delta, reason } = body;

    if (!lessonId || !voterAnonymousId || delta === undefined || !reason) {
      return c.json({ error: 'Missing required fields: lessonId, voterAnonymousId, delta, reason' }, 400);
    }

    // Check daily cap: ±5 per voter per day
    const events = await store.getReputationEvents(lessonId);
    const todayStart = Math.floor(Date.now() / 86400000) * 86400; // epoch seconds for start of day
    const todayVoterEvents = events.filter(
      (e) => e.voterAnonymousId === voterAnonymousId && e.createdEpoch >= todayStart,
    );
    if (todayVoterEvents.length >= 5) {
      return c.json({ error: 'Daily rating cap exceeded (max 5 per voter per day)' }, 429);
    }

    const event = await store.addReputationEvent({
      lessonId,
      voterAnonymousId,
      delta,
      reason,
      createdEpoch: Math.floor(Date.now() / 1000),
    });

    // Recompute lesson reputation
    const allEvents = await store.getReputationEvents(lessonId);
    const totalDelta = allEvents.reduce((sum, e) => sum + e.delta, 0);
    const newScore = 50 + totalDelta; // base 50
    await store.updateLessonReputation(lessonId, newScore);

    // Auto-hide if below threshold
    const REPUTATION_THRESHOLD = 20;
    if (newScore < REPUTATION_THRESHOLD) {
      await store.setLessonHidden(lessonId, true);
    } else {
      await store.setLessonHidden(lessonId, false);
    }

    const lesson = await store.getLessonById(lessonId);

    return c.json({ event, lesson }, 200);
  });

  app.get('/pool/reputation/:lessonId', async (c) => {
    const lessonId = c.req.param('lessonId');
    const events = await store.getReputationEvents(lessonId);
    const lesson = await store.getLessonById(lessonId);
    return c.json({
      lessonId,
      reputationScore: lesson?.reputationScore ?? 50,
      events,
    });
  });

  // ─── Pool Moderation API ───

  app.post('/pool/flag', async (c) => {
    const body = await c.req.json();
    const { lessonId, reporterAnonymousId, reason } = body;

    if (!lessonId || !reporterAnonymousId || !reason) {
      return c.json({ error: 'Missing required fields: lessonId, reporterAnonymousId, reason' }, 400);
    }

    const validReasons = ['spam', 'harmful', 'low_quality', 'sensitive_data'];
    if (!validReasons.includes(reason)) {
      return c.json({ error: `reason must be one of: ${validReasons.join(', ')}` }, 400);
    }

    // Check if already flagged by this reporter
    const alreadyFlagged = await store.hasAlreadyFlagged(lessonId, reporterAnonymousId);
    if (alreadyFlagged) {
      return c.json({ error: 'Already flagged by this reporter' }, 409);
    }

    const flag = await store.addModerationFlag({
      lessonId,
      reporterAnonymousId,
      reason: reason as 'spam' | 'harmful' | 'low_quality' | 'sensitive_data',
      createdEpoch: Math.floor(Date.now() / 1000),
    });

    // Check auto-hide threshold (3+ flags)
    const allFlags = await store.getModerationFlags(lessonId);
    const distinctReporters = new Set(allFlags.map((f) => f.reporterAnonymousId));
    await store.updateLessonFlagCount(lessonId, distinctReporters.size);

    if (distinctReporters.size >= 3) {
      await store.setLessonHidden(lessonId, true);
    }

    return c.json({ flag, flagCount: distinctReporters.size }, 201);
  });

  app.get('/pool/moderation/queue', async (c) => {
    // Return all hidden lessons (flagged or low reputation)
    const results = await store.searchLessons({ embedding: [], limit: 100 });
    // We need a method to get flagged lessons - for now filter from store
    return c.json({ queue: results.filter((r) => r.lesson.hidden || r.lesson.flagCount >= 3) });
  });

  app.post('/pool/moderation/:id/approve', async (c) => {
    const lessonId = c.req.param('id');
    const lesson = await store.getLessonById(lessonId);
    if (!lesson) return c.json({ error: 'Lesson not found' }, 404);

    await store.setLessonHidden(lessonId, false);
    await store.updateLessonFlagCount(lessonId, 0);
    return c.json({ success: true, lessonId });
  });

  app.post('/pool/moderation/:id/remove', async (c) => {
    const lessonId = c.req.param('id');
    const lesson = await store.getLessonById(lessonId);
    if (!lesson) return c.json({ error: 'Lesson not found' }, 404);

    await store.setLessonHidden(lessonId, true);
    return c.json({ success: true, lessonId });
  });

  app.put('/pool/delegate/:id/status', async (c) => {
    const delegationId = c.req.param('id');
    const body = await c.req.json();
    const { status, outputData } = body;

    const validStatuses = ['accepted', 'rejected', 'completed', 'error'];
    if (!status || !validStatuses.includes(status)) {
      return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400);
    }

    const updated = await store.updateDelegationStatus(delegationId, status, outputData);
    if (!updated) {
      return c.json({ error: 'Delegation not found' }, 404);
    }
    return c.json(updated);
  });

  return app;
}

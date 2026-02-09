/**
 * Tests for Pool Server Reputation & Moderation APIs (Stories 4.4, 4.5)
 * Tests the pool-side endpoints added in Batch 6.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPoolApp } from '../app.js';
import { InMemoryPoolStore } from '../store.js';
import type { Hono } from 'hono';

describe('Pool Server — Reputation & Moderation', () => {
  let app: Hono;
  let store: InMemoryPoolStore;

  async function shareSampleLesson(contributorId = 'contributor-1'): Promise<string> {
    const res = await app.request('/pool/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousContributorId: contributorId,
        category: 'general',
        title: 'Test Lesson',
        content: 'Some content',
        embedding: [0.1, 0.2, 0.3],
        redactionApplied: true,
        redactionFindingsCount: 0,
      }),
    });
    const data = await res.json() as any;
    return data.id;
  }

  beforeEach(() => {
    store = new InMemoryPoolStore();
    app = createPoolApp({ store });
  });

  // ════════════════════════════════════════════
  // Reputation: POST /pool/reputation/rate
  // ════════════════════════════════════════════

  describe('POST /pool/reputation/rate', () => {
    it('rates a lesson successfully', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-1',
          delta: 5,
          reason: 'helpful',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.lesson.reputationScore).toBe(55);
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('enforces daily cap of 5 ratings per voter', async () => {
      const lessonId = await shareSampleLesson();
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/pool/reputation/rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId,
            voterAnonymousId: 'voter-cap',
            delta: 1,
            reason: 'helpful',
          }),
        });
        expect(res.status).toBe(200);
      }
      const res = await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-cap',
          delta: 1,
          reason: 'helpful',
        }),
      });
      expect(res.status).toBe(429);
    });

    it('negative rating decreases score', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-1',
          delta: -10,
          reason: 'unhelpful',
        }),
      });
      const data = await res.json() as any;
      expect(data.lesson.reputationScore).toBe(40);
    });

    it('auto-hides lesson below threshold 20', async () => {
      const lessonId = await shareSampleLesson();
      await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-1',
          delta: -35,
          reason: 'terrible',
        }),
      });
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(true);
    });

    it('un-hides lesson when reputation rises above threshold', async () => {
      const lessonId = await shareSampleLesson();
      // Drop below 20
      await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-1',
          delta: -35,
          reason: 'bad',
        }),
      });
      // Raise above 20
      await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-2',
          delta: 40,
          reason: 'good',
        }),
      });
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(false);
    });
  });

  // ════════════════════════════════════════════
  // Reputation: GET /pool/reputation/:lessonId
  // ════════════════════════════════════════════

  describe('GET /pool/reputation/:lessonId', () => {
    it('returns reputation info', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request(`/pool/reputation/${lessonId}`);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.reputationScore).toBe(50);
      expect(data.events).toEqual([]);
    });

    it('includes events after rating', async () => {
      const lessonId = await shareSampleLesson();
      await app.request('/pool/reputation/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          voterAnonymousId: 'voter-1',
          delta: 3,
          reason: 'helpful',
        }),
      });
      const res = await app.request(`/pool/reputation/${lessonId}`);
      const data = await res.json() as any;
      expect(data.events.length).toBe(1);
      expect(data.reputationScore).toBe(53);
    });
  });

  // ════════════════════════════════════════════
  // Flagging: POST /pool/flag
  // ════════════════════════════════════════════

  describe('POST /pool/flag', () => {
    it('flags a lesson', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request('/pool/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          reporterAnonymousId: 'reporter-1',
          reason: 'spam',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.flagCount).toBe(1);
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.request('/pool/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid reason', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request('/pool/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          reporterAnonymousId: 'reporter-1',
          reason: 'invalid_reason',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('prevents duplicate flags from same reporter', async () => {
      const lessonId = await shareSampleLesson();
      await app.request('/pool/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          reporterAnonymousId: 'reporter-1',
          reason: 'spam',
        }),
      });
      const res = await app.request('/pool/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          reporterAnonymousId: 'reporter-1',
          reason: 'harmful',
        }),
      });
      expect(res.status).toBe(409);
    });

    it('auto-hides at 3 flags from distinct reporters', async () => {
      const lessonId = await shareSampleLesson();
      for (let i = 1; i <= 3; i++) {
        await app.request('/pool/flag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId,
            reporterAnonymousId: `reporter-${i}`,
            reason: 'spam',
          }),
        });
      }
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(true);
      expect(lesson?.flagCount).toBe(3);
    });

    it('does not auto-hide at 2 flags', async () => {
      const lessonId = await shareSampleLesson();
      for (let i = 1; i <= 2; i++) {
        await app.request('/pool/flag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId,
            reporterAnonymousId: `reporter-${i}`,
            reason: 'spam',
          }),
        });
      }
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(false);
    });
  });

  // ════════════════════════════════════════════
  // Moderation endpoints
  // ════════════════════════════════════════════

  describe('moderation endpoints', () => {
    it('POST /pool/moderation/:id/approve un-hides lesson', async () => {
      const lessonId = await shareSampleLesson();
      await store.setLessonHidden(lessonId, true);

      const res = await app.request(`/pool/moderation/${lessonId}/approve`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(false);
    });

    it('POST /pool/moderation/:id/remove hides lesson', async () => {
      const lessonId = await shareSampleLesson();
      const res = await app.request(`/pool/moderation/${lessonId}/remove`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.hidden).toBe(true);
    });

    it('approve returns 404 for non-existent lesson', async () => {
      const res = await app.request('/pool/moderation/nonexistent/approve', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('remove returns 404 for non-existent lesson', async () => {
      const res = await app.request('/pool/moderation/nonexistent/remove', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('approve resets flag count', async () => {
      const lessonId = await shareSampleLesson();
      await store.updateLessonFlagCount(lessonId, 5);
      await app.request(`/pool/moderation/${lessonId}/approve`, {
        method: 'POST',
      });
      const lesson = await store.getLessonById(lessonId);
      expect(lesson?.flagCount).toBe(0);
    });
  });
});

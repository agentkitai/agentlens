/**
 * Tests for pool server security fixes (H3, C2, M3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPoolApp } from '../app.js';
import { InMemoryPoolStore } from '../store.js';
import { RateLimiter } from '../rate-limiter.js';

function json(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('Pool Server Security Fixes', () => {
  let app: ReturnType<typeof createPoolApp>;
  let store: InMemoryPoolStore;

  beforeEach(() => {
    store = new InMemoryPoolStore();
    app = createPoolApp({ store, rateLimiter: new RateLimiter(1000, 60_000) });
  });

  // ═══════════════════════════════════════════════════
  // H3: Pool rejects shares without redaction metadata
  // ═══════════════════════════════════════════════════

  describe('H3: redaction validation on share', () => {
    it('should reject share without redactionApplied', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1',
        category: 'debug',
        title: 'Title',
        content: 'Content',
        embedding: [1, 0, 0],
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('redactionApplied');
    });

    it('should reject share with redactionApplied: false', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1',
        category: 'debug',
        title: 'Title',
        content: 'Content',
        embedding: [1, 0, 0],
        redactionApplied: false,
        redactionFindingsCount: 0,
      }));
      expect(res.status).toBe(400);
    });

    it('should accept share with valid redaction metadata', async () => {
      const res = await app.request('/pool/share', json({
        anonymousContributorId: 'c1',
        category: 'debug',
        title: 'Title',
        content: 'Content',
        embedding: [1, 0, 0],
        redactionApplied: true,
        redactionFindingsCount: 3,
      }));
      expect(res.status).toBe(201);
    });
  });

  // ═══════════════════════════════════════════════════
  // C2: Purge token registration endpoint
  // ═══════════════════════════════════════════════════

  describe('C2: purge token registration', () => {
    it('should register a purge token', async () => {
      const res = await app.request('/pool/purge-token', json({
        anonymousContributorId: 'c1',
        token: 'my-token',
      }));
      expect(res.status).toBe(201);
    });

    it('should reject registration with missing fields', async () => {
      const res = await app.request('/pool/purge-token', json({}));
      expect(res.status).toBe(400);
    });

    it('should allow purge after token registration', async () => {
      // Register token
      await app.request('/pool/purge-token', json({
        anonymousContributorId: 'c1',
        token: 'my-token',
      }));

      // Share a lesson
      await app.request('/pool/share', json({
        anonymousContributorId: 'c1',
        category: 'debug',
        title: 'T',
        content: 'C',
        embedding: [1],
        redactionApplied: true,
        redactionFindingsCount: 0,
      }));

      // Purge with registered token
      const res = await app.request('/pool/purge', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousContributorId: 'c1', token: 'my-token' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════
  // M3: Moderation queue fix
  // ═══════════════════════════════════════════════════

  describe('M3: moderation queue returns hidden lessons', () => {
    it('should return hidden lessons in moderation queue', async () => {
      // Share a lesson
      const shareRes = await app.request('/pool/share', json({
        anonymousContributorId: 'c1',
        category: 'debug',
        title: 'Test',
        content: 'Content',
        embedding: [1],
        redactionApplied: true,
        redactionFindingsCount: 0,
      }));
      const { id } = await shareRes.json() as any;

      // Hide it
      await store.setLessonHidden(id, true);

      // Check moderation queue
      const queueRes = await app.request('/pool/moderation/queue');
      const { queue } = await queueRes.json() as any;
      expect(queue.length).toBe(1);
      expect(queue[0].lesson.id).toBe(id);
    });
  });
});

/**
 * Tests for Community REST API (Stories 4.1–4.3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';
import { LessonStore } from '../db/lesson-store.js';
import { CommunityService, LocalCommunityPoolTransport } from '../services/community-service.js';

describe('Community REST API (Stories 4.1–4.3)', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;

  function enableSharing() {
    // Directly update sharing config in DB
    const service = new CommunityService(ctx.db, { transport: new LocalCommunityPoolTransport() });
    service.updateSharingConfig('default', { enabled: true });
  }

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create('default', {
      title: 'Test Lesson',
      content: 'Some content about error patterns',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
  });

  // ─── POST /api/community/share ────────────────────

  describe('POST /api/community/share', () => {
    it('should require lessonId', async () => {
      const res = await ctx.app.request('/api/community/share', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('should return 403 when sharing is disabled', async () => {
      const lesson = createLesson();
      const res = await ctx.app.request('/api/community/share', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ lessonId: lesson.id }),
      });
      expect(res.status).toBe(403);
    });

    it('should return 201 when sharing succeeds', async () => {
      enableSharing();
      const lesson = createLesson();
      const res = await ctx.app.request('/api/community/share', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ lessonId: lesson.id }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('shared');
      expect(body.anonymousLessonId).toBeTruthy();
    });

    it('should return 500 when lesson not found', async () => {
      enableSharing();
      const res = await ctx.app.request('/api/community/share', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ lessonId: 'nonexistent' }),
      });
      expect(res.status).toBe(500);
    });
  });

  // ─── GET /api/community/search ────────────────────

  describe('GET /api/community/search', () => {
    it('should require q parameter', async () => {
      const res = await ctx.app.request('/api/community/search', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(400);
    });

    it('should return results', async () => {
      const res = await ctx.app.request('/api/community/search?q=test', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('lessons');
      expect(body).toHaveProperty('query', 'test');
    });

    it('should reject invalid category', async () => {
      const res = await ctx.app.request('/api/community/search?q=test&category=invalid', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET/PUT /api/community/config ────────────────

  describe('GET /api/community/config', () => {
    it('should return default config', async () => {
      const res = await ctx.app.request('/api/community/config', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
    });
  });

  describe('PUT /api/community/config', () => {
    it('should update config', async () => {
      const res = await ctx.app.request('/api/community/config', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(true);
    });

    it('should reject invalid rateLimitPerHour', async () => {
      const res = await ctx.app.request('/api/community/config', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ rateLimitPerHour: 0 }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Agent Config ─────────────────────────────────

  describe('GET /api/community/config/agents/:agentId', () => {
    it('should return default agent config', async () => {
      const res = await ctx.app.request('/api/community/config/agents/agent-1', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.enabled).toBe(false);
    });
  });

  describe('PUT /api/community/config/agents/:agentId', () => {
    it('should update agent config', async () => {
      const res = await ctx.app.request('/api/community/config/agents/agent-1', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ enabled: true, categories: ['error-patterns'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.enabled).toBe(true);
      expect(body.config.categories).toEqual(['error-patterns']);
    });

    it('should reject invalid categories', async () => {
      const res = await ctx.app.request('/api/community/config/agents/agent-1', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ categories: ['invalid-category'] }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Deny List ────────────────────────────────────

  describe('GET /api/community/deny-list', () => {
    it('should return empty list initially', async () => {
      const res = await ctx.app.request('/api/community/deny-list', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toEqual([]);
    });
  });

  describe('POST /api/community/deny-list', () => {
    it('should add a deny list rule', async () => {
      const res = await ctx.app.request('/api/community/deny-list', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ pattern: 'secret', reason: 'confidential' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.rule.pattern).toBe('secret');
    });

    it('should require pattern', async () => {
      const res = await ctx.app.request('/api/community/deny-list', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ reason: 'no pattern' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/community/deny-list/:id', () => {
    it('should delete a deny list rule', async () => {
      // Create first
      const createRes = await ctx.app.request('/api/community/deny-list', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ pattern: 'to-delete', reason: 'temp' }),
      });
      const { rule } = await createRes.json();

      const res = await ctx.app.request(`/api/community/deny-list/${rule.id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
    });

    it('should return 404 for nonexistent rule', async () => {
      const res = await ctx.app.request('/api/community/deny-list/nonexistent', {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });
  });
});

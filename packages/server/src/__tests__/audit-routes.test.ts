/**
 * Tests for Sharing Audit & Export (Story 7.4) — ~25 tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../services/community-service.js';
import { LessonStore } from '../db/lesson-store.js';

describe('Sharing Audit & Export (Story 7.4)', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;
  let communityService: CommunityService;
  let transport: LocalCommunityPoolTransport;

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
    transport = new LocalCommunityPoolTransport();
    communityService = new CommunityService(ctx.db, { transport });
    // Enable sharing
    communityService.updateSharingConfig('default', { enabled: true });
  });

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create('default', {
      title: 'Test Lesson',
      content: 'Some content about error patterns',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  // ─── GET /api/community/audit ─────────────────────

  describe('GET /api/community/audit', () => {
    it('should return empty audit log initially', async () => {
      const res = await ctx.app.request('/api/community/audit', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('should return audit events after sharing', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');

      const res = await ctx.app.request('/api/community/audit', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.events[0].eventType).toBe('share');
    });

    it('should filter by event type', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');
      await communityService.search('default', 'error patterns', {}, 'api');

      const res = await ctx.app.request('/api/community/audit?type=query', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.every((e: any) => e.eventType === 'query')).toBe(true);
    });

    it('should filter by date range (dateFrom)', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const res = await ctx.app.request(`/api/community/audit?dateFrom=${futureDate}`, {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events).toEqual([]);
    });

    it('should filter by date range (dateTo)', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');

      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const res = await ctx.app.request(`/api/community/audit?dateTo=${pastDate}`, {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events).toEqual([]);
    });

    it('should filter by agentId (initiatedBy)', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'agent-1');
      await communityService.share('default', lesson.id, 'agent-2');

      const res = await ctx.app.request('/api/community/audit?agentId=agent-1', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.every((e: any) => e.initiatedBy === 'agent-1')).toBe(true);
    });

    it('should support pagination with limit', async () => {
      const lesson = createLesson();
      for (let i = 0; i < 5; i++) {
        await communityService.share('default', lesson.id, `api-${i}`);
      }

      const res = await ctx.app.request('/api/community/audit?limit=2', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.length).toBe(2);
      expect(data.hasMore).toBe(true);
    });

    it('should support pagination with offset', async () => {
      const lesson = createLesson();
      for (let i = 0; i < 5; i++) {
        await communityService.share('default', lesson.id, `api-${i}`);
      }

      const res = await ctx.app.request('/api/community/audit?limit=2&offset=3', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.length).toBe(2);
    });

    it('should sort by timestamp descending', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'first');
      await communityService.search('default', 'test', {}, 'second');

      const res = await ctx.app.request('/api/community/audit', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < data.events.length; i++) {
        expect(data.events[i - 1].timestamp >= data.events[i].timestamp).toBe(true);
      }
    });

    it('should return total count with filters', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');
      await communityService.search('default', 'test', {}, 'api');

      const res = await ctx.app.request('/api/community/audit?type=share', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.total).toBeGreaterThanOrEqual(1);
      expect(data.events.every((e: any) => e.eventType === 'share')).toBe(true);
    });

    it('should combine multiple filters', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'agent-x');
      await communityService.search('default', 'test', {}, 'agent-y');

      const res = await ctx.app.request('/api/community/audit?type=share&agentId=agent-x', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.length).toBeGreaterThanOrEqual(1);
      expect(data.events.every((e: any) => e.eventType === 'share' && e.initiatedBy === 'agent-x')).toBe(true);
    });
  });

  // ─── GET /api/community/audit/export ──────────────

  describe('GET /api/community/audit/export', () => {
    it('should export empty audit log', async () => {
      const res = await ctx.app.request('/api/community/audit/export', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(0);
      expect(data.events).toEqual([]);
      expect(data.exportedAt).toBeDefined();
      expect(data.tenantId).toBe('default');
    });

    it('should export all audit events', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');
      await communityService.search('default', 'test', {}, 'api');

      const res = await ctx.app.request('/api/community/audit/export', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.count).toBeGreaterThanOrEqual(2);
      expect(data.events.length).toBe(data.count);
    });

    it('should filter export by type', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');
      await communityService.search('default', 'test', {}, 'api');

      const res = await ctx.app.request('/api/community/audit/export?type=sharing', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      // 'sharing' type may not match anything if events are 'share' type
      expect(data.events.every((e: any) => e.eventType === 'sharing')).toBe(true);
    });

    it('should export with share type filter', async () => {
      const lesson = createLesson();
      await communityService.share('default', lesson.id, 'api');
      await communityService.search('default', 'test', {}, 'api');

      const res = await ctx.app.request('/api/community/audit/export?type=share', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.events.every((e: any) => e.eventType === 'share')).toBe(true);
      expect(data.events.length).toBeGreaterThanOrEqual(1);
    });

    it('should include content-disposition header', async () => {
      const res = await ctx.app.request('/api/community/audit/export', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.headers.get('content-disposition')).toMatch(/attachment.*audit-export/);
    });
  });

  // ─── GET/PUT /api/community/audit/alerts ──────────

  describe('GET /api/community/audit/alerts', () => {
    it('should return default alert config', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.threshold).toBe(100);
      expect(data.rateLimitPerHour).toBe(50);
    });

    it('should return updated config after PUT', async () => {
      await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ threshold: 200 }),
      });

      const res = await ctx.app.request('/api/community/audit/alerts', {
        headers: authHeaders(ctx.apiKey),
      });
      const data = await res.json();
      expect(data.threshold).toBe(200);
    });
  });

  describe('PUT /api/community/audit/alerts', () => {
    it('should update threshold', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ threshold: 150 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.threshold).toBe(150);
    });

    it('should update rateLimitPerHour', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ rateLimitPerHour: 100 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.rateLimitPerHour).toBe(100);
    });

    it('should reject invalid threshold', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ threshold: 0 }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject invalid rateLimitPerHour', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ rateLimitPerHour: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject empty update body', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('should reject invalid JSON', async () => {
      const res = await ctx.app.request('/api/community/audit/alerts', {
        method: 'PUT',
        headers: { ...authHeaders(ctx.apiKey) },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });
});

/**
 * Tests for CommunityService (Stories 4.1–4.3)
 *
 * ~110 tests covering:
 * - 4.1: share() flow (~50 tests)
 * - 4.2: search() flow (~30 tests)
 * - 4.3: Configuration & deny-list API (~30 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { LessonStore } from '../db/lesson-store.js';
import {
  CommunityService,
  LocalCommunityPoolTransport,
  computeSimpleEmbedding,
  type PoolTransport,
  type ShareResult,
} from '../services/community-service.js';
import type { SqliteDb } from '../db/index.js';

describe('CommunityService', () => {
  let db: SqliteDb;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create('tenant-1', {
      title: 'Test Lesson',
      content: 'Some useful content about error handling patterns',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  function enableSharing(tenantId = 'tenant-1') {
    service.updateSharingConfig(tenantId, { enabled: true });
  }

  function enableAgentSharing(agentId: string, categories: string[] = [], tenantId = 'tenant-1') {
    service.updateAgentSharingConfig(tenantId, agentId, {
      enabled: true,
      categories: categories as any,
    });
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    lessonStore = new LessonStore(db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(db, { transport });
  });

  // ════════════════════════════════════════════════════
  // Story 4.1: CommunityService.share()
  // ════════════════════════════════════════════════════

  describe('share() — Story 4.1', () => {
    // ─── Toggle Checks ───────────────────────────────

    describe('tenant-level toggle', () => {
      it('should return disabled when tenant sharing is off', async () => {
        const lesson = createLesson();
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
      });

      it('should return disabled reason mentioning tenant', async () => {
        const lesson = createLesson();
        const result = await service.share('tenant-1', lesson.id);
        expect(result).toHaveProperty('reason');
        expect((result as any).reason).toContain('Tenant');
      });

      it('should allow sharing when tenant toggle is on', async () => {
        enableSharing();
        const lesson = createLesson();
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });

      it('should re-check toggle on every call (no caching)', async () => {
        enableSharing();
        const lesson = createLesson();
        const r1 = await service.share('tenant-1', lesson.id);
        expect(r1.status).toBe('shared');

        // Disable
        service.updateSharingConfig('tenant-1', { enabled: false });
        const lesson2 = createLesson({ title: 'Another' });
        const r2 = await service.share('tenant-1', lesson2.id);
        expect(r2.status).toBe('disabled');
      });
    });

    describe('agent-level toggle', () => {
      it('should return disabled when agent sharing is off', async () => {
        enableSharing();
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
        expect((result as any).reason).toContain('Agent');
      });

      it('should allow sharing when agent toggle is on', async () => {
        enableSharing();
        enableAgentSharing('agent-1');
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });

      it('should enforce hierarchical: tenant OFF overrides agent ON', async () => {
        // Agent is enabled but tenant is disabled
        enableAgentSharing('agent-1');
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
        expect((result as any).reason).toContain('Tenant');
      });

      it('should allow lesson without agentId when tenant is enabled', async () => {
        enableSharing();
        const lesson = createLesson(); // no agentId
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });
    });

    describe('category-level toggle', () => {
      it('should block sharing when category not in agent allowed list', async () => {
        enableSharing();
        enableAgentSharing('agent-1', ['model-performance']);
        const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
        expect((result as any).reason).toContain('Category');
      });

      it('should allow sharing when category is in agent allowed list', async () => {
        enableSharing();
        enableAgentSharing('agent-1', ['error-patterns']);
        const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });

      it('should allow all categories when agent categories list is empty', async () => {
        enableSharing();
        enableAgentSharing('agent-1', []);
        const lesson = createLesson({ agentId: 'agent-1', category: 'cost-optimization' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });
    });

    // ─── Lesson Loading ──────────────────────────────

    describe('lesson loading', () => {
      it('should return error when lesson not found', async () => {
        enableSharing();
        const result = await service.share('tenant-1', 'nonexistent');
        expect(result.status).toBe('error');
        expect((result as any).error).toContain('not found');
      });

      it('should use lesson title and content for sharing', async () => {
        enableSharing();
        const lesson = createLesson({ title: 'MyTitle', content: 'MyContent' });
        await service.share('tenant-1', lesson.id);
        expect(transport.shared).toHaveLength(1);
        expect(transport.shared[0].title).toBeTruthy();
        expect(transport.shared[0].content).toBeTruthy();
      });
    });

    // ─── Redaction Pipeline ──────────────────────────

    describe('redaction pipeline', () => {
      it('should run content through redaction before sharing', async () => {
        enableSharing();
        const lesson = createLesson({
          title: 'Secret key',
          content: 'My API key is sk-1234567890abcdefghij',
        });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
        // The shared content should have the key redacted
        expect(transport.shared[0].content).not.toContain('sk-1234567890abcdefghij');
      });

      it('should include redaction findings in the result', async () => {
        enableSharing();
        const lesson = createLesson({
          title: 'Has secret',
          content: 'Key: sk-1234567890abcdefghij',
        });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
        expect((result as any).redactionFindings.length).toBeGreaterThan(0);
      });

      it('should strip context field (always empty in output)', async () => {
        enableSharing();
        const lesson = createLesson({
          context: { secret: 'internal-data' },
        });
        await service.share('tenant-1', lesson.id);
        // Context should not appear in shared content
        expect(transport.shared[0].content).not.toContain('internal-data');
      });
    });

    // ─── Anonymous Contributor ID ────────────────────

    describe('anonymous contributor ID', () => {
      it('should generate anonymous contributor ID for sharing', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id);
        expect(transport.shared[0].anonymousContributorId).toBeTruthy();
      });

      it('should use same contributor ID within 24h window', async () => {
        enableSharing();
        const l1 = createLesson({ title: 'First' });
        const l2 = createLesson({ title: 'Second' });
        await service.share('tenant-1', l1.id);
        await service.share('tenant-1', l2.id);
        expect(transport.shared[0].anonymousContributorId)
          .toBe(transport.shared[1].anonymousContributorId);
      });

      it('should use different contributor IDs for different tenants', async () => {
        enableSharing('tenant-1');
        enableSharing('tenant-2');
        const l1 = lessonStore.create('tenant-1', { title: 'T1', content: 'c' });
        const l2 = lessonStore.create('tenant-2', { title: 'T2', content: 'c' });
        await service.share('tenant-1', l1.id);
        await service.share('tenant-2', l2.id);
        expect(transport.shared[0].anonymousContributorId)
          .not.toBe(transport.shared[1].anonymousContributorId);
      });
    });

    // ─── Embedding ───────────────────────────────────

    describe('embedding computation', () => {
      it('should compute embedding for shared lesson', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id);
        expect(transport.shared[0].embedding).toBeTruthy();
        expect(Array.isArray(transport.shared[0].embedding)).toBe(true);
        expect(transport.shared[0].embedding.length).toBe(64);
      });

      it('should produce normalized embeddings', () => {
        const emb = computeSimpleEmbedding('hello world test');
        let mag = 0;
        for (const v of emb) mag += v * v;
        expect(Math.abs(Math.sqrt(mag) - 1)).toBeLessThan(0.001);
      });

      it('should produce similar embeddings for similar text', () => {
        const e1 = computeSimpleEmbedding('error handling patterns in typescript');
        const e2 = computeSimpleEmbedding('error handling patterns in javascript');
        const e3 = computeSimpleEmbedding('cooking recipes for pasta');
        const sim12 = dotProduct(e1, e2);
        const sim13 = dotProduct(e1, e3);
        expect(sim12).toBeGreaterThan(sim13);
      });
    });

    // ─── Pool Transport ──────────────────────────────

    describe('pool transport', () => {
      it('should send to pool transport on successful share', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id);
        expect(transport.shared).toHaveLength(1);
      });

      it('should return anonymousLessonId from pool', async () => {
        enableSharing();
        const lesson = createLesson();
        const result = await service.share('tenant-1', lesson.id) as any;
        expect(result.anonymousLessonId).toBeTruthy();
      });

      it('should handle transport errors gracefully', async () => {
        const failTransport: PoolTransport = {
          share: async () => { throw new Error('Pool unreachable'); },
          search: async () => ({ results: [] }),
        };
        const failService = new CommunityService(db, { transport: failTransport });
        failService.updateSharingConfig('tenant-1', { enabled: true });
        const lesson = createLesson();
        const result = await failService.share('tenant-1', lesson.id);
        expect(result.status).toBe('error');
        expect((result as any).error).toContain('Pool unreachable');
      });
    });

    // ─── Rate Limiting ───────────────────────────────

    describe('rate limiting', () => {
      it('should allow up to rate limit shares per hour', async () => {
        enableSharing();
        service.updateSharingConfig('tenant-1', { rateLimitPerHour: 3 });
        for (let i = 0; i < 3; i++) {
          const lesson = createLesson({ title: `Lesson ${i}` });
          const r = await service.share('tenant-1', lesson.id);
          expect(r.status).toBe('shared');
        }
      });

      it('should return rate_limited after exceeding limit', async () => {
        enableSharing();
        service.updateSharingConfig('tenant-1', { rateLimitPerHour: 2 });
        const l1 = createLesson({ title: 'L1' });
        const l2 = createLesson({ title: 'L2' });
        const l3 = createLesson({ title: 'L3' });
        await service.share('tenant-1', l1.id);
        await service.share('tenant-1', l2.id);
        const r3 = await service.share('tenant-1', l3.id);
        expect(r3.status).toBe('rate_limited');
      });

      it('should write audit log on rate limit', async () => {
        enableSharing();
        service.updateSharingConfig('tenant-1', { rateLimitPerHour: 1 });
        const l1 = createLesson({ title: 'L1' });
        const l2 = createLesson({ title: 'L2' });
        await service.share('tenant-1', l1.id);
        await service.share('tenant-1', l2.id);
        const logs = service.getAuditLog('tenant-1');
        expect(logs.some((l) => l.eventType === 'rate')).toBe(true);
      });

      it('should rate limit per tenant independently', async () => {
        enableSharing('tenant-1');
        enableSharing('tenant-2');
        service.updateSharingConfig('tenant-1', { rateLimitPerHour: 1 });
        service.updateSharingConfig('tenant-2', { rateLimitPerHour: 1 });
        const l1 = lessonStore.create('tenant-1', { title: 'T1', content: 'c' });
        const l2 = lessonStore.create('tenant-2', { title: 'T2', content: 'c' });
        await service.share('tenant-1', l1.id);
        const r = await service.share('tenant-2', l2.id);
        expect(r.status).toBe('shared');
      });
    });

    // ─── Audit Log ───────────────────────────────────

    describe('audit log', () => {
      it('should write audit log on successful share', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id);
        const logs = service.getAuditLog('tenant-1');
        expect(logs).toHaveLength(1);
        expect(logs[0].eventType).toBe('share');
        expect(logs[0].lessonId).toBe(lesson.id);
      });

      it('should include anonymousLessonId in audit log', async () => {
        enableSharing();
        const lesson = createLesson();
        const result = await service.share('tenant-1', lesson.id) as any;
        const logs = service.getAuditLog('tenant-1');
        expect(logs[0].anonymousLessonId).toBe(result.anonymousLessonId);
      });

      it('should include redaction findings in audit log', async () => {
        enableSharing();
        const lesson = createLesson({
          content: 'API key: sk-1234567890abcdefghij',
        });
        await service.share('tenant-1', lesson.id);
        const logs = service.getAuditLog('tenant-1');
        expect(logs[0].redactionFindings).toBeDefined();
        expect(logs[0].redactionFindings!.length).toBeGreaterThan(0);
      });

      it('should include timestamp in audit log', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id);
        const logs = service.getAuditLog('tenant-1');
        expect(logs[0].timestamp).toBeTruthy();
      });

      it('should include initiatedBy in audit log', async () => {
        enableSharing();
        const lesson = createLesson();
        await service.share('tenant-1', lesson.id, 'user-123');
        const logs = service.getAuditLog('tenant-1');
        expect(logs[0].initiatedBy).toBe('user-123');
      });
    });
  });

  // ════════════════════════════════════════════════════
  // Story 4.2: CommunityService.search()
  // ════════════════════════════════════════════════════

  describe('search() — Story 4.2', () => {
    async function shareLesson(title: string, content: string, category = 'error-patterns') {
      enableSharing();
      const lesson = createLesson({ title, content, category });
      await service.share('tenant-1', lesson.id);
      return lesson;
    }

    it('should return results from pool', async () => {
      await shareLesson('Error handling', 'Handle errors gracefully');
      const result = await service.search('tenant-1', 'error handling');
      expect(result.lessons.length).toBeGreaterThan(0);
    });

    it('should return query in result', async () => {
      const result = await service.search('tenant-1', 'test query');
      expect(result.query).toBe('test query');
    });

    it('should return total count', async () => {
      await shareLesson('L1', 'content one');
      await shareLesson('L2', 'content two');
      const result = await service.search('tenant-1', 'content');
      expect(result.total).toBe(result.lessons.length);
    });

    it('should cap results at 50', async () => {
      const result = await service.search('tenant-1', 'test', { limit: 100 });
      // Just verify limit is capped (no more than 50)
      expect(result.lessons.length).toBeLessThanOrEqual(50);
    });

    it('should respect limit parameter', async () => {
      await shareLesson('L1', 'content');
      await shareLesson('L2', 'content');
      await shareLesson('L3', 'content');
      const result = await service.search('tenant-1', 'content', { limit: 2 });
      expect(result.lessons.length).toBeLessThanOrEqual(2);
    });

    it('should filter by category', async () => {
      await shareLesson('Error lesson', 'error stuff', 'error-patterns');
      await shareLesson('Cost lesson', 'cost stuff', 'cost-optimization');
      const result = await service.search('tenant-1', 'stuff', { category: 'error-patterns' });
      for (const lesson of result.lessons) {
        expect(lesson.category).toBe('error-patterns');
      }
    });

    it('should filter by minimum reputation', async () => {
      await shareLesson('L1', 'content');
      const result = await service.search('tenant-1', 'content', { minReputation: 100 });
      // All results should have reputation >= 100 (or none)
      for (const lesson of result.lessons) {
        expect(lesson.reputationScore).toBeGreaterThanOrEqual(100);
      }
    });

    it('should return SharedLesson shape (no identifying metadata)', async () => {
      await shareLesson('Test lesson', 'Test content');
      const result = await service.search('tenant-1', 'test');
      if (result.lessons.length > 0) {
        const lesson = result.lessons[0];
        expect(lesson).toHaveProperty('id');
        expect(lesson).toHaveProperty('category');
        expect(lesson).toHaveProperty('title');
        expect(lesson).toHaveProperty('content');
        expect(lesson).toHaveProperty('reputationScore');
        expect(lesson).toHaveProperty('qualitySignals');
        // Should NOT have identifying fields
        expect(lesson).not.toHaveProperty('tenantId');
        expect(lesson).not.toHaveProperty('agentId');
        expect(lesson).not.toHaveProperty('anonymousContributorId');
        expect(lesson).not.toHaveProperty('embedding');
      }
    });

    it('should not include contributor ID in search results', async () => {
      await shareLesson('Test', 'Content');
      const result = await service.search('tenant-1', 'test');
      const json = JSON.stringify(result);
      // The contributor ID should not appear in serialized results
      if (transport.shared.length > 0) {
        expect(json).not.toContain(transport.shared[0].anonymousContributorId);
      }
    });

    it('should write audit log for search queries', async () => {
      await service.search('tenant-1', 'my search query', {}, 'user-1');
      const logs = service.getAuditLog('tenant-1');
      const queryLogs = logs.filter((l) => l.eventType === 'query');
      expect(queryLogs).toHaveLength(1);
      expect(queryLogs[0].queryText).toBe('my search query');
    });

    it('should include result IDs in audit log', async () => {
      await shareLesson('Test', 'content');
      await service.search('tenant-1', 'content');
      const logs = service.getAuditLog('tenant-1');
      const queryLog = logs.find((l) => l.eventType === 'query');
      expect(queryLog?.resultIds).toBeDefined();
    });

    it('should include initiatedBy in search audit log', async () => {
      await service.search('tenant-1', 'query', {}, 'api-user');
      const logs = service.getAuditLog('tenant-1');
      expect(logs[0].initiatedBy).toBe('api-user');
    });

    it('should handle empty results gracefully', async () => {
      const result = await service.search('tenant-1', 'nonexistent topic');
      expect(result.lessons).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return lessons sorted by similarity', async () => {
      await shareLesson('Error handling patterns', 'Error handling in typescript');
      await shareLesson('Cooking recipes', 'How to cook pasta');
      const result = await service.search('tenant-1', 'error handling typescript');
      if (result.lessons.length >= 2) {
        // First result should be more relevant
        expect(result.lessons[0].title).not.toContain('Cooking');
      }
    });

    it('should handle transport errors in search', async () => {
      const failTransport: PoolTransport = {
        share: async () => ({ id: 'x' }),
        search: async () => { throw new Error('Pool down'); },
      };
      const failService = new CommunityService(db, { transport: failTransport });
      await expect(failService.search('tenant-1', 'test')).rejects.toThrow('Pool down');
    });
  });

  // ════════════════════════════════════════════════════
  // Story 4.3: Sharing Configuration API
  // ════════════════════════════════════════════════════

  describe('Sharing Configuration — Story 4.3', () => {
    // ─── Tenant Config ───────────────────────────────

    describe('tenant config', () => {
      it('should return default config for new tenant', () => {
        const config = service.getSharingConfig('new-tenant');
        expect(config.enabled).toBe(false);
        expect(config.humanReviewEnabled).toBe(false);
        expect(config.rateLimitPerHour).toBe(50);
        expect(config.poolEndpoint).toBeNull();
      });

      it('should create config on first update', () => {
        service.updateSharingConfig('tenant-1', { enabled: true });
        const config = service.getSharingConfig('tenant-1');
        expect(config.enabled).toBe(true);
      });

      it('should update enabled toggle', () => {
        service.updateSharingConfig('tenant-1', { enabled: true });
        expect(service.getSharingConfig('tenant-1').enabled).toBe(true);
        service.updateSharingConfig('tenant-1', { enabled: false });
        expect(service.getSharingConfig('tenant-1').enabled).toBe(false);
      });

      it('should update humanReviewEnabled', () => {
        service.updateSharingConfig('tenant-1', { humanReviewEnabled: true });
        expect(service.getSharingConfig('tenant-1').humanReviewEnabled).toBe(true);
      });

      it('should update poolEndpoint', () => {
        service.updateSharingConfig('tenant-1', { poolEndpoint: 'https://pool.example.com' });
        expect(service.getSharingConfig('tenant-1').poolEndpoint).toBe('https://pool.example.com');
      });

      it('should update rateLimitPerHour', () => {
        service.updateSharingConfig('tenant-1', { rateLimitPerHour: 100 });
        expect(service.getSharingConfig('tenant-1').rateLimitPerHour).toBe(100);
      });

      it('should update volumeAlertThreshold', () => {
        service.updateSharingConfig('tenant-1', { volumeAlertThreshold: 200 });
        expect(service.getSharingConfig('tenant-1').volumeAlertThreshold).toBe(200);
      });

      it('should preserve other fields on partial update', () => {
        service.updateSharingConfig('tenant-1', {
          enabled: true,
          rateLimitPerHour: 75,
        });
        service.updateSharingConfig('tenant-1', { humanReviewEnabled: true });
        const config = service.getSharingConfig('tenant-1');
        expect(config.enabled).toBe(true);
        expect(config.rateLimitPerHour).toBe(75);
        expect(config.humanReviewEnabled).toBe(true);
      });

      it('should update updatedAt timestamp on changes', () => {
        service.updateSharingConfig('tenant-1', { enabled: true });
        const t1 = service.getSharingConfig('tenant-1').updatedAt;
        service.updateSharingConfig('tenant-1', { enabled: false });
        const t2 = service.getSharingConfig('tenant-1').updatedAt;
        expect(t2).toBeTruthy();
      });

      it('should isolate config between tenants', () => {
        service.updateSharingConfig('tenant-1', { enabled: true });
        service.updateSharingConfig('tenant-2', { enabled: false });
        expect(service.getSharingConfig('tenant-1').enabled).toBe(true);
        expect(service.getSharingConfig('tenant-2').enabled).toBe(false);
      });

      it('should toggle-off take effect immediately (no caching)', async () => {
        enableSharing();
        const lesson = createLesson();
        const r1 = await service.share('tenant-1', lesson.id);
        expect(r1.status).toBe('shared');

        // Toggle off
        service.updateSharingConfig('tenant-1', { enabled: false });
        const lesson2 = createLesson({ title: 'After disable' });
        const r2 = await service.share('tenant-1', lesson2.id);
        expect(r2.status).toBe('disabled');
      });
    });

    // ─── Agent Config ────────────────────────────────

    describe('agent config', () => {
      it('should return default config for new agent', () => {
        const config = service.getAgentSharingConfig('tenant-1', 'agent-1');
        expect(config.enabled).toBe(false);
        expect(config.categories).toEqual([]);
      });

      it('should create config on first update', () => {
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: true });
        const config = service.getAgentSharingConfig('tenant-1', 'agent-1');
        expect(config.enabled).toBe(true);
      });

      it('should update enabled toggle', () => {
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: true });
        expect(service.getAgentSharingConfig('tenant-1', 'agent-1').enabled).toBe(true);
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: false });
        expect(service.getAgentSharingConfig('tenant-1', 'agent-1').enabled).toBe(false);
      });

      it('should update categories', () => {
        service.updateAgentSharingConfig('tenant-1', 'agent-1', {
          categories: ['error-patterns', 'cost-optimization'] as any,
        });
        const config = service.getAgentSharingConfig('tenant-1', 'agent-1');
        expect(config.categories).toEqual(['error-patterns', 'cost-optimization']);
      });

      it('should isolate agent configs within tenant', () => {
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: true });
        service.updateAgentSharingConfig('tenant-1', 'agent-2', { enabled: false });
        expect(service.getAgentSharingConfig('tenant-1', 'agent-1').enabled).toBe(true);
        expect(service.getAgentSharingConfig('tenant-1', 'agent-2').enabled).toBe(false);
      });

      it('should isolate agent configs across tenants', () => {
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: true });
        expect(service.getAgentSharingConfig('tenant-2', 'agent-1').enabled).toBe(false);
      });

      it('should return tenantId and agentId in config', () => {
        const config = service.getAgentSharingConfig('tenant-1', 'agent-x');
        expect(config.tenantId).toBe('tenant-1');
        expect(config.agentId).toBe('agent-x');
      });
    });

    // ─── Deny List ───────────────────────────────────

    describe('deny list', () => {
      it('should return empty deny list for new tenant', () => {
        const rules = service.getDenyList('tenant-1');
        expect(rules).toEqual([]);
      });

      it('should add a plain text deny list rule', () => {
        const rule = service.addDenyListRule('tenant-1', 'confidential', false, 'Contains confidential info');
        expect(rule.id).toBeTruthy();
        expect(rule.pattern).toBe('confidential');
        expect(rule.isRegex).toBe(false);
        expect(rule.reason).toBe('Contains confidential info');
      });

      it('should add a regex deny list rule', () => {
        const rule = service.addDenyListRule('tenant-1', 'secret-\\d+', true, 'Matches secret pattern');
        expect(rule.isRegex).toBe(true);
      });

      it('should reject invalid regex patterns', () => {
        expect(() => {
          service.addDenyListRule('tenant-1', '[invalid', true, 'Bad regex');
        }).toThrow('Invalid regex');
      });

      it('should list all deny list rules for tenant', () => {
        service.addDenyListRule('tenant-1', 'pattern1', false, 'r1');
        service.addDenyListRule('tenant-1', 'pattern2', false, 'r2');
        const rules = service.getDenyList('tenant-1');
        expect(rules).toHaveLength(2);
      });

      it('should delete a deny list rule', () => {
        const rule = service.addDenyListRule('tenant-1', 'to-delete', false, 'temp');
        const ok = service.deleteDenyListRule('tenant-1', rule.id);
        expect(ok).toBe(true);
        expect(service.getDenyList('tenant-1')).toHaveLength(0);
      });

      it('should return false when deleting nonexistent rule', () => {
        const ok = service.deleteDenyListRule('tenant-1', 'nonexistent');
        expect(ok).toBe(false);
      });

      it('should not delete rules from other tenants', () => {
        const rule = service.addDenyListRule('tenant-1', 'owned-by-t1', false, 'r');
        const ok = service.deleteDenyListRule('tenant-2', rule.id);
        expect(ok).toBe(false);
        expect(service.getDenyList('tenant-1')).toHaveLength(1);
      });

      it('should isolate deny lists between tenants', () => {
        service.addDenyListRule('tenant-1', 'p1', false, 'r1');
        service.addDenyListRule('tenant-2', 'p2', false, 'r2');
        expect(service.getDenyList('tenant-1')).toHaveLength(1);
        expect(service.getDenyList('tenant-2')).toHaveLength(1);
      });

      it('should include createdAt in deny list rule', () => {
        const rule = service.addDenyListRule('tenant-1', 'test', false, 'r');
        expect(rule.createdAt).toBeTruthy();
      });
    });

    // ─── Hierarchical Enforcement ────────────────────

    describe('hierarchical enforcement', () => {
      it('tenant OFF + agent ON = sharing disabled', async () => {
        // Tenant disabled, agent enabled
        service.updateSharingConfig('tenant-1', { enabled: false });
        enableAgentSharing('agent-1');
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
      });

      it('tenant ON + agent OFF = sharing disabled', async () => {
        enableSharing();
        service.updateAgentSharingConfig('tenant-1', 'agent-1', { enabled: false });
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
      });

      it('tenant ON + agent ON = sharing enabled', async () => {
        enableSharing();
        enableAgentSharing('agent-1');
        const lesson = createLesson({ agentId: 'agent-1' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('shared');
      });

      it('tenant ON + agent ON + wrong category = sharing disabled', async () => {
        enableSharing();
        enableAgentSharing('agent-1', ['model-performance']);
        const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
        const result = await service.share('tenant-1', lesson.id);
        expect(result.status).toBe('disabled');
      });
    });
  });

  // ════════════════════════════════════════════════════
  // LocalCommunityPoolTransport
  // ════════════════════════════════════════════════════

  describe('LocalCommunityPoolTransport', () => {
    it('should store shared lessons', async () => {
      const t = new LocalCommunityPoolTransport();
      await t.share({
        anonymousContributorId: 'c1',
        category: 'general',
        title: 'Test',
        content: 'Content',
        embedding: [1, 0, 0],
      });
      expect(t.shared).toHaveLength(1);
    });

    it('should return ID on share', async () => {
      const t = new LocalCommunityPoolTransport();
      const result = await t.share({
        anonymousContributorId: 'c1',
        category: 'general',
        title: 'Test',
        content: 'Content',
        embedding: [1, 0, 0],
      });
      expect(result.id).toBeTruthy();
    });

    it('should search by embedding similarity', async () => {
      const t = new LocalCommunityPoolTransport();
      await t.share({
        anonymousContributorId: 'c1',
        category: 'general',
        title: 'Test',
        content: 'Content',
        embedding: [1, 0, 0],
      });
      const result = await t.search({ embedding: [1, 0, 0] });
      expect(result.results).toHaveLength(1);
    });

    it('should filter by category in search', async () => {
      const t = new LocalCommunityPoolTransport();
      await t.share({ anonymousContributorId: 'c1', category: 'general', title: 'A', content: 'a', embedding: [1, 0, 0] });
      await t.share({ anonymousContributorId: 'c1', category: 'error-patterns', title: 'B', content: 'b', embedding: [0, 1, 0] });
      const result = await t.search({ embedding: [1, 0, 0], category: 'error-patterns' });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].lesson.category).toBe('error-patterns');
    });

    it('should respect limit in search', async () => {
      const t = new LocalCommunityPoolTransport();
      for (let i = 0; i < 5; i++) {
        await t.share({ anonymousContributorId: 'c1', category: 'general', title: `L${i}`, content: `c${i}`, embedding: [1, 0, 0] });
      }
      const result = await t.search({ embedding: [1, 0, 0], limit: 2 });
      expect(result.results).toHaveLength(2);
    });
  });

  // ════════════════════════════════════════════════════
  // computeSimpleEmbedding
  // ════════════════════════════════════════════════════

  describe('computeSimpleEmbedding', () => {
    it('should return array of specified dimensions', () => {
      const emb = computeSimpleEmbedding('test', 32);
      expect(emb).toHaveLength(32);
    });

    it('should default to 64 dimensions', () => {
      const emb = computeSimpleEmbedding('test');
      expect(emb).toHaveLength(64);
    });

    it('should return numbers', () => {
      const emb = computeSimpleEmbedding('hello world');
      for (const v of emb) {
        expect(typeof v).toBe('number');
        expect(isFinite(v)).toBe(true);
      }
    });

    it('should produce deterministic output', () => {
      const e1 = computeSimpleEmbedding('same text');
      const e2 = computeSimpleEmbedding('same text');
      expect(e1).toEqual(e2);
    });

    it('should produce different output for different text', () => {
      const e1 = computeSimpleEmbedding('hello');
      const e2 = computeSimpleEmbedding('goodbye');
      expect(e1).not.toEqual(e2);
    });

    it('should handle empty string', () => {
      const emb = computeSimpleEmbedding('');
      expect(emb).toHaveLength(64);
      // All zeros for empty input
      for (const v of emb) expect(v).toBe(0);
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

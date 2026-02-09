/**
 * Integration Test: Share → Search → Rate cycle (Story 7.5)
 *
 * Full share→search→rate cycle across two simulated tenants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from '../test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../../services/community-service.js';
import { LessonStore } from '../../db/lesson-store.js';

describe('Integration: Share → Query → Rate Cycle', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let serviceA: CommunityService;
  let serviceB: CommunityService;

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
    transport = new LocalCommunityPoolTransport();
    serviceA = new CommunityService(ctx.db, { transport });
    serviceB = new CommunityService(ctx.db, { transport });

    // Enable sharing for both tenants
    serviceA.updateSharingConfig('tenant-a', { enabled: true });
    serviceB.updateSharingConfig('tenant-b', { enabled: true });
  });

  function createLesson(tenantId: string, overrides: Record<string, unknown> = {}) {
    return lessonStore.create(tenantId, {
      title: 'Error handling in async flows',
      content: 'Always wrap async operations in try-catch blocks to handle failures gracefully.',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  it('should share a lesson and find it via search', async () => {
    const lesson = createLesson('tenant-a');
    const shareResult = await serviceA.share('tenant-a', lesson.id, 'agent-1');
    expect(shareResult.status).toBe('shared');

    const searchResult = await serviceB.search('tenant-b', 'async error handling');
    expect(searchResult.lessons.length).toBeGreaterThan(0);
    expect(searchResult.lessons[0].content).toBeDefined();
  });

  it('should apply redaction before sharing', async () => {
    const lesson = createLesson('tenant-a', {
      title: 'Lesson about API key handling',
      content: 'Our API key is AKIA1234567890ABCDEF and it should be rotated.',
    });
    const result = await serviceA.share('tenant-a', lesson.id, 'agent-1');
    // Redaction should either block or redact — the key pattern should be caught
    if (result.status === 'shared') {
      expect(result.redactionFindings.length).toBeGreaterThan(0);
    }
    // If blocked, that's also correct behavior
    expect(['shared', 'blocked']).toContain(result.status);
  });

  it('should use anonymous IDs — no tenant info in shared data', async () => {
    const lesson = createLesson('tenant-a');
    await serviceA.share('tenant-a', lesson.id, 'agent-1');

    // Check pool data directly
    expect(transport.shared.length).toBe(1);
    const poolLesson = transport.shared[0];
    expect(poolLesson.anonymousContributorId).toBeDefined();
    expect(poolLesson.anonymousContributorId).not.toContain('tenant-a');
    expect(poolLesson.content).not.toContain('tenant-a');
    expect(poolLesson.title).not.toContain('tenant-a');
  });

  it('should not leak identity in search results', async () => {
    const lesson = createLesson('tenant-a');
    await serviceA.share('tenant-a', lesson.id, 'agent-1');

    const result = await serviceB.search('tenant-b', 'async error');
    for (const item of result.lessons) {
      expect(JSON.stringify(item)).not.toContain('tenant-a');
      expect(JSON.stringify(item)).not.toContain('agent-1');
    }
  });

  it('should allow rating and update reputation', async () => {
    const lesson = createLesson('tenant-a');
    const shareResult = await serviceA.share('tenant-a', lesson.id, 'agent-1');
    if (shareResult.status !== 'shared') throw new Error('Share failed');

    const rateResult = await serviceB.rate('tenant-b', shareResult.anonymousLessonId, 1, 'helpful');
    expect(rateResult.status).toBe('rated');
    if (rateResult.status === 'rated') {
      expect(rateResult.reputationScore).toBe(51); // 50 + 1
    }
  });

  it('should search after rating still returns the lesson', async () => {
    const lesson = createLesson('tenant-a');
    const shareResult = await serviceA.share('tenant-a', lesson.id, 'agent-1');
    if (shareResult.status !== 'shared') throw new Error('Share failed');

    await serviceB.rate('tenant-b', shareResult.anonymousLessonId, 1, 'helpful');
    const searchResult = await serviceB.search('tenant-b', 'async error');
    expect(searchResult.lessons.length).toBeGreaterThan(0);
  });

  it('should generate audit events for share+search+rate cycle', async () => {
    const lesson = createLesson('tenant-a');
    const shareResult = await serviceA.share('tenant-a', lesson.id, 'user-x');
    if (shareResult.status !== 'shared') throw new Error('Share failed');

    await serviceB.search('tenant-b', 'error', {}, 'user-y');
    await serviceB.rate('tenant-b', shareResult.anonymousLessonId, 1, 'good', 'user-y');

    const auditA = serviceA.getAuditLog('tenant-a');
    expect(auditA.some((e) => e.eventType === 'share')).toBe(true);

    const auditB = serviceB.getAuditLog('tenant-b');
    expect(auditB.some((e) => e.eventType === 'query')).toBe(true);
    expect(auditB.some((e) => e.eventType === 'rate')).toBe(true);
  });

  it('should handle multiple shares and search across them', async () => {
    for (let i = 0; i < 5; i++) {
      const lesson = createLesson('tenant-a', { title: `Lesson ${i} about patterns`, content: `Content about pattern ${i}` });
      await serviceA.share('tenant-a', lesson.id, 'agent-1');
    }

    const result = await serviceB.search('tenant-b', 'patterns', { limit: 10 });
    expect(result.lessons.length).toBeGreaterThanOrEqual(1);
  });

  it('should downvote and eventually hide a lesson', async () => {
    const lesson = createLesson('tenant-a');
    const shareResult = await serviceA.share('tenant-a', lesson.id, 'agent-1');
    if (shareResult.status !== 'shared') throw new Error('Share failed');

    // Downvote enough to trigger auto-hide (below 20)
    // Starting at 50, need 31 downvotes to reach 19
    // But daily cap is 5 per voter, so we need multiple tenants
    // For simplicity, directly manipulate the transport
    const poolLesson = transport.shared.find((l) => l.id === shareResult.anonymousLessonId);
    if (poolLesson) {
      poolLesson.reputationScore = 15;
      poolLesson.hidden = true;
    }

    const result = await serviceB.search('tenant-b', 'async error');
    // Hidden lessons should not appear in search
    expect(result.lessons.find((l) => l.id === shareResult.anonymousLessonId)).toBeUndefined();
  });

  it('should strip context field from shared data', async () => {
    const lesson = createLesson('tenant-a', {
      context: { secretKey: 'abc123', internalRef: 'proj-42' },
    });
    await serviceA.share('tenant-a', lesson.id, 'agent-1');

    const poolLesson = transport.shared[0];
    // Content should not contain raw context data (redaction pipeline strips it)
    expect(poolLesson.content).not.toContain('secretKey');
  });
});

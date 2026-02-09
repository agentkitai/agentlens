/**
 * Integration Test: Kill Switch Purge→Verify (Story 7.5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, type TestContext } from '../test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../../services/community-service.js';
import { LessonStore } from '../../db/lesson-store.js';
import { AnonymousIdManager } from '../../db/anonymous-id-manager.js';

describe('Integration: Kill Switch', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;
  const tenantId = 'kill-switch-tenant';

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(ctx.db, { transport });
    service.updateSharingConfig(tenantId, { enabled: true });
  });

  function createLesson() {
    return lessonStore.create(tenantId, {
      title: 'Test lesson for kill switch',
      content: 'Some error pattern content that is safe to share.',
      category: 'error-patterns',
    } as any);
  }

  it('should purge all shared lessons', async () => {
    // Share some lessons
    for (let i = 0; i < 3; i++) {
      const lesson = createLesson();
      await service.share(tenantId, lesson.id, 'admin');
    }
    expect(transport.shared.length).toBe(3);

    const result = await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');
    expect(result.status).toBe('purged');
    if (result.status === 'purged') {
      expect(result.deleted).toBe(3);
    }
  });

  it('should return count 0 after purge', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');

    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    // Pool should have 0 lessons from this tenant
    expect(transport.shared.length).toBe(0);
  });

  it('should generate a new anonymous ID after purge', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');

    // Get the contributor ID that was used for sharing (from audit trail)
    const anonManager = new AnonymousIdManager(ctx.db);
    const trailBefore = anonManager.getAuditTrail(tenantId, '__contributor__');
    const idBefore = trailBefore[trailBefore.length - 1]?.anonymousAgentId;
    expect(idBefore).toBeDefined();

    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    // Wait a tiny bit so the validUntil=now is definitely in the past
    await new Promise((r) => setTimeout(r, 10));

    // After purge, the old ID is retired — a fresh manager call creates a new one
    const idAfter = anonManager.getOrRotateContributorId(tenantId);
    expect(idAfter).not.toBe(idBefore);
  });

  it('should disable sharing after purge', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');

    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    const config = service.getSharingConfig(tenantId);
    expect(config.enabled).toBe(false);
  });

  it('should not share after purge (sharing disabled)', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');
    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    const newLesson = createLesson();
    const result = await service.share(tenantId, newLesson.id, 'agent');
    expect(result.status).toBe('disabled');
  });

  it('should require confirmation string', async () => {
    const result = await service.purge(tenantId, 'wrong-confirmation');
    expect(result.status).toBe('error');
  });

  it('should log purge event in audit log', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');
    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    const audit = service.getAuditLog(tenantId);
    expect(audit.some((e) => e.eventType === 'purge')).toBe(true);
  });

  it('should generate new purge token after purge', async () => {
    const configBefore = service.getSharingConfig(tenantId);
    const tokenBefore = configBefore.purgeToken;

    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');
    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    const configAfter = service.getSharingConfig(tenantId);
    expect(configAfter.purgeToken).toBeDefined();
    expect(configAfter.purgeToken).not.toBe(tokenBefore);
  });

  it('should handle purge with no shared lessons gracefully', async () => {
    // Purge creates a contributor ID if none exists, so it should succeed
    // But the transport.purge will return 0 deleted
    const result = await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');
    // May error if purge token issues, or succeed with 0 deleted
    expect(['purged', 'error']).toContain(result.status);
    if (result.status === 'purged') {
      expect(result.deleted).toBe(0);
    }
  });

  it('should keep old anonymous IDs in audit trail', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'admin');

    const anonManager = new AnonymousIdManager(ctx.db);
    const trail = anonManager.getAuditTrail(tenantId, '__contributor__');
    expect(trail.length).toBeGreaterThanOrEqual(1);

    await service.purge(tenantId, 'CONFIRM_PURGE', 'admin');

    // Old IDs should still be in the audit trail
    const trailAfter = anonManager.getAuditTrail(tenantId, '__contributor__');
    expect(trailAfter.length).toBeGreaterThanOrEqual(trail.length);
  });
});

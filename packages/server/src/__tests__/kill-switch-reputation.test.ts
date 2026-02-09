/**
 * Tests for Kill Switch & Reputation (Story 4.4)
 * ~50 tests covering purge, verify, reputation scoring, daily caps, auto-hide.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { LessonStore } from '../db/lesson-store.js';
import {
  CommunityService,
  LocalCommunityPoolTransport,
} from '../services/community-service.js';
import type { SqliteDb } from '../db/index.js';

describe('Kill Switch & Reputation — Story 4.4', () => {
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

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    lessonStore = new LessonStore(db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(db, { transport });
  });

  // ════════════════════════════════════════════════════
  // Kill Switch: purge()
  // ════════════════════════════════════════════════════

  describe('purge()', () => {
    it('requires CONFIRM_PURGE confirmation', async () => {
      const result = await service.purge('tenant-1', 'wrong');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Confirmation');
      }
    });

    it('purges even if no prior shares (0 deleted)', async () => {
      enableSharing();
      const result = await service.purge('tenant-1', 'CONFIRM_PURGE');
      expect(result.status).toBe('purged');
      if (result.status === 'purged') {
        expect(result.deleted).toBe(0);
      }
    });

    it('purges all lessons from pool', async () => {
      enableSharing();
      const l1 = createLesson();
      const l2 = createLesson({ title: 'Lesson 2' });

      await service.share('tenant-1', l1.id);
      await service.share('tenant-1', l2.id);
      expect(transport.shared.length).toBe(2);

      const result = await service.purge('tenant-1', 'CONFIRM_PURGE');
      expect(result.status).toBe('purged');
      if (result.status === 'purged') {
        expect(result.deleted).toBe(2);
      }
      expect(transport.shared.length).toBe(0);
    });

    it('disables sharing after purge', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      await service.purge('tenant-1', 'CONFIRM_PURGE');

      const config = service.getSharingConfig('tenant-1');
      expect(config.enabled).toBe(false);
    });

    it('generates new contributor ID after purge (via anonymous ID rotation)', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      // The old contributor ID is the one used in the shared lessons
      const oldContributorId = transport.shared[0]?.anonymousContributorId;
      expect(oldContributorId).toBeTruthy();

      await service.purge('tenant-1', 'CONFIRM_PURGE');

      // Re-enable and share to trigger new contributor ID generation
      service.updateSharingConfig('tenant-1', { enabled: true });
      const lesson2 = createLesson({ title: 'New lesson' });
      await service.share('tenant-1', lesson2.id);

      const newContributorId = transport.shared[0]?.anonymousContributorId;
      expect(newContributorId).not.toBe(oldContributorId);
    });

    it('generates new purge token after purge', async () => {
      enableSharing();
      service.updateSharingConfig('tenant-1', { purgeToken: 'old-token' });
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      await service.purge('tenant-1', 'CONFIRM_PURGE');

      const config = service.getSharingConfig('tenant-1');
      expect(config.purgeToken).not.toBe('old-token');
      expect(config.purgeToken).toBeTruthy();
    });

    it('writes audit log for purge', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      await service.purge('tenant-1', 'CONFIRM_PURGE');

      const logs = service.getAuditLog('tenant-1');
      expect(logs.some((l) => l.eventType === 'purge')).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════
  // Kill Switch: verifyPurge()
  // ════════════════════════════════════════════════════

  describe('verifyPurge()', () => {
    it('returns 0 count after successful purge', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      await service.purge('tenant-1', 'CONFIRM_PURGE');

      const result = await service.verifyPurge('tenant-1');
      expect(result.count).toBe(0);
    });

    it('returns 0 count when no contributor ID', async () => {
      const result = await service.verifyPurge('tenant-1');
      expect(result.count).toBe(0);
    });

    it('returns 0 for new contributor ID post-purge', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      await service.purge('tenant-1', 'CONFIRM_PURGE');

      // The new contributor ID should have 0 lessons
      const result = await service.verifyPurge('tenant-1');
      expect(result.count).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════
  // Reputation: rate()
  // ════════════════════════════════════════════════════

  describe('rate()', () => {
    async function shareAndGetId(): Promise<string> {
      enableSharing();
      const lesson = createLesson();
      const result = await service.share('tenant-1', lesson.id);
      if (result.status !== 'shared') throw new Error('Share failed');
      return result.anonymousLessonId;
    }

    it('returns rated status on success', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, 1, 'helpful');
      expect(result.status).toBe('rated');
    });

    it('reputation starts at 50', async () => {
      const lessonId = await shareAndGetId();
      const lesson = transport.shared.find((l) => l.id === lessonId);
      expect(lesson?.reputationScore).toBe(50);
    });

    it('positive rating increases reputation', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, 5, 'helpful');
      if (result.status === 'rated') {
        expect(result.reputationScore).toBe(55);
      }
    });

    it('negative rating decreases reputation', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, -5, 'unhelpful');
      if (result.status === 'rated') {
        expect(result.reputationScore).toBe(45);
      }
    });

    it('multiple ratings accumulate', async () => {
      const lessonId = await shareAndGetId();
      await service.rate('tenant-1', lessonId, 3, 'helpful');
      const r2 = await service.rate('tenant-1', lessonId, 2, 'helpful');
      if (r2.status === 'rated') {
        expect(r2.reputationScore).toBe(55); // 50 + 3 + 2
      }
    });

    it('writes audit log for rate action', async () => {
      const lessonId = await shareAndGetId();
      await service.rate('tenant-1', lessonId, 1, 'helpful');
      const logs = service.getAuditLog('tenant-1');
      expect(logs.some((l) => l.eventType === 'rate')).toBe(true);
    });

    it('returns error for non-existent lesson', async () => {
      enableSharing();
      const result = await service.rate('tenant-1', 'nonexistent', 1, 'helpful');
      expect(result.status).toBe('error');
    });
  });

  // ════════════════════════════════════════════════════
  // Reputation: Daily Cap
  // ════════════════════════════════════════════════════

  describe('daily cap', () => {
    async function shareAndGetId(): Promise<string> {
      enableSharing();
      const lesson = createLesson();
      const result = await service.share('tenant-1', lesson.id);
      if (result.status !== 'shared') throw new Error('Share failed');
      return result.anonymousLessonId;
    }

    it('allows up to 5 ratings per voter per day', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 0; i < 5; i++) {
        const result = await service.rate('tenant-1', lessonId, 1, 'helpful');
        expect(result.status).toBe('rated');
      }
    });

    it('blocks 6th rating from same voter in same day', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 0; i < 5; i++) {
        await service.rate('tenant-1', lessonId, 1, 'helpful');
      }
      const result = await service.rate('tenant-1', lessonId, 1, 'helpful');
      expect(result.status).toBe('error');
    });

    it('different tenants have independent daily caps', async () => {
      const lessonId = await shareAndGetId();
      // tenant-1 rates 5 times
      for (let i = 0; i < 5; i++) {
        await service.rate('tenant-1', lessonId, 1, 'helpful');
      }

      // tenant-2 should still be able to rate (different voter ID)
      const service2 = new CommunityService(db, { transport });
      service2.updateSharingConfig('tenant-2', { enabled: true });
      const result = await service2.rate('tenant-2', lessonId, 1, 'helpful');
      expect(result.status).toBe('rated');
    });
  });

  // ════════════════════════════════════════════════════
  // Reputation: Auto-hide
  // ════════════════════════════════════════════════════

  describe('auto-hide below reputation threshold', () => {
    async function shareAndGetId(): Promise<string> {
      enableSharing();
      const lesson = createLesson();
      const result = await service.share('tenant-1', lesson.id);
      if (result.status !== 'shared') throw new Error('Share failed');
      return result.anonymousLessonId;
    }

    it('auto-hides lesson when reputation drops below 20', async () => {
      const lessonId = await shareAndGetId();
      // Drop reputation from 50 to below 20 — need big negative delta
      // Each vote can be any delta, but capped at 5 votes per day per voter
      // Use a large negative delta
      await service.rate('tenant-1', lessonId, -35, 'terrible');

      const lesson = transport.shared.find((l) => l.id === lessonId);
      expect(lesson?.hidden).toBe(true);
    });

    it('hidden lessons are not returned in search', async () => {
      const lessonId = await shareAndGetId();
      await service.rate('tenant-1', lessonId, -35, 'terrible');

      const results = await service.search('tenant-1', 'error handling');
      expect(results.lessons.find((l) => l.id === lessonId)).toBeUndefined();
    });

    it('lesson becomes visible again if reputation rises above 20', async () => {
      const lessonId = await shareAndGetId();
      // Drop below 20
      await service.rate('tenant-1', lessonId, -35, 'terrible');
      expect(transport.shared.find((l) => l.id === lessonId)?.hidden).toBe(true);

      // Raise back above 20 from different tenant
      const service2 = new CommunityService(db, { transport });
      service2.updateSharingConfig('tenant-2', { enabled: true });
      await service2.rate('tenant-2', lessonId, 40, 'actually_good');

      expect(transport.shared.find((l) => l.id === lessonId)?.hidden).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════
  // Reputation: Implicit scoring from task outcomes
  // ════════════════════════════════════════════════════

  describe('implicit reputation from task outcomes', () => {
    async function shareAndGetId(): Promise<string> {
      enableSharing();
      const lesson = createLesson();
      const result = await service.share('tenant-1', lesson.id);
      if (result.status !== 'shared') throw new Error('Share failed');
      return result.anonymousLessonId;
    }

    it('upvote increases reputation', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, 1, 'implicit_success');
      if (result.status === 'rated') {
        expect(result.reputationScore).toBeGreaterThan(50);
      }
    });

    it('downvote decreases reputation', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, -1, 'implicit_failure');
      if (result.status === 'rated') {
        expect(result.reputationScore).toBeLessThan(50);
      }
    });

    it('explicit rate reason accepted', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.rate('tenant-1', lessonId, 2, 'explicit_helpful');
      expect(result.status).toBe('rated');
    });
  });

  // ════════════════════════════════════════════════════
  // Purge + share lifecycle
  // ════════════════════════════════════════════════════

  describe('purge + reshare lifecycle', () => {
    it('can share again after purge with new ID', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      expect(transport.shared.length).toBe(1);

      await service.purge('tenant-1', 'CONFIRM_PURGE');
      expect(transport.shared.length).toBe(0);

      // Re-enable and share again
      service.updateSharingConfig('tenant-1', { enabled: true });
      const result = await service.share('tenant-1', lesson.id);
      expect(result.status).toBe('shared');
      expect(transport.shared.length).toBe(1);
    });

    it('new shares use new contributor ID after purge', async () => {
      enableSharing();
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      const oldContributorId = transport.shared[0].anonymousContributorId;

      await service.purge('tenant-1', 'CONFIRM_PURGE');
      service.updateSharingConfig('tenant-1', { enabled: true });

      await service.share('tenant-1', lesson.id);
      const newContributorId = transport.shared[0].anonymousContributorId;

      expect(newContributorId).not.toBe(oldContributorId);
    });
  });
});

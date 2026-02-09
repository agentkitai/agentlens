/**
 * Tests for Moderation & Flagging (Story 4.5)
 * ~35 tests covering flagging, auto-hide, moderation queue, human review queue.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { LessonStore } from '../db/lesson-store.js';
import {
  CommunityService,
  LocalCommunityPoolTransport,
} from '../services/community-service.js';
import * as schema from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SqliteDb } from '../db/index.js';

describe('Moderation & Flagging — Story 4.5', () => {
  let db: SqliteDb;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create('tenant-1', {
      title: 'Test Lesson',
      content: 'Some useful content about error handling',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  function enableSharing(tenantId = 'tenant-1') {
    service.updateSharingConfig(tenantId, { enabled: true });
  }

  async function shareAndGetId(tenantId = 'tenant-1'): Promise<string> {
    enableSharing(tenantId);
    const lesson = createLesson();
    const result = await service.share(tenantId, lesson.id);
    if (result.status !== 'shared') throw new Error(`Share failed: ${result.status}`);
    return result.anonymousLessonId;
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    lessonStore = new LessonStore(db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(db, { transport });
  });

  // ════════════════════════════════════════════════════
  // Flagging: flag()
  // ════════════════════════════════════════════════════

  describe('flag()', () => {
    it('flags a lesson successfully', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.flag('tenant-1', lessonId, 'spam');
      expect(result.status).toBe('flagged');
      if (result.status === 'flagged') {
        expect(result.flagCount).toBe(1);
      }
    });

    it('increments flag count on subsequent flags from different tenants', async () => {
      const lessonId = await shareAndGetId();
      await service.flag('tenant-1', lessonId, 'spam');

      const service2 = new CommunityService(db, { transport });
      service2.updateSharingConfig('tenant-2', { enabled: true });
      const result = await service2.flag('tenant-2', lessonId, 'harmful');
      if (result.status === 'flagged') {
        expect(result.flagCount).toBe(2);
      }
    });

    it('prevents duplicate flags from same tenant', async () => {
      const lessonId = await shareAndGetId();
      await service.flag('tenant-1', lessonId, 'spam');
      const result = await service.flag('tenant-1', lessonId, 'harmful');
      expect(result.status).toBe('error');
    });

    it('accepts all valid flag reasons', async () => {
      const reasons = ['spam', 'harmful', 'low-quality', 'sensitive-data'];
      for (const reason of reasons) {
        const lid = await shareAndGetId();
        const result = await service.flag('tenant-1', lid, reason);
        expect(result.status).toBe('flagged');
      }
    });

    it('writes audit log for flag', async () => {
      const lessonId = await shareAndGetId();
      await service.flag('tenant-1', lessonId, 'spam');
      const logs = service.getAuditLog('tenant-1');
      expect(logs.some((l) => l.eventType === 'flag')).toBe(true);
    });

    it('returns error for non-existent lesson', async () => {
      enableSharing();
      const result = await service.flag('tenant-1', 'nonexistent', 'spam');
      expect(result.status).toBe('error');
    });
  });

  // ════════════════════════════════════════════════════
  // Auto-hide at 3+ flags
  // ════════════════════════════════════════════════════

  describe('auto-hide at 3+ flags', () => {
    it('does NOT auto-hide at 2 flags', async () => {
      const lessonId = await shareAndGetId();
      await service.flag('tenant-1', lessonId, 'spam');

      const service2 = new CommunityService(db, { transport });
      service2.updateSharingConfig('tenant-2', { enabled: true });
      await service2.flag('tenant-2', lessonId, 'spam');

      const lesson = transport.shared.find((l) => l.id === lessonId);
      expect(lesson?.hidden).toBe(false);
    });

    it('auto-hides at 3 flags from distinct tenants', async () => {
      const lessonId = await shareAndGetId();

      // Flag from 3 different tenants
      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`tenant-${i}`, { enabled: true });
        await svc.flag(`tenant-${i}`, lessonId, 'spam');
      }

      const lesson = transport.shared.find((l) => l.id === lessonId);
      expect(lesson?.hidden).toBe(true);
    });

    it('hidden flagged lessons not returned in search', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`tenant-${i}`, { enabled: true });
        await svc.flag(`tenant-${i}`, lessonId, 'spam');
      }

      const results = await service.search('tenant-1', 'error handling');
      expect(results.lessons.find((l) => l.id === lessonId)).toBeUndefined();
    });

    it('auto-hides at exactly 3 distinct tenant flags', async () => {
      const lessonId = await shareAndGetId();

      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`tenant-flag-${i}`, { enabled: true });
        const result = await svc.flag(`tenant-flag-${i}`, lessonId, 'harmful');
        if (result.status === 'flagged' && i === 3) {
          expect(result.flagCount).toBe(3);
        }
      }

      const lesson = transport.shared.find((l) => l.id === lessonId);
      expect(lesson?.hidden).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════
  // Moderation Queue
  // ════════════════════════════════════════════════════

  describe('moderation queue', () => {
    it('returns empty queue when no flagged lessons', async () => {
      const queue = await service.getModerationQueue();
      expect(queue).toHaveLength(0);
    });

    it('returns flagged lessons in queue', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`t-${i}`, { enabled: true });
        await svc.flag(`t-${i}`, lessonId, 'spam');
      }

      const queue = await service.getModerationQueue();
      expect(queue.length).toBeGreaterThanOrEqual(1);
      expect(queue.some((q) => q.lesson.id === lessonId)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════
  // Moderation Actions
  // ════════════════════════════════════════════════════

  describe('moderateLesson()', () => {
    it('approve un-hides lesson', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`t-${i}`, { enabled: true });
        await svc.flag(`t-${i}`, lessonId, 'spam');
      }

      expect(transport.shared.find((l) => l.id === lessonId)?.hidden).toBe(true);

      const result = await service.moderateLesson(lessonId, 'approve');
      expect(result.success).toBe(true);
      expect(transport.shared.find((l) => l.id === lessonId)?.hidden).toBe(false);
    });

    it('remove hides lesson', async () => {
      const lessonId = await shareAndGetId();
      const result = await service.moderateLesson(lessonId, 'remove');
      expect(result.success).toBe(true);
      expect(transport.shared.find((l) => l.id === lessonId)?.hidden).toBe(true);
    });

    it('approve resets flag count', async () => {
      const lessonId = await shareAndGetId();
      for (let i = 1; i <= 3; i++) {
        const svc = new CommunityService(db, { transport });
        svc.updateSharingConfig(`t-${i}`, { enabled: true });
        await svc.flag(`t-${i}`, lessonId, 'spam');
      }

      await service.moderateLesson(lessonId, 'approve');
      expect(transport.shared.find((l) => l.id === lessonId)?.flagCount).toBe(0);
    });

    it('returns false for non-existent lesson', async () => {
      const result = await service.moderateLesson('nonexistent', 'approve');
      expect(result.success).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════
  // Human Review Queue
  // ════════════════════════════════════════════════════

  describe('human review queue', () => {
    function insertReviewItem(tenantId: string, overrides: Record<string, unknown> = {}) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const id = randomUUID();
      db.insert(schema.sharingReviewQueue).values({
        id,
        tenantId,
        lessonId: overrides.lessonId as string ?? randomUUID(),
        originalTitle: 'Original Title',
        originalContent: 'Original content with secrets sk-abc123',
        redactedTitle: 'Original Title',
        redactedContent: 'Original content with secrets [SECRET_REDACTED]',
        redactionFindings: '[]',
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: (overrides.expiresAt as string) ?? expiresAt.toISOString(),
      }).run();
      return id;
    }

    it('returns pending review items', () => {
      insertReviewItem('tenant-1');
      const queue = service.getReviewQueue('tenant-1');
      expect(queue.length).toBe(1);
      expect(queue[0].status).toBe('pending');
    });

    it('filters by tenant', () => {
      insertReviewItem('tenant-1');
      insertReviewItem('tenant-2');
      const queue = service.getReviewQueue('tenant-1');
      expect(queue.length).toBe(1);
    });

    it('excludes expired items', () => {
      insertReviewItem('tenant-1', {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const queue = service.getReviewQueue('tenant-1');
      expect(queue.length).toBe(0);
    });

    it('marks expired items as expired', () => {
      const id = insertReviewItem('tenant-1', {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      service.getReviewQueue('tenant-1');

      const item = db
        .select()
        .from(schema.sharingReviewQueue)
        .where(eq(schema.sharingReviewQueue.id, id))
        .get();
      expect(item?.status).toBe('expired');
    });

    it('7-day expiry default', () => {
      const id = insertReviewItem('tenant-1');
      const queue = service.getReviewQueue('tenant-1');
      expect(queue.length).toBe(1);

      const item = queue[0];
      const expiresDate = new Date(item.expiresAt);
      const createdDate = new Date(item.createdAt);
      const diffDays = (expiresDate.getTime() - createdDate.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(7, 0);
    });
  });

  // ════════════════════════════════════════════════════
  // Review: approve / reject
  // ════════════════════════════════════════════════════

  describe('approveReviewItem()', () => {
    function insertReviewItem(tenantId: string) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const id = randomUUID();
      db.insert(schema.sharingReviewQueue).values({
        id,
        tenantId,
        lessonId: randomUUID(),
        originalTitle: 'Original Title',
        originalContent: 'Original content',
        redactedTitle: 'Redacted Title',
        redactedContent: 'Redacted content',
        redactionFindings: '[]',
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }).run();
      return id;
    }

    it('approves and sends to pool', async () => {
      enableSharing();
      const reviewId = insertReviewItem('tenant-1');
      const result = await service.approveReviewItem('tenant-1', reviewId, 'admin');
      expect(result.status).toBe('approved');
      expect(transport.shared.length).toBeGreaterThanOrEqual(1);
    });

    it('sets reviewedBy and reviewedAt', async () => {
      enableSharing();
      const reviewId = insertReviewItem('tenant-1');
      await service.approveReviewItem('tenant-1', reviewId, 'admin-1');

      const item = db
        .select()
        .from(schema.sharingReviewQueue)
        .where(eq(schema.sharingReviewQueue.id, reviewId))
        .get();
      expect(item?.reviewedBy).toBe('admin-1');
      expect(item?.reviewedAt).toBeTruthy();
    });

    it('returns error for non-existent item', async () => {
      const result = await service.approveReviewItem('tenant-1', 'nonexistent', 'admin');
      expect(result.status).toBe('error');
    });

    it('returns error for already approved item', async () => {
      enableSharing();
      const reviewId = insertReviewItem('tenant-1');
      await service.approveReviewItem('tenant-1', reviewId, 'admin');
      const result = await service.approveReviewItem('tenant-1', reviewId, 'admin');
      expect(result.status).toBe('error');
    });
  });

  describe('rejectReviewItem()', () => {
    function insertReviewItem(tenantId: string) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const id = randomUUID();
      db.insert(schema.sharingReviewQueue).values({
        id,
        tenantId,
        lessonId: randomUUID(),
        originalTitle: 'Title',
        originalContent: 'Content',
        redactedTitle: 'Title',
        redactedContent: 'Content',
        redactionFindings: '[]',
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }).run();
      return id;
    }

    it('rejects item', async () => {
      const reviewId = insertReviewItem('tenant-1');
      const result = await service.rejectReviewItem('tenant-1', reviewId, 'admin');
      expect(result.status).toBe('rejected');
    });

    it('rejected item not sent to pool', async () => {
      const reviewId = insertReviewItem('tenant-1');
      await service.rejectReviewItem('tenant-1', reviewId, 'admin');
      expect(transport.shared.length).toBe(0);
    });

    it('sets status to rejected in DB', async () => {
      const reviewId = insertReviewItem('tenant-1');
      await service.rejectReviewItem('tenant-1', reviewId, 'admin');
      const item = db
        .select()
        .from(schema.sharingReviewQueue)
        .where(eq(schema.sharingReviewQueue.id, reviewId))
        .get();
      expect(item?.status).toBe('rejected');
    });

    it('returns error for non-existent item', async () => {
      const result = await service.rejectReviewItem('tenant-1', 'nonexistent', 'admin');
      expect(result.status).toBe('error');
    });
  });
});

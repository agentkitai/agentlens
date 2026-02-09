/**
 * Tests for Phase 4 Security Fixes (C1, C2, H1–H5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { LessonStore } from '../db/lesson-store.js';
import {
  CommunityService,
  LocalCommunityPoolTransport,
} from '../services/community-service.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import { anonymousIdMap } from '../db/schema.sqlite.js';
import { createRedactedLessonContent, REDACTION_PIPELINE_KEY } from '@agentlensai/core';
import type { SqliteDb } from '../db/index.js';

describe('Phase 4 Security Fixes', () => {
  let db: SqliteDb;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create('tenant-1', {
      title: 'Test Lesson',
      content: 'Some useful content about error handling patterns',
      category: 'error-patterns',
      context: { secretApiUrl: 'https://internal.example.com/api', userId: 'user-42' },
      ...overrides,
    } as any);
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    lessonStore = new LessonStore(db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(db, { transport });
    service.updateSharingConfig('tenant-1', { enabled: true });
  });

  // ═══════════════════════════════════════════════════
  // C1: Data leakage via qualitySignals
  // ═══════════════════════════════════════════════════

  describe('C1: qualitySignals not sent to pool', () => {
    it('should NOT include qualitySignals in pool share payload', async () => {
      const lesson = createLesson({
        context: { secret: 'top-secret-value', internalUrl: 'https://internal.corp.com' },
      });
      await service.share('tenant-1', lesson.id);

      expect(transport.shared.length).toBe(1);
      const shared = transport.shared[0];
      // qualitySignals should be undefined (not sent)
      expect(shared.qualitySignals).toBeUndefined();
    });

    it('should include redaction metadata instead of qualitySignals', async () => {
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      const shared = transport.shared[0];
      expect(shared.redactionApplied).toBe(true);
      expect(typeof shared.redactionFindingsCount).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════
  // C2: Purge token registration
  // ═══════════════════════════════════════════════════

  describe('C2: purge token registration', () => {
    it('should register purge token with pool on first share', async () => {
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      // Check that the purge token was stored in config
      const config = service.getSharingConfig('tenant-1');
      expect(config.purgeToken).toBeTruthy();
    });

    it('should allow purge after sharing (token registered)', async () => {
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);
      expect(transport.shared.length).toBe(1);

      const result = await service.purge('tenant-1', 'CONFIRM_PURGE');
      expect(result.status).toBe('purged');
      if (result.status === 'purged') {
        expect(result.deleted).toBe(1);
      }
    });

    it('should fail purge with invalid token', async () => {
      const lesson = createLesson();
      await service.share('tenant-1', lesson.id);

      // Tamper with the stored purge token
      service.updateSharingConfig('tenant-1', { purgeToken: 'tampered-token' });

      const result = await service.purge('tenant-1', 'CONFIRM_PURGE');
      expect(result.status).toBe('error');
    });
  });

  // ═══════════════════════════════════════════════════
  // H1: createRedactedLessonContent guarded
  // ═══════════════════════════════════════════════════

  describe('H1: createRedactedLessonContent requires pipeline key', () => {
    it('should throw when called without key', () => {
      expect(() => createRedactedLessonContent('t', 'c')).toThrow();
    });

    it('should throw when called with wrong key', () => {
      expect(() => createRedactedLessonContent('t', 'c', {}, Symbol('wrong'))).toThrow();
    });

    it('should succeed with correct pipeline key', () => {
      const result = createRedactedLessonContent('t', 'c', {}, REDACTION_PIPELINE_KEY);
      expect(result.__brand).toBe('RedactedLessonContent');
    });
  });

  // ═══════════════════════════════════════════════════
  // H4: Anonymous ID hashing
  // ═══════════════════════════════════════════════════

  describe('H4: anonymous ID stored with hashed agentId', () => {
    it('should not store raw agentId in DB', () => {
      const manager = new AnonymousIdManager(db);
      manager.getOrRotateAnonymousId('tenant-1', 'my-agent-id');

      // Query DB directly — agentId column should NOT contain 'my-agent-id'
      const rows = db.select().from(anonymousIdMap).all();
      const agentIds = rows.map((r: any) => r.agentId);
      expect(agentIds).not.toContain('my-agent-id');
      // Should contain a hex hash instead
      expect(agentIds[0]).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return consistent anonymousId for same tenant+agent', () => {
      const manager = new AnonymousIdManager(db);
      const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-a');
      const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-a');
      expect(id1).toBe(id2);
    });

    it('should return different anonymousIds for different agents', () => {
      const manager = new AnonymousIdManager(db);
      const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-a');
      const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-b');
      expect(id1).not.toBe(id2);
    });
  });
});

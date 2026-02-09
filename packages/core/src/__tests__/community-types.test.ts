/**
 * Tests for Community Types (Phase 4 — Story 1.2)
 */

import { describe, it, expect } from 'vitest';
import {
  LESSON_SHARING_CATEGORIES,
  FLAG_REASONS,
  MODERATION_ACTIONS,
  SHARING_AUDIT_EVENT_TYPES,
} from '../community-types.js';
import type {
  LessonSharingCategory,
  SharingConfig,
  AgentSharingConfig,
  SharedLesson,
  CommunitySearchResult,
  FlagReason,
  ModerationAction,
  SharingAuditEvent,
} from '../community-types.js';

describe('Community Types (Story 1.2)', () => {
  // ─── LessonSharingCategory ──────────────────────────────

  it('should have 6 sharing categories', () => {
    expect(LESSON_SHARING_CATEGORIES).toHaveLength(6);
  });

  it('should include all expected categories', () => {
    const expected = [
      'model-performance', 'error-patterns', 'tool-usage',
      'cost-optimization', 'prompt-engineering', 'general',
    ];
    for (const cat of expected) {
      expect(LESSON_SHARING_CATEGORIES).toContain(cat);
    }
  });

  // ─── SharingConfig ──────────────────────────────────────

  it('should create a valid SharingConfig', () => {
    const config: SharingConfig = {
      tenantId: 't1',
      enabled: false,
      humanReviewEnabled: false,
      poolEndpoint: null,
      anonymousContributorId: null,
      purgeToken: null,
      rateLimitPerHour: 50,
      volumeAlertThreshold: 100,
      updatedAt: new Date().toISOString(),
    };
    expect(config.enabled).toBe(false);
    expect(config.rateLimitPerHour).toBe(50);
  });

  // ─── AgentSharingConfig ─────────────────────────────────

  it('should create a valid AgentSharingConfig', () => {
    const config: AgentSharingConfig = {
      tenantId: 't1',
      agentId: 'a1',
      enabled: true,
      categories: ['general', 'error-patterns'],
      updatedAt: new Date().toISOString(),
    };
    expect(config.categories).toHaveLength(2);
  });

  // ─── SharedLesson ───────────────────────────────────────

  it('should create a valid SharedLesson', () => {
    const lesson: SharedLesson = {
      id: 'sl-1',
      category: 'general',
      title: 'Test',
      content: 'Content',
      reputationScore: 50,
      qualitySignals: { successRate: 0.9 },
    };
    expect(lesson.reputationScore).toBe(50);
  });

  it('should allow empty qualitySignals', () => {
    const lesson: SharedLesson = {
      id: 'sl-2',
      category: 'tool-usage',
      title: 'Test',
      content: 'Content',
      reputationScore: 50,
      qualitySignals: {},
    };
    expect(lesson.qualitySignals).toEqual({});
  });

  // ─── CommunitySearchResult ──────────────────────────────

  it('should create a valid CommunitySearchResult', () => {
    const result: CommunitySearchResult = {
      lessons: [],
      total: 0,
      query: 'test query',
    };
    expect(result.total).toBe(0);
  });

  // ─── FlagReason ─────────────────────────────────────────

  it('should have 4 flag reasons', () => {
    expect(FLAG_REASONS).toHaveLength(4);
    expect(FLAG_REASONS).toContain('spam');
    expect(FLAG_REASONS).toContain('harmful');
    expect(FLAG_REASONS).toContain('low-quality');
    expect(FLAG_REASONS).toContain('sensitive-data');
  });

  // ─── ModerationAction ──────────────────────────────────

  it('should have 3 moderation actions', () => {
    expect(MODERATION_ACTIONS).toHaveLength(3);
    expect(MODERATION_ACTIONS).toContain('approve');
    expect(MODERATION_ACTIONS).toContain('remove');
    expect(MODERATION_ACTIONS).toContain('ban-source');
  });

  // ─── SharingAuditEvent ─────────────────────────────────

  it('should have 5 audit event types', () => {
    expect(SHARING_AUDIT_EVENT_TYPES).toHaveLength(5);
  });

  it('should create a valid SharingAuditEvent', () => {
    const event: SharingAuditEvent = {
      id: 'evt-1',
      tenantId: 't1',
      eventType: 'share',
      lessonId: 'l1',
      initiatedBy: 'agent:a1',
      timestamp: new Date().toISOString(),
    };
    expect(event.eventType).toBe('share');
  });

  it('should allow optional fields in SharingAuditEvent', () => {
    const event: SharingAuditEvent = {
      id: 'evt-2',
      tenantId: 't1',
      eventType: 'query',
      queryText: 'how to optimize',
      resultIds: ['r1', 'r2'],
      initiatedBy: 'agent:a1',
      timestamp: new Date().toISOString(),
    };
    expect(event.queryText).toBe('how to optimize');
    expect(event.resultIds).toHaveLength(2);
  });

  // ─── Exports from barrel ────────────────────────────────

  it('should export community types from core barrel', async () => {
    const core = await import('../index.js');
    expect(core.LESSON_SHARING_CATEGORIES).toBeDefined();
    expect(core.FLAG_REASONS).toBeDefined();
    expect(core.MODERATION_ACTIONS).toBeDefined();
    expect(core.SHARING_AUDIT_EVENT_TYPES).toBeDefined();
  });
});

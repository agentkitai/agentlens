/**
 * Community Sharing Types (Phase 4 — Story 1.2)
 */

import type { RedactionFinding } from './redaction-types.js';

// ─── Lesson Sharing Categories ─────────────────────────────

export const LESSON_SHARING_CATEGORIES = [
  'model-performance',
  'error-patterns',
  'tool-usage',
  'cost-optimization',
  'prompt-engineering',
  'general',
] as const;

export type LessonSharingCategory = typeof LESSON_SHARING_CATEGORIES[number];

// ─── Sharing Configuration ─────────────────────────────────

/** Tenant-level sharing configuration */
export interface SharingConfig {
  tenantId: string;
  enabled: boolean;
  humanReviewEnabled: boolean;
  poolEndpoint: string | null;
  anonymousContributorId: string | null;
  purgeToken: string | null;
  rateLimitPerHour: number;
  volumeAlertThreshold: number;
  updatedAt: string;
}

/** Per-agent sharing configuration */
export interface AgentSharingConfig {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  categories: LessonSharingCategory[];
  updatedAt: string;
}

// ─── Shared Lesson ─────────────────────────────────────────

/** Shared lesson as stored in the pool (anonymized) */
export interface SharedLesson {
  id: string;
  category: LessonSharingCategory;
  title: string;
  content: string;
  reputationScore: number;
  qualitySignals: {
    successRate?: number;
    usageCount?: number;
  };
}

/** Search result returned to querying agents */
export interface CommunitySearchResult {
  lessons: SharedLesson[];
  total: number;
  query: string;
}

// ─── Moderation ────────────────────────────────────────────

/** Moderation flag reasons */
export type FlagReason = 'spam' | 'harmful' | 'low-quality' | 'sensitive-data';

export const FLAG_REASONS: readonly FlagReason[] = [
  'spam',
  'harmful',
  'low-quality',
  'sensitive-data',
] as const;

/** Moderation action */
export type ModerationAction = 'approve' | 'remove' | 'ban-source';

export const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'approve',
  'remove',
  'ban-source',
] as const;

// ─── Sharing Audit ─────────────────────────────────────────

/** Sharing audit event types */
export type SharingAuditEventType = 'share' | 'query' | 'purge' | 'rate' | 'flag';

export const SHARING_AUDIT_EVENT_TYPES: readonly SharingAuditEventType[] = [
  'share',
  'query',
  'purge',
  'rate',
  'flag',
] as const;

/** Sharing audit event */
export interface SharingAuditEvent {
  id: string;
  tenantId: string;
  eventType: SharingAuditEventType;
  lessonId?: string;
  anonymousLessonId?: string;
  lessonHash?: string;
  redactionFindings?: RedactionFinding[];
  queryText?: string;
  resultIds?: string[];
  poolEndpoint?: string;
  initiatedBy: string;
  timestamp: string;
}

/**
 * Community Sharing Types (Phase 4 — Story 1.2)
 *
 * Types for community lesson sharing, moderation, and audit trails.
 * Lessons are anonymized and redacted before sharing to the community pool.
 *
 * @see {@link SharingConfig} for tenant-level sharing configuration
 * @see {@link SharedLesson} for the anonymized lesson format
 */

import type { RedactionFinding } from './redaction-types.js';

// ─── Lesson Sharing Categories ─────────────────────────────

/**
 * All supported lesson sharing categories.
 */
export const LESSON_SHARING_CATEGORIES = [
  'model-performance',
  'error-patterns',
  'tool-usage',
  'cost-optimization',
  'prompt-engineering',
  'general',
] as const;

/**
 * Category classifying a shared lesson's topic area.
 */
export type LessonSharingCategory = typeof LESSON_SHARING_CATEGORIES[number];

// ─── Sharing Configuration ─────────────────────────────────

/**
 * Tenant-level sharing configuration controlling how and whether
 * lessons are shared to the community pool.
 *
 * @see {@link AgentSharingConfig} for per-agent overrides
 */
export interface SharingConfig {
  /** Tenant this configuration belongs to */
  tenantId: string;
  /** Whether community sharing is enabled for this tenant */
  enabled: boolean;
  /** Whether lessons require human review before sharing */
  humanReviewEnabled: boolean;
  /** URL of the community pool endpoint, or `null` if not configured */
  poolEndpoint: string | null;
  /** Anonymized contributor ID used in the pool, or `null` if not yet assigned */
  anonymousContributorId: string | null;
  /** Token used to purge all contributions from the pool, or `null` */
  purgeToken: string | null;
  /** Maximum number of lessons that can be shared per hour */
  rateLimitPerHour: number;
  /** Alert threshold for unusual sharing volume */
  volumeAlertThreshold: number;
  /** ISO 8601 timestamp of last configuration update */
  updatedAt: string;
}

/**
 * Per-agent sharing configuration that overrides tenant defaults.
 *
 * @see {@link SharingConfig} for tenant-level settings
 */
export interface AgentSharingConfig {
  /** Tenant this agent belongs to */
  tenantId: string;
  /** Agent this configuration applies to */
  agentId: string;
  /** Whether sharing is enabled for this specific agent */
  enabled: boolean;
  /** Lesson categories this agent is allowed to share */
  categories: LessonSharingCategory[];
  /** ISO 8601 timestamp of last configuration update */
  updatedAt: string;
}

// ─── Shared Lesson ─────────────────────────────────────────

/**
 * A lesson as stored in the community pool after anonymization and redaction.
 *
 * @see {@link CommunitySearchResult} for search results containing lessons
 */
export interface SharedLesson {
  /** Unique identifier for this lesson in the pool */
  id: string;
  /** Topic category of the lesson */
  category: LessonSharingCategory;
  /** Short title summarizing the lesson */
  title: string;
  /** Full lesson content (redacted) */
  content: string;
  /** Reputation score of the contributing agent (0–100) */
  reputationScore: number;
  /** Quality signals derived from usage and feedback */
  qualitySignals: {
    /** Fraction of successful applications of this lesson (0–1) */
    successRate?: number;
    /** Number of times this lesson has been used by other agents */
    usageCount?: number;
  };
}

/**
 * Search result returned when querying the community pool.
 */
export interface CommunitySearchResult {
  /** Matching lessons */
  lessons: SharedLesson[];
  /** Total number of matching lessons (may exceed returned count) */
  total: number;
  /** The original search query */
  query: string;
}

// ─── Moderation ────────────────────────────────────────────

/**
 * Reasons a lesson can be flagged for moderation.
 */
export type FlagReason = 'spam' | 'harmful' | 'low-quality' | 'sensitive-data';

/**
 * Array of all flag reasons for iteration/validation.
 */
export const FLAG_REASONS: readonly FlagReason[] = [
  'spam',
  'harmful',
  'low-quality',
  'sensitive-data',
] as const;

/**
 * Actions a moderator can take on a flagged lesson.
 */
export type ModerationAction = 'approve' | 'remove' | 'ban-source';

/**
 * Array of all moderation actions for iteration/validation.
 */
export const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'approve',
  'remove',
  'ban-source',
] as const;

// ─── Sharing Audit ─────────────────────────────────────────

/**
 * Types of events recorded in the sharing audit trail.
 */
export type SharingAuditEventType = 'share' | 'query' | 'purge' | 'rate' | 'flag';

/**
 * Array of all sharing audit event types for iteration/validation.
 */
export const SHARING_AUDIT_EVENT_TYPES: readonly SharingAuditEventType[] = [
  'share',
  'query',
  'purge',
  'rate',
  'flag',
] as const;

/**
 * Audit trail entry for a sharing-related event.
 * Captures both outgoing shares and incoming queries for compliance.
 *
 * @see {@link SharingAuditEventType} for the event type enum
 */
export interface SharingAuditEvent {
  /** Unique identifier for this audit event */
  id: string;
  /** Tenant that triggered this event */
  tenantId: string;
  /** Type of sharing event */
  eventType: SharingAuditEventType;
  /** Internal lesson ID (for `'share'` and `'flag'` events) */
  lessonId?: string;
  /** Anonymized lesson ID as stored in the pool */
  anonymousLessonId?: string;
  /** Content hash of the lesson for deduplication */
  lessonHash?: string;
  /** PII/secret findings from the redaction pipeline */
  redactionFindings?: RedactionFinding[];
  /** Search query text (for `'query'` events) */
  queryText?: string;
  /** IDs of lessons returned in search results */
  resultIds?: string[];
  /** Community pool endpoint URL used */
  poolEndpoint?: string;
  /** Identifier of the user or system that initiated the event */
  initiatedBy: string;
  /** ISO 8601 timestamp of when the event occurred */
  timestamp: string;
}

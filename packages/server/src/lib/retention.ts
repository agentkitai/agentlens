/**
 * Retention Policy Engine (Story 3.6)
 *
 * Manages automatic cleanup of old events based on configurable retention policy.
 * Default: 90 days. RETENTION_DAYS=0 means keep forever.
 *
 * This is the ONE exception to the "no DELETE on events" rule —
 * retention cleanup is the audited, authorized path for event deletion.
 */

import type { IEventStore } from '@agentlens/core';

export interface RetentionPolicy {
  /** Keep events for this many days (0 = keep forever) */
  retentionDays: number;
}

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Get the configured retention policy from environment.
 */
export function getRetentionPolicy(): RetentionPolicy {
  const envDays = process.env['RETENTION_DAYS'];
  const retentionDays = envDays !== undefined
    ? parseInt(envDays, 10)
    : DEFAULT_RETENTION_DAYS;

  return {
    retentionDays: isNaN(retentionDays) ? DEFAULT_RETENTION_DAYS : retentionDays,
  };
}

/**
 * Apply the retention policy: delete events older than the configured number of days.
 *
 * - If retentionDays is 0, no events are deleted (keep forever).
 * - Also cleans up sessions with no remaining events (handled by IEventStore.applyRetention).
 *
 * @returns The number of events deleted, or 0 if retention is disabled.
 */
export async function applyRetention(
  store: IEventStore,
  policy?: RetentionPolicy,
): Promise<{ deletedCount: number; skipped: boolean }> {
  const resolvedPolicy = policy ?? getRetentionPolicy();

  // RETENTION_DAYS=0 means keep forever
  if (resolvedPolicy.retentionDays === 0) {
    return { deletedCount: 0, skipped: true };
  }

  if (resolvedPolicy.retentionDays < 0) {
    return { deletedCount: 0, skipped: true };
  }

  // Calculate the cutoff timestamp
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - resolvedPolicy.retentionDays);
  const olderThan = cutoffDate.toISOString();

  const result = await store.applyRetention(olderThan);

  return { deletedCount: result.deletedCount, skipped: false };
}

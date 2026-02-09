/**
 * Data Retention Policies (S-8.1)
 *
 * Per-tier retention windows. Orgs can override with custom settings (Enterprise).
 */

import type { TierName } from '../billing/stripe-client.js';

export interface RetentionPolicy {
  eventRetentionDays: number;
  auditLogRetentionDays: number;
}

/** Default retention per tier (architecture §11.1) */
export const TIER_RETENTION: Record<TierName, RetentionPolicy> = {
  free: { eventRetentionDays: 7, auditLogRetentionDays: 90 },
  pro: { eventRetentionDays: 30, auditLogRetentionDays: 90 },
  team: { eventRetentionDays: 90, auditLogRetentionDays: 365 },
  enterprise: { eventRetentionDays: 365, auditLogRetentionDays: 365 },
};

export interface OrgRetentionInfo {
  orgId: string;
  plan: TierName;
  customRetentionDays: number | null;
}

/**
 * Resolve effective retention days for an org.
 * Enterprise orgs may have custom retention; others use tier defaults.
 */
export function getEffectiveRetention(org: OrgRetentionInfo): RetentionPolicy {
  const tierDefaults = TIER_RETENTION[org.plan] ?? TIER_RETENTION.free;

  if (org.customRetentionDays != null && org.plan === 'enterprise') {
    return {
      eventRetentionDays: org.customRetentionDays,
      auditLogRetentionDays: Math.max(org.customRetentionDays, tierDefaults.auditLogRetentionDays),
    };
  }

  return tierDefaults;
}

/**
 * Get the cutoff date for retention (events older than this should be purged).
 */
export function getRetentionCutoff(retentionDays: number, now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

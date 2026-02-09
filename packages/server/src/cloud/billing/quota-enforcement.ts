/**
 * Quota Enforcement (S-6.3)
 *
 * Checks usage against tier limits on every ingestion request.
 * - Free tier: hard block at 10K events/month (402)
 * - Pro/Team: allow overage up to cap (default 2x)
 * - 80% soft warning
 * - Grace period for paid tiers
 */

import type { TierName } from './stripe-client.js';
import { TIER_CONFIG } from './stripe-client.js';
import type { RedisUsageStore } from './usage-metering.js';
import type { MigrationClient } from '../migrate.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface QuotaCheckResult {
  allowed: boolean;
  status: 'ok' | 'warning' | 'overage' | 'blocked';
  usage: number;
  quota: number;
  usage_pct: number;
  message?: string;
  upgrade_url?: string;
}

export interface QuotaEnforcerDeps {
  db: MigrationClient;
  redis?: RedisUsageStore;
}

export interface OrgQuotaInfo {
  plan: TierName;
  event_quota: number;
  overage_cap_multiplier: number;
}

// ═══════════════════════════════════════════
// Quota Enforcer
// ═══════════════════════════════════════════

export class QuotaEnforcer {
  private orgCache = new Map<string, { info: OrgQuotaInfo; expires: number }>();
  private cacheTtlMs: number;

  constructor(
    private deps: QuotaEnforcerDeps,
    config?: { cacheTtlMs?: number },
  ) {
    this.cacheTtlMs = config?.cacheTtlMs ?? 60_000; // 1 min
  }

  /**
   * Check if an org can ingest events.
   * Designed to be < 5ms via Redis lookup.
   */
  async checkQuota(orgId: string): Promise<QuotaCheckResult> {
    const orgInfo = await this.getOrgInfo(orgId);
    const usage = await this.getCurrentUsage(orgId);
    const quota = orgInfo.event_quota;
    const usagePct = quota > 0 ? (usage / quota) * 100 : 0;

    // Under 80% — all good
    if (usagePct < 80) {
      return { allowed: true, status: 'ok', usage, quota, usage_pct: round2(usagePct) };
    }

    // 80-100% — soft warning
    if (usage < quota) {
      return {
        allowed: true,
        status: 'warning',
        usage,
        quota,
        usage_pct: round2(usagePct),
        message: `You've used ${Math.round(usagePct)}% of your monthly event quota.`,
      };
    }

    // At or over quota
    const plan = orgInfo.plan;

    // Free tier: hard block
    if (plan === 'free') {
      return {
        allowed: false,
        status: 'blocked',
        usage,
        quota,
        usage_pct: round2(usagePct),
        message: 'Monthly event quota exceeded. Upgrade to continue ingesting events.',
        upgrade_url: '/billing/upgrade',
      };
    }

    // Paid tiers: check overage cap
    const overageCap = quota * orgInfo.overage_cap_multiplier;
    if (usage >= overageCap) {
      return {
        allowed: false,
        status: 'blocked',
        usage,
        quota,
        usage_pct: round2(usagePct),
        message: `Overage cap reached (${orgInfo.overage_cap_multiplier}x quota). Contact support to increase.`,
      };
    }

    // Paid tier, within overage cap — allow with overage billing
    return {
      allowed: true,
      status: 'overage',
      usage,
      quota,
      usage_pct: round2(usagePct),
      message: `You're now incurring overage charges at ${TIER_CONFIG[plan]?.overage_rate_per_1k_cents ?? 0}¢ per 1K events.`,
    };
  }

  /**
   * Check if an org should see a warning notification.
   * Returns the warning level or null.
   */
  async getWarningLevel(orgId: string): Promise<'80pct' | '100pct' | null> {
    const orgInfo = await this.getOrgInfo(orgId);
    const usage = await this.getCurrentUsage(orgId);
    const quota = orgInfo.event_quota;
    const pct = quota > 0 ? (usage / quota) * 100 : 0;

    if (pct >= 100) return '100pct';
    if (pct >= 80) return '80pct';
    return null;
  }

  // ── Internals ──

  private async getOrgInfo(orgId: string): Promise<OrgQuotaInfo> {
    // Check cache
    const cached = this.orgCache.get(orgId);
    if (cached && cached.expires > Date.now()) {
      return cached.info;
    }

    const result = await this.deps.db.query(
      `SELECT plan, event_quota, overage_cap_multiplier FROM orgs WHERE id = $1`,
      [orgId],
    );
    const row = (result.rows as any[])[0];
    const info: OrgQuotaInfo = {
      plan: (row?.plan ?? 'free') as TierName,
      event_quota: row?.event_quota ?? TIER_CONFIG.free.event_quota,
      overage_cap_multiplier: row?.overage_cap_multiplier ?? 2.0,
    };

    this.orgCache.set(orgId, { info, expires: Date.now() + this.cacheTtlMs });
    return info;
  }

  private async getCurrentUsage(orgId: string): Promise<number> {
    // Try Redis first (fast path, < 1ms)
    if (this.deps.redis) {
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const redisKey = `usage:${orgId}:${month}`;
      const val = await this.deps.redis.get(redisKey);
      if (val !== null) {
        return parseInt(val, 10);
      }
    }

    // Fallback to DB
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${month}-01T00:00:00Z`;
    const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

    const result = await this.deps.db.query(
      `SELECT COALESCE(SUM(event_count), 0)::int as total
       FROM usage_records
       WHERE org_id = $1 AND hour >= $2 AND hour < $3`,
      [orgId, monthStart, nextMonth.toISOString()],
    );

    return (result.rows as any[])[0]?.total ?? 0;
  }

  /** Clear cache (for testing) */
  clearCache(): void {
    this.orgCache.clear();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

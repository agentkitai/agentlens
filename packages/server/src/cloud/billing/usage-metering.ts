/**
 * Usage Metering Pipeline (S-6.2)
 *
 * Tracks event counts per org per month. Provides:
 * - In-memory batch accumulator (flushes every 10s or 100 events)
 * - Monthly usage query for billing
 * - Stripe usage reporting for metered billing
 * - Redis counter sync for fast quota checks
 */

import type { MigrationClient } from '../migrate.js';
import type { IStripeClient } from './stripe-client.js';
import { TIER_CONFIG, type TierName } from './stripe-client.js';

export interface UsageMeteringDeps {
  db: MigrationClient;
  stripe: IStripeClient;
}

export interface UsageSummary {
  org_id: string;
  month: string; // YYYY-MM
  total_events: number;
  quota: number;
  plan: TierName;
  overage_events: number;
  usage_pct: number;
}

export interface RedisUsageStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

/**
 * In-memory accumulator that batches usage increments
 * before flushing to the database.
 */
export class UsageAccumulator {
  private buffer = new Map<string, number>(); // key: orgId:YYYY-MM, value: count
  private lastFlush = Date.now();
  private totalBuffered = 0;
  private flushIntervalMs: number;
  private flushThreshold: number;

  constructor(
    private deps: UsageMeteringDeps,
    private redisStore?: RedisUsageStore,
    config?: { flushIntervalMs?: number; flushThreshold?: number },
  ) {
    this.flushIntervalMs = config?.flushIntervalMs ?? 10_000;
    this.flushThreshold = config?.flushThreshold ?? 100;
  }

  /**
   * Record events for an org. Accumulates in memory,
   * flushes when threshold or interval is reached.
   */
  async recordEvents(orgId: string, count: number, timestamp?: Date): Promise<void> {
    const date = timestamp ?? new Date();
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${orgId}:${month}`;

    this.buffer.set(key, (this.buffer.get(key) ?? 0) + count);
    this.totalBuffered += count;

    // Update Redis counter immediately for fast quota checks
    if (this.redisStore) {
      const redisKey = `usage:${orgId}:${month}`;
      await this.redisStore.incrby(redisKey, count);
      // Expire at end of month + 7 days
      await this.redisStore.expire(redisKey, 40 * 86400);
    }

    // Check if we should flush
    if (this.totalBuffered >= this.flushThreshold || Date.now() - this.lastFlush >= this.flushIntervalMs) {
      await this.flush();
    }
  }

  /**
   * Flush accumulated counts to the database.
   */
  async flush(): Promise<number> {
    if (this.buffer.size === 0) return 0;

    const entries = Array.from(this.buffer.entries());
    this.buffer.clear();
    const flushed = this.totalBuffered;
    this.totalBuffered = 0;
    this.lastFlush = Date.now();

    for (const [key, count] of entries) {
      const [orgId, month] = key.split(':');
      const hour = `${month}-01T00:00:00Z`; // Store at month start for monthly records

      await this.deps.db.query(
        `INSERT INTO usage_records (org_id, hour, event_count, api_key_id)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (org_id, hour, api_key_id)
         DO UPDATE SET event_count = usage_records.event_count + $3`,
        [orgId, hour, count],
      );
    }

    return flushed;
  }

  /** Get current buffer size (for testing) */
  getBufferSize(): number {
    return this.totalBuffered;
  }
}

/**
 * Query usage data for an org.
 */
export class UsageQuery {
  constructor(private db: MigrationClient) {}

  /**
   * Get current month usage summary for an org.
   */
  async getCurrentMonthUsage(orgId: string): Promise<UsageSummary> {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${month}-01T00:00:00Z`;
    const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const monthEnd = nextMonth.toISOString();

    // Get total events this month
    const usageResult = await this.db.query(
      `SELECT COALESCE(SUM(event_count), 0)::int as total
       FROM usage_records
       WHERE org_id = $1 AND hour >= $2 AND hour < $3`,
      [orgId, monthStart, monthEnd],
    );
    const totalEvents = (usageResult.rows as any[])[0]?.total ?? 0;

    // Get org plan and quota
    const orgResult = await this.db.query(
      `SELECT plan, event_quota FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = (orgResult.rows as any[])[0];
    const plan = (org?.plan ?? 'free') as TierName;
    const quota = org?.event_quota ?? TIER_CONFIG.free.event_quota;

    const overageEvents = Math.max(0, totalEvents - quota);
    const usagePct = quota > 0 ? (totalEvents / quota) * 100 : 0;

    return {
      org_id: orgId,
      month,
      total_events: totalEvents,
      quota,
      plan,
      overage_events: overageEvents,
      usage_pct: Math.round(usagePct * 100) / 100,
    };
  }

  /**
   * Get usage history (monthly summaries).
   */
  async getUsageHistory(orgId: string, months: number = 6): Promise<Array<{ month: string; total_events: number }>> {
    const result = await this.db.query(
      `SELECT
         to_char(date_trunc('month', hour), 'YYYY-MM') as month,
         COALESCE(SUM(event_count), 0)::int as total_events
       FROM usage_records
       WHERE org_id = $1 AND hour >= (now() - make_interval(months => $2))
       GROUP BY date_trunc('month', hour)
       ORDER BY month DESC`,
      [orgId, months],
    );
    return result.rows as Array<{ month: string; total_events: number }>;
  }
}

/**
 * Report overage usage to Stripe for metered billing.
 * Called by an hourly cron job.
 */
export async function reportOverageToStripe(
  db: MigrationClient,
  stripe: IStripeClient,
): Promise<number> {
  // Find orgs on paid plans with overage this month
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${month}-01T00:00:00Z`;

  const orgsResult = await db.query(
    `SELECT o.id, o.plan, o.event_quota, o.stripe_subscription_id,
            COALESCE(SUM(u.event_count), 0)::int as total_events
     FROM orgs o
     LEFT JOIN usage_records u ON u.org_id = o.id AND u.hour >= $1
     WHERE o.plan IN ('pro', 'team') AND o.stripe_subscription_id IS NOT NULL
     GROUP BY o.id
     HAVING COALESCE(SUM(u.event_count), 0) > o.event_quota`,
    [monthStart],
  );

  let reported = 0;
  for (const org of orgsResult.rows as any[]) {
    const overageEvents = org.total_events - org.event_quota;
    if (overageEvents <= 0) continue;

    // Find the metered subscription item
    const sub = await stripe.getSubscription(org.stripe_subscription_id);
    if (!sub) continue;

    const meteredItem = sub.items.data.find(
      (item) => item.price.recurring?.usage_type === 'metered',
    );
    if (!meteredItem) continue;

    // Report overage in units of 1K events
    const overageUnits = Math.ceil(overageEvents / 1000);
    await stripe.reportUsage({
      subscription_item: meteredItem.id,
      quantity: overageUnits,
      timestamp: Math.floor(Date.now() / 1000),
      action: 'set',
    });
    reported++;
  }

  return reported;
}

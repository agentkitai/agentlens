/**
 * Rate Limiter (S-3.4)
 *
 * Sliding window rate limiting. Per-key and per-org limits.
 * Tier defaults: Free=100/min, Pro=5K/min, Team=50K/min.
 * 429 with Retry-After header. Per-key override supported.
 */

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type Tier = 'free' | 'pro' | 'team' | 'enterprise';

export interface RateLimitResult {
  allowed: boolean;
  /** Current count in window */
  current: number;
  /** Limit that was applied */
  limit: number;
  /** Seconds until window resets (for Retry-After header) */
  retryAfterSeconds: number;
  /** Which limit was hit: 'key' | 'org' | null */
  limitedBy: 'key' | 'org' | null;
}

export interface RateLimitConfig {
  /** Window size in seconds (default: 60) */
  windowSeconds?: number;
}

/** Per-tier default limits (events per minute) */
export const TIER_LIMITS: Record<Tier, { perKey: number; perOrg: number }> = {
  free: { perKey: 100, perOrg: 200 },
  pro: { perKey: 5_000, perOrg: 10_000 },
  team: { perKey: 50_000, perOrg: 100_000 },
  enterprise: { perKey: 100_000, perOrg: 500_000 },
};

export interface RateLimitCheckParams {
  orgId: string;
  keyId: string;
  tier: Tier;
  /** Per-key override limit (from api_keys.rate_limit_override), null = use tier default */
  keyOverride: number | null;
  /** Number of events in this request (default: 1) */
  count?: number;
}

// ═══════════════════════════════════════════
// Redis Rate Limiter (sliding window counter)
// ═══════════════════════════════════════════

export interface RateLimitRedisClient {
  multi(): RateLimitRedisMulti;
}

export interface RateLimitRedisMulti {
  zremrangebyscore(key: string, min: number | string, max: number | string): RateLimitRedisMulti;
  zadd(key: string, score: number, member: string): RateLimitRedisMulti;
  zcard(key: string): RateLimitRedisMulti;
  expire(key: string, seconds: number): RateLimitRedisMulti;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses sorted sets with timestamp scores. Each request adds a member,
 * old entries outside the window are pruned.
 */
export class RedisRateLimiter {
  private windowSeconds: number;

  constructor(
    private redis: RateLimitRedisClient,
    config?: RateLimitConfig,
  ) {
    this.windowSeconds = config?.windowSeconds ?? 60;
  }

  async check(params: RateLimitCheckParams): Promise<RateLimitResult> {
    const { orgId, keyId, tier, keyOverride, count = 1 } = params;
    const tierLimits = TIER_LIMITS[tier];
    const keyLimit = keyOverride ?? tierLimits.perKey;
    const orgLimit = tierLimits.perOrg;

    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    // Check per-key limit
    const keyCount = await this.slidingWindowCount(`rate:key:${keyId}`, now, windowStart, count);
    if (keyCount > keyLimit) {
      return {
        allowed: false,
        current: keyCount,
        limit: keyLimit,
        retryAfterSeconds: this.windowSeconds,
        limitedBy: 'key',
      };
    }

    // Check per-org limit
    const orgCount = await this.slidingWindowCount(`rate:org:${orgId}`, now, windowStart, count);
    if (orgCount > orgLimit) {
      return {
        allowed: false,
        current: orgCount,
        limit: orgLimit,
        retryAfterSeconds: this.windowSeconds,
        limitedBy: 'org',
      };
    }

    return {
      allowed: true,
      current: keyCount,
      limit: keyLimit,
      retryAfterSeconds: 0,
      limitedBy: null,
    };
  }

  private async slidingWindowCount(
    key: string,
    now: number,
    windowStart: number,
    count: number,
  ): Promise<number> {
    const multi = this.redis.multi();

    // Remove entries outside window
    multi.zremrangebyscore(key, 0, windowStart);

    // Add new entries
    for (let i = 0; i < count; i++) {
      multi.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}:${i}`);
    }

    // Count entries in window
    multi.zcard(key);

    // Set expiry to auto-cleanup
    multi.expire(key, this.windowSeconds * 2);

    const results = await multi.exec();
    if (!results) return 0;

    // zcard result is at index 2 + count (after zremrangebyscore + count zadds)
    const zcardIdx = 1 + count;
    const zcardResult = results[zcardIdx];
    return (zcardResult?.[1] as number) ?? 0;
  }
}

// ═══════════════════════════════════════════
// In-Memory Rate Limiter (testing / no Redis)
// ═══════════════════════════════════════════

/**
 * In-memory sliding window rate limiter for testing.
 */
export class InMemoryRateLimiter {
  private windows = new Map<string, number[]>();
  private windowSeconds: number;

  constructor(config?: RateLimitConfig) {
    this.windowSeconds = config?.windowSeconds ?? 60;
  }

  async check(params: RateLimitCheckParams): Promise<RateLimitResult> {
    const { orgId, keyId, tier, keyOverride, count = 1 } = params;
    const tierLimits = TIER_LIMITS[tier];
    const keyLimit = keyOverride ?? tierLimits.perKey;
    const orgLimit = tierLimits.perOrg;

    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    // Check per-key
    const keyKey = `rate:key:${keyId}`;
    const keyCount = this.addAndCount(keyKey, now, windowStart, count);
    if (keyCount > keyLimit) {
      return {
        allowed: false,
        current: keyCount,
        limit: keyLimit,
        retryAfterSeconds: this.windowSeconds,
        limitedBy: 'key',
      };
    }

    // Check per-org
    const orgKey = `rate:org:${orgId}`;
    const orgCount = this.addAndCount(orgKey, now, windowStart, count);
    if (orgCount > orgLimit) {
      return {
        allowed: false,
        current: orgCount,
        limit: orgLimit,
        retryAfterSeconds: this.windowSeconds,
        limitedBy: 'org',
      };
    }

    return {
      allowed: true,
      current: keyCount,
      limit: keyLimit,
      retryAfterSeconds: 0,
      limitedBy: null,
    };
  }

  /** Reset all state */
  reset(): void {
    this.windows.clear();
  }

  private addAndCount(key: string, now: number, windowStart: number, count: number): number {
    let entries = this.windows.get(key) ?? [];
    // Prune old entries
    entries = entries.filter((ts) => ts > windowStart);
    // Add new
    for (let i = 0; i < count; i++) {
      entries.push(now);
    }
    this.windows.set(key, entries);
    return entries.length;
  }
}

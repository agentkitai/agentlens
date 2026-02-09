/**
 * Tests for S-3.4: Rate Limiting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryRateLimiter,
  TIER_LIMITS,
  type RateLimitCheckParams,
} from '../ingestion/index.js';

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeParams(overrides?: Partial<RateLimitCheckParams>): RateLimitCheckParams {
  return {
    orgId: 'org-111',
    keyId: 'key-222',
    tier: 'free',
    keyOverride: null,
    count: 1,
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// Tier Defaults
// ═══════════════════════════════════════════

describe('S-3.4: Tier Defaults', () => {
  it('free tier: 100/min per-key, 200/min per-org', () => {
    expect(TIER_LIMITS.free).toEqual({ perKey: 100, perOrg: 200 });
  });

  it('pro tier: 5K/min per-key, 10K/min per-org', () => {
    expect(TIER_LIMITS.pro).toEqual({ perKey: 5_000, perOrg: 10_000 });
  });

  it('team tier: 50K/min per-key, 100K/min per-org', () => {
    expect(TIER_LIMITS.team).toEqual({ perKey: 50_000, perOrg: 100_000 });
  });

  it('enterprise tier has limits', () => {
    expect(TIER_LIMITS.enterprise.perKey).toBeGreaterThan(0);
    expect(TIER_LIMITS.enterprise.perOrg).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════
// Rate Limiter Behavior
// ═══════════════════════════════════════════

describe('S-3.4: InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter({ windowSeconds: 60 });
  });

  it('allows requests within per-key limit', async () => {
    const result = await limiter.check(makeParams({ tier: 'free' }));
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.limitedBy).toBeNull();
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('blocks when per-key limit exceeded', async () => {
    // Use a tiny window limiter and exhaust the free tier (100/min)
    for (let i = 0; i < 100; i++) {
      await limiter.check(makeParams());
    }

    const result = await limiter.check(makeParams());
    expect(result.allowed).toBe(false);
    expect(result.limitedBy).toBe('key');
    expect(result.retryAfterSeconds).toBe(60);
    expect(result.current).toBe(101);
    expect(result.limit).toBe(100);
  });

  it('blocks when per-org limit exceeded (multiple keys)', async () => {
    // Free org limit is 200. Use 3 keys so no single key hits 100.
    // 3 keys × 67 = 201 org total, but each key only at 67 < 100
    for (let i = 0; i < 67; i++) {
      await limiter.check(makeParams({ keyId: 'key-A' }));
    }
    for (let i = 0; i < 67; i++) {
      await limiter.check(makeParams({ keyId: 'key-B' }));
    }
    for (let i = 0; i < 66; i++) {
      await limiter.check(makeParams({ keyId: 'key-C' }));
    }

    // Org total is 200. Next request from key-C (67th) should pass key (67 <= 100) but fail org (201 > 200)
    const result = await limiter.check(makeParams({ keyId: 'key-C' }));
    expect(result.allowed).toBe(false);
    expect(result.limitedBy).toBe('org');
  });

  it('per-key override raises limit', async () => {
    // Override key limit to 200 (higher than free default of 100)
    for (let i = 0; i < 150; i++) {
      await limiter.check(makeParams({ keyOverride: 200 }));
    }

    const result = await limiter.check(makeParams({ keyOverride: 200 }));
    expect(result.allowed).toBe(true); // 151 <= 200
  });

  it('per-key override lowers limit', async () => {
    // Override key limit to 5 (lower than free default)
    for (let i = 0; i < 5; i++) {
      await limiter.check(makeParams({ keyOverride: 5 }));
    }

    const result = await limiter.check(makeParams({ keyOverride: 5 }));
    expect(result.allowed).toBe(false);
    expect(result.limitedBy).toBe('key');
    expect(result.limit).toBe(5);
  });

  it('higher tier allows more requests', async () => {
    // Pro tier: 5000/min per key
    for (let i = 0; i < 200; i++) {
      await limiter.check(makeParams({ tier: 'pro' }));
    }

    const result = await limiter.check(makeParams({ tier: 'pro' }));
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5_000);
  });

  it('batch count consumed correctly', async () => {
    // Send 99 at once, then 1 more should be OK, then 1 more blocked
    await limiter.check(makeParams({ count: 99 }));
    const ok = await limiter.check(makeParams({ count: 1 }));
    expect(ok.allowed).toBe(true);
    expect(ok.current).toBe(100);

    const blocked = await limiter.check(makeParams({ count: 1 }));
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitedBy).toBe('key');
  });

  it('different orgs have independent limits', async () => {
    // Exhaust org-111
    for (let i = 0; i < 100; i++) {
      await limiter.check(makeParams({ orgId: 'org-111' }));
    }
    const blocked = await limiter.check(makeParams({ orgId: 'org-111' }));
    expect(blocked.allowed).toBe(false);

    // org-222 should be fine
    const ok = await limiter.check(makeParams({ orgId: 'org-222', keyId: 'key-other' }));
    expect(ok.allowed).toBe(true);
  });

  it('reset clears all state', async () => {
    for (let i = 0; i < 100; i++) {
      await limiter.check(makeParams());
    }
    const blocked = await limiter.check(makeParams());
    expect(blocked.allowed).toBe(false);

    limiter.reset();

    const ok = await limiter.check(makeParams());
    expect(ok.allowed).toBe(true);
    expect(ok.current).toBe(1);
  });
});

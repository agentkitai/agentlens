/**
 * Tests for S-6.1, S-6.2, S-6.3: Stripe + Metering + Quota Enforcement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockStripeClient,
  TIER_CONFIG,
  BillingService,
  UsageAccumulator,
  UsageQuery,
  QuotaEnforcer,
  type StripeWebhookEvent,
  type RedisUsageStore,
} from '../billing/index.js';

// ═══════════════════════════════════════════
// Mock DB
// ═══════════════════════════════════════════

interface MockRow {
  [key: string]: unknown;
}

function createMockDb() {
  const tables: Record<string, MockRow[]> = {
    orgs: [],
    usage_records: [],
    invoices: [],
  };

  return {
    tables,
    async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
      const sqlLower = sql.toLowerCase().trim();

      // INSERT INTO orgs
      if (sqlLower.startsWith('insert into orgs')) {
        // not used directly in billing tests
        return { rows: [] };
      }

      // UPDATE orgs SET stripe_customer_id
      if (sqlLower.includes('update orgs set stripe_customer_id')) {
        const org = tables.orgs.find((o) => o.id === params?.[1]);
        if (org) org.stripe_customer_id = params?.[0];
        return { rows: [] };
      }

      // UPDATE orgs SET plan (upgrade: 4 params, downgrade-to-free: 2 params)
      if (sqlLower.includes('update orgs set plan')) {
        if (params && params.length === 4) {
          // upgrade: plan=$1, sub_id=$2, quota=$3, org_id=$4
          const org = tables.orgs.find((o) => o.id === params[3]);
          if (org) {
            org.plan = params[0];
            org.stripe_subscription_id = params[1];
            org.event_quota = params[2];
          }
        } else if (params && params.length === 2) {
          // subscription deleted: quota=$1, org_id=$2
          const org = tables.orgs.find((o) => o.id === params[1]);
          if (org) {
            org.plan = 'free';
            org.stripe_subscription_id = null;
            org.event_quota = params[0];
          }
        }
        return { rows: [] };
      }

      // UPDATE orgs SET settings (pending_downgrade or payment_status)
      if (sqlLower.includes('update orgs set settings')) {
        const orgId = params?.[0];
        const org = tables.orgs.find((o) => o.id === orgId);
        if (org) {
          if (sqlLower.includes('pending_downgrade')) {
            org.pending_downgrade = 'free';
          }
          if (sqlLower.includes('payment_status')) {
            org.payment_status = 'past_due';
          }
        }
        return { rows: [] };
      }

      // UPDATE orgs SET stripe_subscription_id (webhook)
      if (sqlLower.includes('update orgs set stripe_subscription_id') && !sqlLower.includes('plan')) {
        const org = tables.orgs.find((o) => o.id === params?.[1]);
        if (org) org.stripe_subscription_id = params?.[0];
        return { rows: [] };
      }

      // SELECT from orgs (various)
      if (sqlLower.includes('from orgs') && sqlLower.includes('select')) {
        if (sqlLower.includes('stripe_customer_id = $1')) {
          return { rows: tables.orgs.filter((o) => o.stripe_customer_id === params?.[0]) };
        }
        if (sqlLower.includes('where id = $1') || sqlLower.includes('where o.id = $1')) {
          return { rows: tables.orgs.filter((o) => o.id === params?.[0]) };
        }
        // Overage report query (JOIN with usage_records)
        if (sqlLower.includes('left join usage_records')) {
          const results = tables.orgs
            .filter((o) => ['pro', 'team'].includes(o.plan as string) && o.stripe_subscription_id)
            .map((o) => {
              const total = tables.usage_records
                .filter((u) => u.org_id === o.id)
                .reduce((sum, u) => sum + (u.event_count as number), 0);
              return { ...o, total_events: total };
            })
            .filter((o) => o.total_events > (o.event_quota as number));
          return { rows: results };
        }
        return { rows: tables.orgs.filter((o) => o.id === params?.[0]) };
      }

      // INSERT INTO usage_records
      if (sqlLower.includes('insert into usage_records')) {
        const existing = tables.usage_records.find(
          (u) => u.org_id === params?.[0] && u.hour === params?.[1] && u.api_key_id === params?.[3],
        );
        if (existing) {
          existing.event_count = (existing.event_count as number) + (params?.[2] as number);
        } else {
          tables.usage_records.push({
            org_id: params?.[0] as string,
            hour: params?.[1] as string,
            event_count: params?.[2] as number,
            api_key_id: params?.[3],
          });
        }
        return { rows: [] };
      }

      // SELECT SUM usage_records
      if (sqlLower.includes('from usage_records') && sqlLower.includes('sum')) {
        if (sqlLower.includes("to_char") || sqlLower.includes('date_trunc')) {
          // History query
          return { rows: [] };
        }
        const orgId = params?.[0];
        const total = tables.usage_records
          .filter((u) => u.org_id === orgId)
          .reduce((sum, u) => sum + (u.event_count as number), 0);
        return { rows: [{ total }] };
      }

      // INSERT INTO invoices
      if (sqlLower.includes('insert into invoices')) {
        tables.invoices.push({
          org_id: params?.[0],
          stripe_invoice_id: params?.[1],
          status: 'paid',
          total_amount_cents: params?.[4],
        });
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

function createMockRedis(): RedisUsageStore & { data: Map<string, number> } {
  const data = new Map<string, number>();
  return {
    data,
    async get(key: string) {
      const val = data.get(key);
      return val !== undefined ? String(val) : null;
    },
    async set(key: string, value: string) {
      data.set(key, parseInt(value, 10));
    },
    async incrby(key: string, amount: number) {
      const cur = data.get(key) ?? 0;
      data.set(key, cur + amount);
      return cur + amount;
    },
    async expire() {},
  };
}

function addOrg(
  db: ReturnType<typeof createMockDb>,
  overrides: Partial<MockRow> = {},
): MockRow {
  const org: MockRow = {
    id: `org-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Org',
    slug: 'test-org',
    plan: 'free',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    event_quota: TIER_CONFIG.free.event_quota,
    overage_cap_multiplier: 2.0,
    settings: {},
    ...overrides,
  };
  db.tables.orgs.push(org);
  return org;
}

// ═══════════════════════════════════════════
// S-6.1: Stripe Integration Setup
// ═══════════════════════════════════════════

describe('S-6.1: Stripe Integration Setup', () => {
  let stripe: MockStripeClient;
  let db: ReturnType<typeof createMockDb>;
  let billing: BillingService;

  beforeEach(() => {
    stripe = new MockStripeClient();
    db = createMockDb();
    billing = new BillingService({ stripe, db });
  });

  it('creates Stripe customer on org creation', async () => {
    const org = addOrg(db, { id: 'org-1' });

    const customerId = await billing.createCustomerForOrg('org-1', 'test@example.com', 'Test Org');

    expect(customerId).toMatch(/^cus_mock_/);
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.customers[0].metadata.org_id).toBe('org-1');
    expect(org.stripe_customer_id).toBe(customerId);
  });

  it('creates subscription on upgrade to Pro', async () => {
    const org = addOrg(db, { id: 'org-2', stripe_customer_id: 'cus_123' });

    await billing.upgradePlan('org-2', 'pro');

    expect(stripe.subscriptions).toHaveLength(1);
    expect(stripe.subscriptions[0].customer).toBe('cus_123');
    expect(org.plan).toBe('pro');
    expect(org.event_quota).toBe(TIER_CONFIG.pro.event_quota);
  });

  it('rejects upgrade to free tier', async () => {
    addOrg(db, { id: 'org-3', stripe_customer_id: 'cus_456' });
    await expect(billing.upgradePlan('org-3', 'free')).rejects.toThrow('Cannot upgrade to free');
  });

  it('handles downgrade (cancel at period end)', async () => {
    const org = addOrg(db, { id: 'org-4', plan: 'pro', stripe_customer_id: 'cus_789', stripe_subscription_id: 'sub_1' });
    // Need to add the subscription to the mock
    stripe.subscriptions.push({
      id: 'sub_1',
      customer: 'cus_789',
      status: 'active',
      items: { data: [] },
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
    });

    await billing.downgradePlan('org-4');

    expect(stripe.subscriptions[0].cancel_at_period_end).toBe(true);
    expect(org.pending_downgrade).toBe('free');
  });

  it('processes invoice.paid webhook', async () => {
    addOrg(db, { id: 'org-5', stripe_customer_id: 'cus_wh1' });

    const event: StripeWebhookEvent = {
      id: 'evt_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_1',
          customer: 'cus_wh1',
          amount_paid: 2900,
          period_start: 1700000000,
          period_end: 1702592000,
        },
      },
    };

    const result = await billing.handleWebhook(event);
    expect(result.handled).toBe(true);
    expect(result.action).toBe('invoice_recorded');
    expect(db.tables.invoices).toHaveLength(1);
  });

  it('processes payment_failed webhook', async () => {
    const org = addOrg(db, { id: 'org-6', stripe_customer_id: 'cus_wh2' });

    const event: StripeWebhookEvent = {
      id: 'evt_2',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_wh2' } },
    };

    const result = await billing.handleWebhook(event);
    expect(result.handled).toBe(true);
    expect(org.payment_status).toBe('past_due');
  });

  it('processes subscription.deleted webhook (downgrades to free)', async () => {
    const org = addOrg(db, {
      id: 'org-7',
      plan: 'pro',
      stripe_customer_id: 'cus_wh3',
      stripe_subscription_id: 'sub_old',
      event_quota: TIER_CONFIG.pro.event_quota,
    });

    const event: StripeWebhookEvent = {
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', customer: 'cus_wh3' } },
    };

    const result = await billing.handleWebhook(event);
    expect(result.handled).toBe(true);
    expect(result.action).toBe('downgraded_to_free');
    expect(org.plan).toBe('free');
    expect(org.event_quota).toBe(TIER_CONFIG.free.event_quota);
  });

  it('ignores unknown webhook events', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_99',
      type: 'some.unknown.event',
      data: { object: {} },
    };

    const result = await billing.handleWebhook(event);
    expect(result.handled).toBe(false);
    expect(result.action).toBe('ignored');
  });
});

// ═══════════════════════════════════════════
// S-6.2: Usage Metering
// ═══════════════════════════════════════════

describe('S-6.2: Usage Metering', () => {
  let db: ReturnType<typeof createMockDb>;
  let stripe: MockStripeClient;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    db = createMockDb();
    stripe = new MockStripeClient();
    redis = createMockRedis();
  });

  it('accumulates events and flushes to DB', async () => {
    const accumulator = new UsageAccumulator({ db, stripe }, undefined, {
      flushThreshold: 5,
      flushIntervalMs: 999999,
    });

    // Add 3 events (under threshold)
    await accumulator.recordEvents('org-1', 3);
    expect(db.tables.usage_records).toHaveLength(0); // not flushed yet
    expect(accumulator.getBufferSize()).toBe(3);

    // Add 3 more (triggers flush at 6 >= 5)
    await accumulator.recordEvents('org-1', 3);
    expect(db.tables.usage_records).toHaveLength(1);
    expect(db.tables.usage_records[0].event_count).toBe(6);
  });

  it('updates Redis counter immediately', async () => {
    const accumulator = new UsageAccumulator({ db, stripe }, redis, {
      flushThreshold: 999,
      flushIntervalMs: 999999,
    });

    await accumulator.recordEvents('org-1', 10);

    // Redis updated immediately even though DB hasn't flushed
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(redis.data.get(`usage:org-1:${month}`)).toBe(10);
  });

  it('flush returns 0 when buffer is empty', async () => {
    const accumulator = new UsageAccumulator({ db, stripe });
    const count = await accumulator.flush();
    expect(count).toBe(0);
  });

  it('manual flush writes all accumulated data', async () => {
    const accumulator = new UsageAccumulator({ db, stripe }, undefined, {
      flushThreshold: 999,
      flushIntervalMs: 999999,
    });

    await accumulator.recordEvents('org-1', 5);
    await accumulator.recordEvents('org-2', 3);
    const flushed = await accumulator.flush();

    expect(flushed).toBe(8);
    expect(db.tables.usage_records).toHaveLength(2);
  });

  it('UsageQuery returns current month summary', async () => {
    addOrg(db, { id: 'org-q1', plan: 'pro', event_quota: TIER_CONFIG.pro.event_quota });
    db.tables.usage_records.push({ org_id: 'org-q1', hour: '2026-02-01T00:00:00Z', event_count: 5000, api_key_id: null });

    const query = new UsageQuery(db);
    const summary = await query.getCurrentMonthUsage('org-q1');

    expect(summary.total_events).toBe(5000);
    expect(summary.plan).toBe('pro');
    expect(summary.quota).toBe(TIER_CONFIG.pro.event_quota);
    expect(summary.overage_events).toBe(0);
    expect(summary.usage_pct).toBeGreaterThan(0);
  });

  it('reports overage to Stripe for paid tiers', async () => {
    const org = addOrg(db, {
      id: 'org-ov1',
      plan: 'pro',
      event_quota: 1000,
      stripe_subscription_id: 'sub_ov1',
    });

    // Add usage over quota
    db.tables.usage_records.push({ org_id: 'org-ov1', hour: '2026-02-01T00:00:00Z', event_count: 1500, api_key_id: null });

    // Add subscription with metered item to mock
    stripe.subscriptions.push({
      id: 'sub_ov1',
      customer: 'cus_ov1',
      status: 'active',
      items: {
        data: [
          { id: 'si_base', price: { id: 'price_pro_monthly' } },
          { id: 'si_metered', price: { id: 'price_pro_overage', recurring: { usage_type: 'metered' } } },
        ],
      },
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
    });

    const { reportOverageToStripe: report } = await import('../billing/usage-metering.js');
    const reported = await report(db, stripe);

    expect(reported).toBe(1);
    expect(stripe.usageRecords).toHaveLength(1);
    expect(stripe.usageRecords[0].subscription_item).toBe('si_metered');
  });

  it('skips overage report when usage is within quota', async () => {
    addOrg(db, {
      id: 'org-ov2',
      plan: 'pro',
      event_quota: 10000,
      stripe_subscription_id: 'sub_ov2',
    });
    db.tables.usage_records.push({ org_id: 'org-ov2', hour: '2026-02-01T00:00:00Z', event_count: 500, api_key_id: null });

    const { reportOverageToStripe: report } = await import('../billing/usage-metering.js');
    const reported = await report(db, stripe);
    expect(reported).toBe(0);
  });
});

// ═══════════════════════════════════════════
// S-6.3: Quota Enforcement
// ═══════════════════════════════════════════

describe('S-6.3: Quota Enforcement', () => {
  let db: ReturnType<typeof createMockDb>;
  let redis: ReturnType<typeof createMockRedis>;
  let enforcer: QuotaEnforcer;

  beforeEach(() => {
    db = createMockDb();
    redis = createMockRedis();
    enforcer = new QuotaEnforcer({ db, redis }, { cacheTtlMs: 0 }); // no cache for tests
  });

  it('allows events when under quota', async () => {
    addOrg(db, { id: 'org-q1', plan: 'free', event_quota: 10000 });
    redis.data.set(`usage:org-q1:${currentMonth()}`, 1000);

    const result = await enforcer.checkQuota('org-q1');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.usage).toBe(1000);
  });

  it('returns warning at 80% usage', async () => {
    addOrg(db, { id: 'org-q2', plan: 'free', event_quota: 10000 });
    redis.data.set(`usage:org-q2:${currentMonth()}`, 8500);

    const result = await enforcer.checkQuota('org-q2');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('warning');
    expect(result.message).toContain('85%');
  });

  it('blocks free tier at 100% (returns 402 equivalent)', async () => {
    addOrg(db, { id: 'org-q3', plan: 'free', event_quota: 10000 });
    redis.data.set(`usage:org-q3:${currentMonth()}`, 10000);

    const result = await enforcer.checkQuota('org-q3');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.upgrade_url).toBe('/billing/upgrade');
  });

  it('allows overage for paid tiers within cap', async () => {
    addOrg(db, { id: 'org-q4', plan: 'pro', event_quota: 1000000, overage_cap_multiplier: 2.0 });
    redis.data.set(`usage:org-q4:${currentMonth()}`, 1200000);

    const result = await enforcer.checkQuota('org-q4');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('overage');
    expect(result.message).toContain('overage');
  });

  it('blocks paid tier when overage cap reached', async () => {
    addOrg(db, { id: 'org-q5', plan: 'pro', event_quota: 1000000, overage_cap_multiplier: 2.0 });
    redis.data.set(`usage:org-q5:${currentMonth()}`, 2000000);

    const result = await enforcer.checkQuota('org-q5');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.message).toContain('cap');
  });

  it('getWarningLevel returns 80pct warning', async () => {
    addOrg(db, { id: 'org-q6', plan: 'free', event_quota: 10000 });
    redis.data.set(`usage:org-q6:${currentMonth()}`, 8100);

    const level = await enforcer.getWarningLevel('org-q6');
    expect(level).toBe('80pct');
  });

  it('getWarningLevel returns 100pct for at-quota', async () => {
    addOrg(db, { id: 'org-q7', plan: 'pro', event_quota: 1000000 });
    redis.data.set(`usage:org-q7:${currentMonth()}`, 1000001);

    const level = await enforcer.getWarningLevel('org-q7');
    expect(level).toBe('100pct');
  });

  it('falls back to DB when Redis has no data', async () => {
    addOrg(db, { id: 'org-q8', plan: 'free', event_quota: 10000 });
    db.tables.usage_records.push({ org_id: 'org-q8', hour: '2026-02-01T00:00:00Z', event_count: 500, api_key_id: null });

    // Don't set redis data — force DB fallback
    const enforcerNoRedis = new QuotaEnforcer({ db }, { cacheTtlMs: 0 });
    const result = await enforcerNoRedis.checkQuota('org-q8');
    expect(result.allowed).toBe(true);
    expect(result.usage).toBe(500);
  });
});

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

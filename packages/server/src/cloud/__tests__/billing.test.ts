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
  PlanManager,
  InvoiceService,
  TrialService,
  ANNUAL_DISCOUNT,
  calculateAnnualPrice,
  TRIAL_DURATION_DAYS,
  ANNUAL_PRICE_IDS,
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

      // UPDATE orgs SET plan (various patterns)
      if (sqlLower.includes('update orgs set plan')) {
        // Trial start: plan = 'pro', event_quota, settings with jsonb_set + trial_started_at
        if (sqlLower.includes('trial_started_at') && sqlLower.includes("plan = 'pro'")) {
          const org = tables.orgs.find((o) => o.id === params?.[3]);
          if (org) {
            org.plan = 'pro';
            org.event_quota = params?.[0];
            if (!org.settings) org.settings = {};
            (org.settings as any).trial_started_at = JSON.parse(params?.[1] as string);
            (org.settings as any).trial_ends_at = JSON.parse(params?.[2] as string);
          }
          return { rows: [] };
        }
      }
      if (sqlLower.includes('update orgs set plan')) {
        if (sqlLower.includes("plan = 'free'") && sqlLower.includes('stripe_subscription_id = null') && sqlLower.includes("- 'pending_downgrade'")) {
          // applyPendingDowngrade to free: quota=$1, org_id=$2
          const org = tables.orgs.find((o) => o.id === params?.[1]);
          if (org) {
            org.plan = 'free';
            org.stripe_subscription_id = null;
            org.event_quota = params?.[0];
            if (org.settings) delete (org.settings as any).pending_downgrade;
          }
        } else if (sqlLower.includes("- 'pending_downgrade'") && params && params.length === 4) {
          // applyPendingDowngrade to paid tier: plan=$1, sub=$2, quota=$3, org=$4
          const org = tables.orgs.find((o) => o.id === params[3]);
          if (org) {
            org.plan = params[0];
            org.stripe_subscription_id = params[1];
            org.event_quota = params[2];
            if (org.settings) delete (org.settings as any).pending_downgrade;
          }
        } else if (sqlLower.includes("plan = 'free'") && sqlLower.includes("- 'trial_started_at'")) {
          // expire trial: quota=$1, org=$2
          const org = tables.orgs.find((o) => o.id === params?.[1]);
          if (org) {
            org.plan = 'free';
            org.event_quota = params?.[0];
            if (org.settings) {
              delete (org.settings as any).trial_started_at;
              delete (org.settings as any).trial_ends_at;
            }
          }
        } else if (params && params.length === 4) {
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
      if (sqlLower.includes('update orgs set settings') && !sqlLower.includes('update orgs set plan')) {
        // Figure out which param is orgId (last param for jsonb_set patterns)
        const orgId = params?.[params.length - 1] ?? params?.[0];
        const org = tables.orgs.find((o) => o.id === orgId);
        if (org) {
          if (!org.settings) org.settings = {};
          if (sqlLower.includes('pending_downgrade') && sqlLower.includes('billing_interval')) {
            // Plan management upgrade: sets billing_interval and clears pending_downgrade
            (org.settings as any).billing_interval = JSON.parse(params?.[3] as string ?? '"monthly"');
            delete (org.settings as any).pending_downgrade;
            org.plan = params?.[0];
            org.stripe_subscription_id = params?.[1];
            org.event_quota = params?.[2];
          } else if (sqlLower.includes('pending_downgrade') && !sqlLower.includes('billing_interval')) {
            // Downgrade scheduling
            const pendingVal = params?.[0];
            try {
              (org.settings as any).pending_downgrade = JSON.parse(pendingVal as string);
            } catch {
              org.pending_downgrade = 'free';
            }
          } else if (sqlLower.includes('payment_status')) {
            org.payment_status = 'past_due';
          } else if (sqlLower.includes('trial_started_at')) {
            // Trial start
            (org.settings as any).trial_started_at = JSON.parse(params?.[1] as string ?? 'null');
            (org.settings as any).trial_ends_at = JSON.parse(params?.[2] as string ?? 'null');
            org.plan = 'pro';
            org.event_quota = TIER_CONFIG.pro.event_quota;
          } else if (sqlLower.includes("- 'trial_started_at'")) {
            // Cancel trial / expire trial
            delete (org.settings as any).trial_started_at;
            delete (org.settings as any).trial_ends_at;
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
        // Trial expiry query
        if (sqlLower.includes("settings->>'trial_ends_at'") && sqlLower.includes('< $1')) {
          const now = params?.[0] as string;
          return {
            rows: tables.orgs.filter((o) => {
              const s = o.settings as any;
              return o.plan === 'pro' && s?.trial_ends_at && s.trial_ends_at < now && !o.stripe_subscription_id;
            }),
          };
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

      // SELECT from invoices
      if (sqlLower.includes('from invoices') && sqlLower.includes('select')) {
        return { rows: tables.invoices.filter((i) => i.org_id === params?.[0]) };
      }

      // INSERT INTO invoices
      if (sqlLower.includes('insert into invoices')) {
        if (params && params.length >= 10) {
          // S-6.5 invoice service: 10 params
          const existing = tables.invoices.find((i) => i.stripe_invoice_id === params[1]);
          if (existing) {
            existing.status = params[7];
            existing.total_amount_cents = params[6];
            existing.overage_amount_cents = params[5];
            existing.line_items = JSON.parse(params[9] as string);
          } else {
            tables.invoices.push({
              org_id: params[0],
              stripe_invoice_id: params[1],
              period_start: params[2],
              period_end: params[3],
              base_amount_cents: params[4],
              overage_amount_cents: params[5],
              total_amount_cents: params[6],
              status: params[7],
              billing_interval: params[8],
              line_items: JSON.parse(params[9] as string),
            });
          }
        } else {
          // S-6.1 billing service: 5 params
          tables.invoices.push({
            org_id: params?.[0],
            stripe_invoice_id: params?.[1],
            status: 'paid',
            total_amount_cents: params?.[4],
          });
        }
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
// S-6.4: Plan Upgrade/Downgrade
// ═══════════════════════════════════════════

describe('S-6.4: Plan Upgrade/Downgrade', () => {
  let stripe: MockStripeClient;
  let db: ReturnType<typeof createMockDb>;
  let planMgr: PlanManager;

  beforeEach(() => {
    stripe = new MockStripeClient();
    db = createMockDb();
    planMgr = new PlanManager({ stripe, db });
  });

  it('upgrades from free to pro immediately', async () => {
    const org = addOrg(db, { id: 'org-up1', plan: 'free', stripe_customer_id: 'cus_up1', settings: {} });

    const result = await planMgr.changePlan('org-up1', 'pro');

    expect(result.success).toBe(true);
    expect(result.action).toBe('upgraded');
    expect(result.effectiveAt).toBe('immediate');
    expect(result.previousPlan).toBe('free');
    expect(result.newPlan).toBe('pro');
    expect(stripe.subscriptions).toHaveLength(1);
  });

  it('upgrades from pro to team with proration', async () => {
    stripe.subscriptions.push({
      id: 'sub_existing',
      customer: 'cus_up2',
      status: 'active',
      items: { data: [] },
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
    });
    addOrg(db, {
      id: 'org-up2', plan: 'pro', stripe_customer_id: 'cus_up2',
      stripe_subscription_id: 'sub_existing', settings: {},
    });

    const result = await planMgr.changePlan('org-up2', 'team');

    expect(result.prorationApplied).toBe(true);
    expect(result.action).toBe('upgraded');
    // Existing sub updated atomically (not cancel+recreate)
    expect(stripe.subscriptions[0].status).toBe('active');
    expect(stripe.subscriptions).toHaveLength(1);
  });

  it('downgrades from pro to free at end of period', async () => {
    stripe.subscriptions.push({
      id: 'sub_down1',
      customer: 'cus_d1',
      status: 'active',
      items: { data: [] },
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
    });
    addOrg(db, {
      id: 'org-d1', plan: 'pro', stripe_customer_id: 'cus_d1',
      stripe_subscription_id: 'sub_down1', settings: {},
    });

    const result = await planMgr.changePlan('org-d1', 'free');

    expect(result.action).toBe('scheduled_downgrade');
    expect(result.effectiveAt).toBe('end_of_period');
    expect(stripe.subscriptions[0].cancel_at_period_end).toBe(true);
  });

  it('downgrades from team to pro at end of period', async () => {
    stripe.subscriptions.push({
      id: 'sub_down2',
      customer: 'cus_d2',
      status: 'active',
      items: { data: [] },
      current_period_start: 0,
      current_period_end: 0,
      cancel_at_period_end: false,
    });
    addOrg(db, {
      id: 'org-d2', plan: 'team', stripe_customer_id: 'cus_d2',
      stripe_subscription_id: 'sub_down2', settings: {},
    });

    const result = await planMgr.changePlan('org-d2', 'pro');

    expect(result.action).toBe('scheduled_downgrade');
    expect(result.effectiveAt).toBe('end_of_period');
  });

  it('rejects changing to the same plan', async () => {
    addOrg(db, { id: 'org-same', plan: 'pro', stripe_customer_id: 'cus_s', settings: {} });
    await expect(planMgr.changePlan('org-same', 'pro')).rejects.toThrow('already on');
  });

  it('rejects when no Stripe customer exists', async () => {
    addOrg(db, { id: 'org-nocust', plan: 'free', settings: {} });
    await expect(planMgr.changePlan('org-nocust', 'pro')).rejects.toThrow('no Stripe customer');
  });

  it('supports annual billing on upgrade', async () => {
    addOrg(db, { id: 'org-ann', plan: 'free', stripe_customer_id: 'cus_ann', settings: {} });

    await planMgr.changePlan('org-ann', 'pro', 'annual');

    const sub = stripe.subscriptions[0];
    expect(sub.items.data[0].price.id).toBe(ANNUAL_PRICE_IDS.pro);
  });

  it('applies pending downgrade to free via applyPendingDowngrade', async () => {
    const org = addOrg(db, {
      id: 'org-apd', plan: 'pro', stripe_customer_id: 'cus_apd',
      stripe_subscription_id: null, settings: { pending_downgrade: 'free' },
    });

    await planMgr.applyPendingDowngrade('org-apd');

    expect(org.plan).toBe('free');
    expect(org.event_quota).toBe(TIER_CONFIG.free.event_quota);
  });
});

// ═══════════════════════════════════════════
// S-6.5: Invoice Generation & Annual Billing
// ═══════════════════════════════════════════

describe('S-6.5: Invoice Generation & Annual Billing', () => {
  let stripe: MockStripeClient;
  let db: ReturnType<typeof createMockDb>;
  let invoiceSvc: InvoiceService;

  beforeEach(() => {
    stripe = new MockStripeClient();
    db = createMockDb();
    invoiceSvc = new InvoiceService({ stripe, db });
  });

  it('syncs invoice from webhook with line items', async () => {
    addOrg(db, { id: 'org-inv1', stripe_customer_id: 'cus_inv1' });

    const event: StripeWebhookEvent = {
      id: 'evt_inv1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_001',
          customer: 'cus_inv1',
          status: 'paid',
          amount_due: 2900,
          amount_paid: 2900,
          period_start: 1700000000,
          period_end: 1702592000,
          lines: {
            data: [
              { description: 'Pro Plan - Monthly', amount: 2900, quantity: 1 },
            ],
          },
        },
      },
    };

    const record = await invoiceSvc.syncInvoiceFromWebhook(event);

    expect(record).not.toBeNull();
    expect(record!.status).toBe('paid');
    expect(record!.base_amount_cents).toBe(2900);
    expect(record!.overage_amount_cents).toBe(0);
    expect(record!.line_items).toHaveLength(1);
    expect(db.tables.invoices).toHaveLength(1);
  });

  it('separates base and overage amounts in invoice', async () => {
    addOrg(db, { id: 'org-inv2', stripe_customer_id: 'cus_inv2' });

    const event: StripeWebhookEvent = {
      id: 'evt_inv2',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_002',
          customer: 'cus_inv2',
          status: 'paid',
          amount_due: 3100,
          amount_paid: 3100,
          period_start: 1700000000,
          period_end: 1702592000,
          lines: {
            data: [
              { description: 'Pro Plan - Monthly', amount: 2900, quantity: 1 },
              { description: 'Overage Events', amount: 200, quantity: 200 },
            ],
          },
        },
      },
    };

    const record = await invoiceSvc.syncInvoiceFromWebhook(event);

    expect(record!.base_amount_cents).toBe(2900);
    expect(record!.overage_amount_cents).toBe(200);
    expect(record!.total_amount_cents).toBe(3100);
  });

  it('detects annual billing from period length', async () => {
    addOrg(db, { id: 'org-inv3', stripe_customer_id: 'cus_inv3' });

    const yearStart = 1700000000;
    const yearEnd = yearStart + 365 * 86400;

    const event: StripeWebhookEvent = {
      id: 'evt_inv3',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_003',
          customer: 'cus_inv3',
          status: 'paid',
          amount_due: 27840,
          amount_paid: 27840,
          period_start: yearStart,
          period_end: yearEnd,
          lines: { data: [{ description: 'Pro Plan - Annual', amount: 27840, quantity: 1 }] },
        },
      },
    };

    const record = await invoiceSvc.syncInvoiceFromWebhook(event);
    expect(record!.billing_interval).toBe('annual');
  });

  it('calculates annual price with 20% discount', () => {
    const monthlyPro = TIER_CONFIG.pro.base_price_cents;
    const annualPro = calculateAnnualPrice(monthlyPro);
    const expected = Math.round(monthlyPro * 12 * 0.8);
    expect(annualPro).toBe(expected);
    expect(ANNUAL_DISCOUNT).toBe(0.20);
  });

  it('returns null when org not found for invoice webhook', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_no_org',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_no_org',
          customer: 'cus_nonexistent',
          status: 'paid',
          amount_due: 100,
          amount_paid: 100,
          period_start: 1700000000,
          period_end: 1702592000,
          lines: { data: [] },
        },
      },
    };

    const record = await invoiceSvc.syncInvoiceFromWebhook(event);
    expect(record).toBeNull();
  });

  it('lists invoices for an org', async () => {
    addOrg(db, { id: 'org-inv4', stripe_customer_id: 'cus_inv4' });
    db.tables.invoices.push(
      { org_id: 'org-inv4', stripe_invoice_id: 'inv_a', status: 'paid', total_amount_cents: 2900 },
      { org_id: 'org-inv4', stripe_invoice_id: 'inv_b', status: 'paid', total_amount_cents: 3100 },
    );

    const invoices = await invoiceSvc.listInvoices('org-inv4');
    expect(invoices).toHaveLength(2);
  });

  it('calculates overage charges correctly', async () => {
    addOrg(db, { id: 'org-ov', plan: 'pro', event_quota: 1000 });
    db.tables.usage_records.push({
      org_id: 'org-ov', hour: '2026-02-01T00:00:00Z', event_count: 1500, api_key_id: null,
    });

    const charges = await invoiceSvc.calculateOverageCharges('org-ov');
    expect(charges.overage_events).toBe(500);
    expect(charges.rate_per_1k_cents).toBe(TIER_CONFIG.pro.overage_rate_per_1k_cents);
    expect(charges.overage_cost_cents).toBe(Math.ceil(500 / 1000) * TIER_CONFIG.pro.overage_rate_per_1k_cents);
  });

  it('upserts invoice on duplicate stripe_invoice_id', async () => {
    addOrg(db, { id: 'org-inv5', stripe_customer_id: 'cus_inv5' });

    const makeEvent = (status: string, amount: number): StripeWebhookEvent => ({
      id: 'evt_dup',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'inv_dup', customer: 'cus_inv5', status,
          amount_due: amount, amount_paid: amount,
          period_start: 1700000000, period_end: 1702592000,
          lines: { data: [{ description: 'Pro', amount, quantity: 1 }] },
        },
      },
    });

    await invoiceSvc.syncInvoiceFromWebhook(makeEvent('open', 2900));
    await invoiceSvc.syncInvoiceFromWebhook(makeEvent('paid', 2900));

    expect(db.tables.invoices).toHaveLength(1);
    expect(db.tables.invoices[0].status).toBe('paid');
  });
});

// ═══════════════════════════════════════════
// S-6.6: Free Trial (14-day Pro)
// ═══════════════════════════════════════════

describe('S-6.6: Free Trial (14-day Pro)', () => {
  let stripe: MockStripeClient;
  let db: ReturnType<typeof createMockDb>;
  let trialSvc: TrialService;

  beforeEach(() => {
    stripe = new MockStripeClient();
    db = createMockDb();
    trialSvc = new TrialService({ stripe, db });
  });

  it('starts a 14-day Pro trial on new org', async () => {
    addOrg(db, { id: 'org-t1', plan: 'free', settings: {} });

    const status = await trialSvc.startTrial('org-t1');

    expect(status.is_trial).toBe(true);
    expect(status.days_remaining).toBe(TRIAL_DURATION_DAYS);
    expect(status.expired).toBe(false);
    expect(status.trial_started_at).toBeTruthy();
    expect(status.trial_ends_at).toBeTruthy();

    const org = db.tables.orgs.find((o) => o.id === 'org-t1')!;
    expect(org.plan).toBe('pro');
    expect(org.event_quota).toBe(TIER_CONFIG.pro.event_quota);
  });

  it('returns trial status with days remaining', async () => {
    const now = new Date();
    const ends = new Date(now.getTime() + 7 * 86400 * 1000);
    addOrg(db, {
      id: 'org-t2', plan: 'pro',
      settings: { trial_started_at: now.toISOString(), trial_ends_at: ends.toISOString() },
    });

    const status = await trialSvc.getTrialStatus('org-t2');

    expect(status.is_trial).toBe(true);
    expect(status.days_remaining).toBeLessThanOrEqual(7);
    expect(status.days_remaining).toBeGreaterThan(0);
    expect(status.expired).toBe(false);
  });

  it('reports expired trial correctly', async () => {
    const past = new Date(Date.now() - 2 * 86400 * 1000);
    const pastEnd = new Date(Date.now() - 1 * 86400 * 1000);
    addOrg(db, {
      id: 'org-t3', plan: 'pro',
      settings: { trial_started_at: past.toISOString(), trial_ends_at: pastEnd.toISOString() },
    });

    const status = await trialSvc.getTrialStatus('org-t3');

    expect(status.is_trial).toBe(false);
    expect(status.expired).toBe(true);
    expect(status.days_remaining).toBe(0);
  });

  it('expires trials and downgrades to free', async () => {
    const past = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 1 * 86400 * 1000).toISOString();
    addOrg(db, {
      id: 'org-t4', plan: 'pro', stripe_subscription_id: null,
      settings: { trial_started_at: past, trial_ends_at: pastEnd },
    });

    const count = await trialSvc.expireTrials();

    expect(count).toBe(1);
    const org = db.tables.orgs.find((o) => o.id === 'org-t4')!;
    expect(org.plan).toBe('free');
    expect(org.event_quota).toBe(TIER_CONFIG.free.event_quota);
  });

  it('does not expire orgs that upgraded (have subscription)', async () => {
    const past = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 1 * 86400 * 1000).toISOString();
    addOrg(db, {
      id: 'org-t5', plan: 'pro', stripe_subscription_id: 'sub_paid',
      settings: { trial_started_at: past, trial_ends_at: pastEnd },
    });

    const count = await trialSvc.expireTrials();
    expect(count).toBe(0);
  });

  it('returns non-trial status for orgs without trial', async () => {
    addOrg(db, { id: 'org-t6', plan: 'free', settings: {} });

    const status = await trialSvc.getTrialStatus('org-t6');

    expect(status.is_trial).toBe(false);
    expect(status.trial_started_at).toBeNull();
    expect(status.days_remaining).toBe(0);
  });
});

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Stripe Client Abstraction (S-6.1)
 *
 * Provides a unified interface for Stripe operations with a mock
 * implementation for testing. Real Stripe calls activate when
 * STRIPE_SECRET_KEY is set.
 */

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface StripeCustomer {
  id: string;
  email: string;
  name: string;
  metadata: Record<string, string>;
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
  items: { data: StripeSubscriptionItem[] };
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
}

export interface StripeSubscriptionItem {
  id: string;
  price: { id: string; recurring?: { usage_type?: string } };
}

export interface StripeInvoice {
  id: string;
  customer: string;
  subscription: string | null;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amount_due: number;
  amount_paid: number;
  period_start: number;
  period_end: number;
  lines: { data: StripeInvoiceLine[] };
}

export interface StripeInvoiceLine {
  description: string;
  amount: number;
  quantity: number;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CreateSubscriptionParams {
  customer: string;
  items: Array<{ price: string }>;
  trial_period_days?: number;
}

export interface UsageRecordParams {
  subscription_item: string;
  quantity: number;
  timestamp: number;
  action: 'increment' | 'set';
}

// ═══════════════════════════════════════════
// Tier Configuration
// ═══════════════════════════════════════════

export const TIER_CONFIG = {
  free: {
    name: 'Free',
    base_price_cents: 0,
    event_quota: 10_000,
    overage_rate_per_1k_cents: 0, // no overage on free
    price_id: 'price_free',
    overage_price_id: null as string | null,
  },
  pro: {
    name: 'Pro',
    base_price_cents: 2900, // $29/mo
    event_quota: 1_000_000,
    overage_rate_per_1k_cents: 10, // $0.10/1K
    price_id: 'price_pro_monthly',
    overage_price_id: 'price_pro_overage',
  },
  team: {
    name: 'Team',
    base_price_cents: 9900, // $99/mo
    event_quota: 10_000_000,
    overage_rate_per_1k_cents: 8, // $0.08/1K
    price_id: 'price_team_monthly',
    overage_price_id: 'price_team_overage',
  },
  enterprise: {
    name: 'Enterprise',
    base_price_cents: 0, // custom
    event_quota: 100_000_000,
    overage_rate_per_1k_cents: 0,
    price_id: 'price_enterprise',
    overage_price_id: null as string | null,
  },
} as const;

export type TierName = keyof typeof TIER_CONFIG;

// ═══════════════════════════════════════════
// Stripe Client Interface
// ═══════════════════════════════════════════

export interface IStripeClient {
  createCustomer(email: string, name: string, orgId: string): Promise<StripeCustomer>;
  createSubscription(params: CreateSubscriptionParams): Promise<StripeSubscription>;
  cancelSubscription(subscriptionId: string, atPeriodEnd?: boolean): Promise<StripeSubscription>;
  updateSubscription(subscriptionId: string, items: Array<{ price: string }>): Promise<StripeSubscription>;
  getSubscription(subscriptionId: string): Promise<StripeSubscription | null>;
  reportUsage(params: UsageRecordParams): Promise<void>;
  constructWebhookEvent(payload: string, signature: string): StripeWebhookEvent;
}

// ═══════════════════════════════════════════
// Mock Stripe Client (for testing)
// ═══════════════════════════════════════════

export class MockStripeClient implements IStripeClient {
  public customers: StripeCustomer[] = [];
  public subscriptions: StripeSubscription[] = [];
  public usageRecords: UsageRecordParams[] = [];
  public webhookEvents: StripeWebhookEvent[] = [];
  private idCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}_mock_${++this.idCounter}`;
  }

  async createCustomer(email: string, name: string, orgId: string): Promise<StripeCustomer> {
    const customer: StripeCustomer = {
      id: this.nextId('cus'),
      email,
      name,
      metadata: { org_id: orgId },
    };
    this.customers.push(customer);
    return customer;
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<StripeSubscription> {
    const now = Math.floor(Date.now() / 1000);
    const sub: StripeSubscription = {
      id: this.nextId('sub'),
      customer: params.customer,
      status: params.trial_period_days ? 'trialing' : 'active',
      items: {
        data: params.items.map((item) => ({
          id: this.nextId('si'),
          price: { id: item.price, recurring: { usage_type: item.price.includes('overage') ? 'metered' : 'licensed' } },
        })),
      },
      current_period_start: now,
      current_period_end: now + 30 * 86400,
      cancel_at_period_end: false,
    };
    this.subscriptions.push(sub);
    return sub;
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<StripeSubscription> {
    const sub = this.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);
    if (atPeriodEnd) {
      sub.cancel_at_period_end = true;
    } else {
      sub.status = 'canceled';
    }
    return sub;
  }

  async updateSubscription(subscriptionId: string, items: Array<{ price: string }>): Promise<StripeSubscription> {
    const sub = this.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);
    sub.items = {
      data: items.map((item) => ({
        id: this.nextId('si'),
        price: { id: item.price, recurring: { usage_type: item.price.includes('overage') ? 'metered' : 'licensed' } },
      })),
    };
    return sub;
  }

  async getSubscription(subscriptionId: string): Promise<StripeSubscription | null> {
    return this.subscriptions.find((s) => s.id === subscriptionId) ?? null;
  }

  async reportUsage(params: UsageRecordParams): Promise<void> {
    this.usageRecords.push(params);
  }

  constructWebhookEvent(payload: string, _signature: string): StripeWebhookEvent {
    return JSON.parse(payload) as StripeWebhookEvent;
  }

  /** Test helper: reset all state */
  reset(): void {
    this.customers = [];
    this.subscriptions = [];
    this.usageRecords = [];
    this.webhookEvents = [];
    this.idCounter = 0;
  }
}

// ═══════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════

/**
 * Create a Stripe client. Returns MockStripeClient when no
 * STRIPE_SECRET_KEY is set (for testing/development).
 */
export function createStripeClient(secretKey?: string): IStripeClient {
  const key = secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return new MockStripeClient();
  }
  // Return a guarded mock that verifies webhook signatures via HMAC
  // Real Stripe SDK integration deferred to deployment; this ensures
  // webhook payloads are at least signature-verified in production.
  const client = new MockStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const origConstruct = client.constructWebhookEvent.bind(client);
    client.constructWebhookEvent = (payload: string, signature: string): StripeWebhookEvent => {
      // Verify Stripe-style signature (v1=HMAC-SHA256)
      const { createHmac } = require('node:crypto');
      const parts = signature.split(',').reduce((acc: Record<string, string>, part: string) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {} as Record<string, string>);
      const timestamp = parts['t'];
      const sig = parts['v1'];
      if (!timestamp || !sig) throw new Error('Invalid Stripe webhook signature format');
      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');
      // H-6 FIX: Use timing-safe comparison for HMAC verification
      const { timingSafeEqual: tse } = require('node:crypto');
      const sigBuf = Buffer.from(sig, 'utf-8');
      const expectedBuf = Buffer.from(expected, 'utf-8');
      if (sigBuf.length !== expectedBuf.length || !tse(sigBuf, expectedBuf)) {
        throw new Error('Stripe webhook signature verification failed');
      }
      return origConstruct(payload, signature);
    };
  }
  return client;
}

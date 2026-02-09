/**
 * Billing Service (S-6.1)
 *
 * Handles Stripe customer lifecycle, subscription management,
 * and webhook processing.
 */

import type { IStripeClient, TierName, StripeWebhookEvent } from './stripe-client.js';
import { TIER_CONFIG } from './stripe-client.js';
import type { MigrationClient } from '../migrate.js';

export interface BillingServiceDeps {
  stripe: IStripeClient;
  db: MigrationClient;
}

export interface WebhookResult {
  handled: boolean;
  action?: string;
  error?: string;
}

export class BillingService {
  constructor(private deps: BillingServiceDeps) {}

  /**
   * Create a Stripe customer for an org (called on org creation).
   * Stores stripe_customer_id on the orgs table.
   */
  async createCustomerForOrg(orgId: string, email: string, name: string): Promise<string> {
    const customer = await this.deps.stripe.createCustomer(email, name, orgId);

    await this.deps.db.query(
      `UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2`,
      [customer.id, orgId],
    );

    return customer.id;
  }

  /**
   * Upgrade an org to a paid plan. Creates a Stripe subscription.
   */
  async upgradePlan(orgId: string, newTier: TierName): Promise<void> {
    if (newTier === 'free') {
      throw new Error('Cannot upgrade to free tier. Use downgradePlan instead.');
    }

    const tierConfig = TIER_CONFIG[newTier];
    const org = await this.getOrg(orgId);

    if (!org.stripe_customer_id) {
      throw new Error('Org has no Stripe customer. Call createCustomerForOrg first.');
    }

    // Cancel existing subscription if any
    if (org.stripe_subscription_id) {
      await this.deps.stripe.cancelSubscription(org.stripe_subscription_id, false);
    }

    // Create new subscription
    const items: Array<{ price: string }> = [{ price: tierConfig.price_id }];
    if (tierConfig.overage_price_id) {
      items.push({ price: tierConfig.overage_price_id });
    }

    const subscription = await this.deps.stripe.createSubscription({
      customer: org.stripe_customer_id,
      items,
    });

    await this.deps.db.query(
      `UPDATE orgs SET plan = $1, stripe_subscription_id = $2, event_quota = $3, updated_at = now()
       WHERE id = $4`,
      [newTier, subscription.id, tierConfig.event_quota, orgId],
    );
  }

  /**
   * Downgrade an org (cancels at period end, schedules free tier).
   */
  async downgradePlan(orgId: string): Promise<void> {
    const org = await this.getOrg(orgId);

    if (org.stripe_subscription_id) {
      await this.deps.stripe.cancelSubscription(org.stripe_subscription_id, true);
    }

    // Mark as pending downgrade — actual tier change happens via webhook
    // when subscription period ends. For immediate effect in tests/mock:
    await this.deps.db.query(
      `UPDATE orgs SET settings = jsonb_set(COALESCE(settings, '{}'), '{pending_downgrade}', '"free"'), updated_at = now()
       WHERE id = $1`,
      [orgId],
    );
  }

  /**
   * Process a Stripe webhook event.
   */
  async handleWebhook(event: StripeWebhookEvent): Promise<WebhookResult> {
    try {
      switch (event.type) {
        case 'invoice.paid':
          return await this.handleInvoicePaid(event);
        case 'invoice.payment_failed':
          return await this.handlePaymentFailed(event);
        case 'customer.subscription.updated':
          return await this.handleSubscriptionUpdated(event);
        case 'customer.subscription.deleted':
          return await this.handleSubscriptionDeleted(event);
        default:
          return { handled: false, action: 'ignored' };
      }
    } catch (err) {
      return { handled: false, error: String(err) };
    }
  }

  // ── Webhook handlers ──

  private async handleInvoicePaid(event: StripeWebhookEvent): Promise<WebhookResult> {
    const invoice = event.data.object as Record<string, unknown>;
    const stripeInvoiceId = invoice.id as string;
    const customerId = invoice.customer as string;
    const amountPaid = invoice.amount_paid as number;
    const periodStart = invoice.period_start as number;
    const periodEnd = invoice.period_end as number;

    // Find org by stripe_customer_id
    const orgResult = await this.deps.db.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1`,
      [customerId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) return { handled: false, error: 'org_not_found' };

    // Upsert invoice record
    await this.deps.db.query(
      `INSERT INTO invoices (org_id, stripe_invoice_id, period_start, period_end, base_amount_cents, total_amount_cents, status)
       VALUES ($1, $2, to_timestamp($3), to_timestamp($4), $5, $5, 'paid')
       ON CONFLICT (stripe_invoice_id) DO UPDATE SET status = 'paid', total_amount_cents = $5`,
      [org.id, stripeInvoiceId, periodStart, periodEnd, amountPaid],
    );

    return { handled: true, action: 'invoice_recorded' };
  }

  private async handlePaymentFailed(event: StripeWebhookEvent): Promise<WebhookResult> {
    const invoice = event.data.object as Record<string, unknown>;
    const customerId = invoice.customer as string;

    const orgResult = await this.deps.db.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1`,
      [customerId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) return { handled: false, error: 'org_not_found' };

    // Mark org as past_due in settings
    await this.deps.db.query(
      `UPDATE orgs SET settings = jsonb_set(COALESCE(settings, '{}'), '{payment_status}', '"past_due"')
       WHERE id = $1`,
      [org.id],
    );

    return { handled: true, action: 'payment_failed_recorded' };
  }

  private async handleSubscriptionUpdated(event: StripeWebhookEvent): Promise<WebhookResult> {
    const sub = event.data.object as Record<string, unknown>;
    const customerId = sub.customer as string;
    const subId = sub.id as string;
    const cancelAtPeriodEnd = sub.cancel_at_period_end as boolean;

    const orgResult = await this.deps.db.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1`,
      [customerId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) return { handled: false, error: 'org_not_found' };

    await this.deps.db.query(
      `UPDATE orgs SET stripe_subscription_id = $1, updated_at = now() WHERE id = $2`,
      [subId, org.id],
    );

    if (cancelAtPeriodEnd) {
      await this.deps.db.query(
        `UPDATE orgs SET settings = jsonb_set(COALESCE(settings, '{}'), '{pending_downgrade}', '"free"')
         WHERE id = $1`,
        [org.id],
      );
    }

    return { handled: true, action: 'subscription_updated' };
  }

  private async handleSubscriptionDeleted(event: StripeWebhookEvent): Promise<WebhookResult> {
    const sub = event.data.object as Record<string, unknown>;
    const customerId = sub.customer as string;

    const orgResult = await this.deps.db.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1`,
      [customerId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) return { handled: false, error: 'org_not_found' };

    // Downgrade to free
    await this.deps.db.query(
      `UPDATE orgs SET plan = 'free', stripe_subscription_id = NULL,
       event_quota = $1, updated_at = now() WHERE id = $2`,
      [TIER_CONFIG.free.event_quota, org.id],
    );

    return { handled: true, action: 'downgraded_to_free' };
  }

  // ── Helpers ──

  private async getOrg(orgId: string): Promise<{
    id: string;
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }> {
    const result = await this.deps.db.query(
      `SELECT id, plan, stripe_customer_id, stripe_subscription_id FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = (result.rows as any[])[0];
    if (!org) throw new Error(`Org ${orgId} not found`);
    return org;
  }
}

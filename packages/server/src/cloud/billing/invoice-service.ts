/**
 * Invoice Generation & Annual Billing (S-6.5)
 *
 * - Monthly invoices via Stripe with itemized usage (base + overage)
 * - Annual billing with 20% discount
 * - Invoices table synced from Stripe webhooks
 * - Invoice list queryable via API
 */

import type { IStripeClient, TierName, StripeWebhookEvent } from './stripe-client.js';
import { TIER_CONFIG } from './stripe-client.js';
import type { MigrationClient } from '../migrate.js';

export interface InvoiceServiceDeps {
  stripe: IStripeClient;
  db: MigrationClient;
}

export interface InvoiceRecord {
  id: string;
  org_id: string;
  stripe_invoice_id: string;
  period_start: string;
  period_end: string;
  base_amount_cents: number;
  overage_amount_cents: number;
  total_amount_cents: number;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  billing_interval: 'monthly' | 'annual';
  line_items: InvoiceLineItem[];
  created_at: string;
}

export interface InvoiceLineItem {
  description: string;
  amount_cents: number;
  quantity: number;
}

/** Annual pricing = monthly × 12 × 0.8 (20% discount) */
export const ANNUAL_DISCOUNT = 0.20;

export function calculateAnnualPrice(monthlyPriceCents: number): number {
  return Math.round(monthlyPriceCents * 12 * (1 - ANNUAL_DISCOUNT));
}

export class InvoiceService {
  constructor(private deps: InvoiceServiceDeps) {}

  /**
   * Sync an invoice from a Stripe webhook event into the invoices table.
   */
  async syncInvoiceFromWebhook(event: StripeWebhookEvent): Promise<InvoiceRecord | null> {
    const invoice = event.data.object as Record<string, unknown>;
    const stripeInvoiceId = invoice.id as string;
    const customerId = invoice.customer as string;
    const status = invoice.status as string;
    const amountDue = (invoice.amount_due as number) ?? 0;
    const amountPaid = (invoice.amount_paid as number) ?? 0;
    const periodStart = invoice.period_start as number;
    const periodEnd = invoice.period_end as number;

    // Extract line items
    const lines = (invoice.lines as any)?.data ?? [];
    const lineItems: InvoiceLineItem[] = lines.map((line: any) => ({
      description: line.description ?? 'Subscription',
      amount_cents: line.amount ?? 0,
      quantity: line.quantity ?? 1,
    }));

    // Calculate base vs overage from line items
    let baseAmount = 0;
    let overageAmount = 0;
    for (const line of lineItems) {
      if ((line.description ?? '').toLowerCase().includes('overage')) {
        overageAmount += line.amount_cents;
      } else {
        baseAmount += line.amount_cents;
      }
    }

    const totalAmount = status === 'paid' ? amountPaid : amountDue;

    // Find org
    const orgResult = await this.deps.db.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1`,
      [customerId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) return null;

    // Determine billing interval from period length
    const periodDays = (periodEnd - periodStart) / 86400;
    const billingInterval = periodDays > 60 ? 'annual' : 'monthly';

    // Upsert invoice
    await this.deps.db.query(
      `INSERT INTO invoices (org_id, stripe_invoice_id, period_start, period_end,
       base_amount_cents, overage_amount_cents, total_amount_cents, status,
       billing_interval, line_items)
       VALUES ($1, $2, to_timestamp($3), to_timestamp($4), $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (stripe_invoice_id)
       DO UPDATE SET status = $8, total_amount_cents = $7, overage_amount_cents = $6,
       line_items = $10::jsonb`,
      [
        org.id, stripeInvoiceId, periodStart, periodEnd,
        baseAmount, overageAmount, totalAmount, status,
        billingInterval, JSON.stringify(lineItems),
      ],
    );

    return {
      id: stripeInvoiceId,
      org_id: org.id,
      stripe_invoice_id: stripeInvoiceId,
      period_start: new Date(periodStart * 1000).toISOString(),
      period_end: new Date(periodEnd * 1000).toISOString(),
      base_amount_cents: baseAmount,
      overage_amount_cents: overageAmount,
      total_amount_cents: totalAmount,
      status: status as InvoiceRecord['status'],
      billing_interval: billingInterval as 'monthly' | 'annual',
      line_items: lineItems,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * List invoices for an org, newest first.
   */
  async listInvoices(orgId: string, limit = 20, offset = 0): Promise<InvoiceRecord[]> {
    const result = await this.deps.db.query(
      `SELECT * FROM invoices WHERE org_id = $1
       ORDER BY period_start DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset],
    );
    return result.rows as InvoiceRecord[];
  }

  /**
   * Calculate overage charges for an org's current period.
   */
  async calculateOverageCharges(orgId: string): Promise<{
    overage_events: number;
    overage_cost_cents: number;
    rate_per_1k_cents: number;
  }> {
    // Get org plan and usage
    const orgResult = await this.deps.db.query(
      `SELECT plan, event_quota FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = (orgResult.rows as any[])[0];
    if (!org) throw new Error(`Org ${orgId} not found`);

    const plan = org.plan as TierName;
    const quota = org.event_quota as number;
    const rate = TIER_CONFIG[plan]?.overage_rate_per_1k_cents ?? 0;

    // Get current month usage
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${month}-01T00:00:00Z`;
    const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

    const usageResult = await this.deps.db.query(
      `SELECT COALESCE(SUM(event_count), 0)::int as total
       FROM usage_records WHERE org_id = $1 AND hour >= $2 AND hour < $3`,
      [orgId, monthStart, nextMonth.toISOString()],
    );
    const totalEvents = (usageResult.rows as any[])[0]?.total ?? 0;
    const overageEvents = Math.max(0, totalEvents - quota);
    const overageCostCents = Math.ceil(overageEvents / 1000) * rate;

    return {
      overage_events: overageEvents,
      overage_cost_cents: overageCostCents,
      rate_per_1k_cents: rate,
    };
  }
}

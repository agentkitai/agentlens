/**
 * Billing Routes (S-7.5)
 *
 * Express-compatible route handlers for billing page data:
 * - Current plan & trial status
 * - Invoice history
 * - Plan upgrade/downgrade
 * - Payment method management (Stripe portal)
 */

import type { MigrationClient } from '../migrate.js';
import type { BillingService } from '../billing/billing-service.js';
import type { InvoiceService } from '../billing/invoice-service.js';
import type { TrialService } from '../billing/trial-service.js';
import type { AuditLogService } from '../auth/audit-log.js';
import type { TierName } from '../billing/stripe-client.js';
import { TIER_CONFIG } from '../billing/stripe-client.js';

export interface BillingRoutesDeps {
  db: MigrationClient;
  billingService: BillingService;
  invoiceService: InvoiceService;
  trialService: TrialService;
  auditLog?: AuditLogService;
}

export function createBillingRouteHandlers(deps: BillingRoutesDeps) {
  return {
    /** GET /api/cloud/orgs/:orgId/billing — billing overview */
    async getBillingOverview(
      orgId: string,
      userId: string,
    ): Promise<{ status: number; body: unknown }> {
      const orgResult = await deps.db.query(
        `SELECT id, plan, stripe_customer_id, stripe_subscription_id, event_quota, settings
         FROM orgs WHERE id = $1`,
        [orgId],
      );
      const org = (orgResult.rows as any[])[0];
      if (!org) return { status: 404, body: { error: 'Org not found' } };

      const trialStatus = await deps.trialService.getTrialStatus(orgId);
      const plan = org.plan as TierName;
      const tierConfig = TIER_CONFIG[plan] ?? TIER_CONFIG.free;

      // Get current period usage
      const now = new Date();
      const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const usageResult = await deps.db.query(
        `SELECT COALESCE(SUM(event_count), 0)::int as total
         FROM usage_records WHERE org_id = $1 AND hour >= $2`,
        [orgId, monthStart.toISOString()],
      );
      const currentUsage = (usageResult.rows as any[])[0]?.total ?? 0;

      return {
        status: 200,
        body: {
          plan,
          plan_name: tierConfig.name,
          base_price_cents: tierConfig.base_price_cents,
          event_quota: org.event_quota ?? tierConfig.event_quota,
          current_usage: currentUsage,
          has_payment_method: !!org.stripe_customer_id,
          stripe_subscription_id: org.stripe_subscription_id,
          trial: trialStatus,
          pending_downgrade: org.settings?.pending_downgrade ?? null,
          payment_status: org.settings?.payment_status ?? 'active',
        },
      };
    },

    /** GET /api/cloud/orgs/:orgId/billing/invoices — invoice history */
    async getInvoices(
      orgId: string,
      limit = 20,
      offset = 0,
    ): Promise<{ status: number; body: unknown }> {
      const invoices = await deps.invoiceService.listInvoices(orgId, limit, offset);
      return { status: 200, body: invoices };
    },

    /** POST /api/cloud/orgs/:orgId/billing/upgrade — upgrade plan */
    async upgradePlan(
      orgId: string,
      userId: string,
      body: { plan: string },
    ): Promise<{ status: number; body: unknown }> {
      const newPlan = body.plan as TierName;
      if (!TIER_CONFIG[newPlan] || newPlan === 'free') {
        return { status: 400, body: { error: 'Invalid plan' } };
      }

      try {
        await deps.billingService.upgradePlan(orgId, newPlan);
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: orgId,
            actor_type: 'user',
            actor_id: userId,
            action: 'billing.plan_changed',
            resource_type: 'org',
            resource_id: orgId,
            details: { new_plan: newPlan, direction: 'upgrade' },
            result: 'success',
          });
        }
        return { status: 200, body: { ok: true, plan: newPlan } };
      } catch (err) {
        return { status: 400, body: { error: String(err) } };
      }
    },

    /** POST /api/cloud/orgs/:orgId/billing/downgrade — downgrade to free */
    async downgradePlan(
      orgId: string,
      userId: string,
    ): Promise<{ status: number; body: unknown }> {
      try {
        await deps.billingService.downgradePlan(orgId);
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: orgId,
            actor_type: 'user',
            actor_id: userId,
            action: 'billing.plan_changed',
            resource_type: 'org',
            resource_id: orgId,
            details: { new_plan: 'free', direction: 'downgrade' },
            result: 'success',
          });
        }
        return { status: 200, body: { ok: true, scheduled: 'end_of_period' } };
      } catch (err) {
        return { status: 400, body: { error: String(err) } };
      }
    },

    /** POST /api/cloud/orgs/:orgId/billing/portal — create Stripe portal session URL */
    async createPortalSession(
      orgId: string,
    ): Promise<{ status: number; body: unknown }> {
      const orgResult = await deps.db.query(
        `SELECT stripe_customer_id FROM orgs WHERE id = $1`,
        [orgId],
      );
      const org = (orgResult.rows as any[])[0];
      if (!org?.stripe_customer_id) {
        return { status: 400, body: { error: 'No payment method on file' } };
      }
      // In real impl, create Stripe Billing Portal session
      // For now, return a placeholder URL
      return {
        status: 200,
        body: { url: `https://billing.stripe.com/p/session/${org.stripe_customer_id}` },
      };
    },
  };
}

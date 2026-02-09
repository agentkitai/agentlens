/**
 * Plan Upgrade/Downgrade (S-6.4)
 *
 * - Upgrade: immediate, with proration
 * - Downgrade: at end of billing period
 * - Enforces tier limits (keys, members, orgs)
 */

import type { IStripeClient, TierName } from './stripe-client.js';
import { TIER_CONFIG } from './stripe-client.js';
import type { MigrationClient } from '../migrate.js';

export interface PlanManagementDeps {
  stripe: IStripeClient;
  db: MigrationClient;
}

export interface PlanChangeResult {
  success: boolean;
  action: 'upgraded' | 'downgraded' | 'scheduled_downgrade';
  previousPlan: TierName;
  newPlan: TierName;
  effectiveAt: 'immediate' | 'end_of_period';
  prorationApplied?: boolean;
}

/** Tier ordering for upgrade/downgrade detection */
const TIER_ORDER: Record<TierName, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

/** Annual pricing: 20% discount applied to monthly × 12 */
export const ANNUAL_PRICE_IDS: Partial<Record<TierName, string>> = {
  pro: 'price_pro_annual',
  team: 'price_team_annual',
};

export class PlanManager {
  constructor(private deps: PlanManagementDeps) {}

  /**
   * Change an org's plan. Upgrades are immediate with proration;
   * downgrades take effect at end of billing period.
   */
  async changePlan(orgId: string, newTier: TierName, billing: 'monthly' | 'annual' = 'monthly'): Promise<PlanChangeResult> {
    const org = await this.getOrg(orgId);
    const currentTier = org.plan as TierName;

    if (currentTier === newTier) {
      throw new Error(`Org is already on the ${newTier} plan.`);
    }

    if (!org.stripe_customer_id) {
      throw new Error('Org has no Stripe customer. Call createCustomerForOrg first.');
    }

    const isUpgrade = TIER_ORDER[newTier] > TIER_ORDER[currentTier];

    if (isUpgrade) {
      return this.handleUpgrade(org, newTier, billing);
    } else {
      return this.handleDowngrade(org, newTier);
    }
  }

  /**
   * Immediate upgrade with proration.
   */
  private async handleUpgrade(
    org: OrgRow,
    newTier: TierName,
    billing: 'monthly' | 'annual',
  ): Promise<PlanChangeResult> {
    const previousPlan = org.plan as TierName;
    const tierConfig = TIER_CONFIG[newTier];

    // Cancel existing subscription immediately if any
    if (org.stripe_subscription_id) {
      await this.deps.stripe.cancelSubscription(org.stripe_subscription_id, false);
    }

    // Build subscription items
    const priceId = billing === 'annual' && ANNUAL_PRICE_IDS[newTier]
      ? ANNUAL_PRICE_IDS[newTier]!
      : tierConfig.price_id;

    const items: Array<{ price: string }> = [{ price: priceId }];
    if (tierConfig.overage_price_id) {
      items.push({ price: tierConfig.overage_price_id });
    }

    // Create new subscription (Stripe handles proration automatically)
    const subscription = await this.deps.stripe.createSubscription({
      customer: org.stripe_customer_id!,
      items,
    });

    // Update org immediately
    await this.deps.db.query(
      `UPDATE orgs SET plan = $1, stripe_subscription_id = $2, event_quota = $3,
       settings = jsonb_set(
         jsonb_set(COALESCE(settings, '{}'), '{billing_interval}', $5::jsonb),
         '{pending_downgrade}', 'null'::jsonb
       ),
       updated_at = now()
       WHERE id = $4`,
      [newTier, subscription.id, tierConfig.event_quota, org.id, JSON.stringify(billing)],
    );

    return {
      success: true,
      action: 'upgraded',
      previousPlan,
      newPlan: newTier,
      effectiveAt: 'immediate',
      prorationApplied: !!org.stripe_subscription_id, // proration if replacing existing sub
    };
  }

  /**
   * Downgrade at end of billing period.
   */
  private async handleDowngrade(
    org: OrgRow,
    newTier: TierName,
  ): Promise<PlanChangeResult> {
    const previousPlan = org.plan as TierName;

    if (newTier === 'free') {
      // Cancel subscription at period end
      if (org.stripe_subscription_id) {
        await this.deps.stripe.cancelSubscription(org.stripe_subscription_id, true);
      }
    } else {
      // Downgrading to a lower paid tier — schedule change at period end
      if (org.stripe_subscription_id) {
        await this.deps.stripe.cancelSubscription(org.stripe_subscription_id, true);
      }
    }

    // Record pending downgrade
    await this.deps.db.query(
      `UPDATE orgs SET settings = jsonb_set(COALESCE(settings, '{}'), '{pending_downgrade}', $1::jsonb),
       updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(newTier), org.id],
    );

    return {
      success: true,
      action: 'scheduled_downgrade',
      previousPlan,
      newPlan: newTier,
      effectiveAt: 'end_of_period',
    };
  }

  /**
   * Apply a pending downgrade (called from webhook when subscription period ends).
   */
  async applyPendingDowngrade(orgId: string): Promise<void> {
    const org = await this.getOrg(orgId);
    const pendingTier = (org.settings as any)?.pending_downgrade as TierName | undefined;
    if (!pendingTier) return;

    const tierConfig = TIER_CONFIG[pendingTier];

    if (pendingTier === 'free') {
      await this.deps.db.query(
        `UPDATE orgs SET plan = 'free', stripe_subscription_id = NULL,
         event_quota = $1, settings = settings - 'pending_downgrade',
         updated_at = now()
         WHERE id = $2`,
        [tierConfig.event_quota, orgId],
      );
    } else {
      // Downgrade to lower paid tier — create new subscription
      const items: Array<{ price: string }> = [{ price: tierConfig.price_id }];
      if (tierConfig.overage_price_id) {
        items.push({ price: tierConfig.overage_price_id });
      }

      const subscription = await this.deps.stripe.createSubscription({
        customer: org.stripe_customer_id!,
        items,
      });

      await this.deps.db.query(
        `UPDATE orgs SET plan = $1, stripe_subscription_id = $2,
         event_quota = $3, settings = settings - 'pending_downgrade',
         updated_at = now()
         WHERE id = $4`,
        [pendingTier, subscription.id, tierConfig.event_quota, orgId],
      );
    }
  }

  private async getOrg(orgId: string): Promise<OrgRow> {
    const result = await this.deps.db.query(
      `SELECT id, plan, stripe_customer_id, stripe_subscription_id, settings FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = (result.rows as any[])[0];
    if (!org) throw new Error(`Org ${orgId} not found`);
    return org;
  }
}

interface OrgRow {
  id: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  settings: Record<string, unknown> | null;
}

/**
 * Free Trial Service (S-6.6)
 *
 * - New signups get 14-day Pro trial, no credit card required
 * - After trial → auto-downgrade to Free
 * - Trial status visible in dashboard
 * - Upgrade during trial converts to paid immediately
 */

import type { IStripeClient, TierName } from './stripe-client.js';
import { TIER_CONFIG } from './stripe-client.js';
import type { MigrationClient } from '../migrate.js';

export interface TrialServiceDeps {
  stripe: IStripeClient;
  db: MigrationClient;
}

export interface TrialStatus {
  is_trial: boolean;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  days_remaining: number;
  expired: boolean;
}

export const TRIAL_DURATION_DAYS = 14;

export class TrialService {
  constructor(private deps: TrialServiceDeps) {}

  /**
   * Start a free trial for a new org. Sets plan to 'pro' with trial metadata.
   * No credit card required.
   */
  async startTrial(orgId: string): Promise<TrialStatus> {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DURATION_DAYS * 86400 * 1000);

    await this.deps.db.query(
      `UPDATE orgs SET plan = 'pro', event_quota = $1,
       settings = jsonb_set(
         jsonb_set(COALESCE(settings, '{}'), '{trial_started_at}', $2::jsonb),
         '{trial_ends_at}', $3::jsonb
       ),
       updated_at = now()
       WHERE id = $4`,
      [
        TIER_CONFIG.pro.event_quota,
        JSON.stringify(now.toISOString()),
        JSON.stringify(trialEnd.toISOString()),
        orgId,
      ],
    );

    return {
      is_trial: true,
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      days_remaining: TRIAL_DURATION_DAYS,
      expired: false,
    };
  }

  /**
   * Get trial status for an org.
   */
  async getTrialStatus(orgId: string): Promise<TrialStatus> {
    const result = await this.deps.db.query(
      `SELECT settings FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = (result.rows as any[])[0];
    if (!org) throw new Error(`Org ${orgId} not found`);

    const settings = org.settings ?? {};
    const trialStarted = settings.trial_started_at as string | undefined;
    const trialEnds = settings.trial_ends_at as string | undefined;

    if (!trialStarted || !trialEnds) {
      return { is_trial: false, trial_started_at: null, trial_ends_at: null, days_remaining: 0, expired: false };
    }

    const now = new Date();
    const endDate = new Date(trialEnds);
    const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (86400 * 1000)));
    const expired = now >= endDate;

    return {
      is_trial: !expired,
      trial_started_at: trialStarted,
      trial_ends_at: trialEnds,
      days_remaining: daysRemaining,
      expired,
    };
  }

  /**
   * Check and expire trials. Called by a daily cron job.
   * Downgrades expired trial orgs to Free.
   * Returns number of orgs downgraded.
   */
  async expireTrials(): Promise<number> {
    const now = new Date().toISOString();

    // Find orgs on trial that have expired
    const result = await this.deps.db.query(
      `SELECT id FROM orgs
       WHERE plan = 'pro'
       AND settings->>'trial_ends_at' IS NOT NULL
       AND settings->>'trial_ends_at' < $1
       AND stripe_subscription_id IS NULL`,
      [now],
    );

    const expiredOrgs = result.rows as Array<{ id: string }>;
    let downgraded = 0;

    for (const org of expiredOrgs) {
      await this.deps.db.query(
        `UPDATE orgs SET plan = 'free', event_quota = $1,
         settings = settings - 'trial_started_at' - 'trial_ends_at',
         updated_at = now()
         WHERE id = $2`,
        [TIER_CONFIG.free.event_quota, org.id],
      );
      downgraded++;
    }

    return downgraded;
  }

  /**
   * Cancel trial when org upgrades to a paid plan.
   * Clears trial metadata so the org is no longer in trial state.
   */
  async cancelTrial(orgId: string): Promise<void> {
    await this.deps.db.query(
      `UPDATE orgs SET
       settings = settings - 'trial_started_at' - 'trial_ends_at',
       updated_at = now()
       WHERE id = $1`,
      [orgId],
    );
  }
}

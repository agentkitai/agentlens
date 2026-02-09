/**
 * Onboarding Routes (S-7.7)
 *
 * Server-side support for the onboarding wizard:
 * - Check onboarding status (has org, has key, has events)
 * - Verify first event received
 */

import type { MigrationClient } from '../migrate.js';

export interface OnboardingRoutesDeps {
  db: MigrationClient;
}

export interface OnboardingStatus {
  has_org: boolean;
  has_api_key: boolean;
  has_first_event: boolean;
  org_id: string | null;
  api_key_prefix: string | null;
}

export function createOnboardingRouteHandlers(deps: OnboardingRoutesDeps) {
  return {
    /** GET /api/cloud/onboarding/status — check onboarding progress */
    async getOnboardingStatus(
      userId: string,
    ): Promise<{ status: number; body: OnboardingStatus }> {
      // Check if user has any orgs
      const orgResult = await deps.db.query(
        `SELECT o.id FROM orgs o
         JOIN org_members om ON om.org_id = o.id
         WHERE om.user_id = $1
         ORDER BY o.created_at ASC LIMIT 1`,
        [userId],
      );
      const orgId = (orgResult.rows as any[])[0]?.id ?? null;

      if (!orgId) {
        return {
          status: 200,
          body: { has_org: false, has_api_key: false, has_first_event: false, org_id: null, api_key_prefix: null },
        };
      }

      // Check if org has API keys
      const keyResult = await deps.db.query(
        `SELECT key_prefix FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL LIMIT 1`,
        [orgId],
      );
      const keyPrefix = (keyResult.rows as any[])[0]?.key_prefix ?? null;

      if (!keyPrefix) {
        return {
          status: 200,
          body: { has_org: true, has_api_key: false, has_first_event: false, org_id: orgId, api_key_prefix: null },
        };
      }

      // Check if org has received any events
      const eventResult = await deps.db.query(
        `SELECT 1 FROM events WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );
      const hasEvent = (eventResult.rows as any[]).length > 0;

      return {
        status: 200,
        body: {
          has_org: true,
          has_api_key: true,
          has_first_event: hasEvent,
          org_id: orgId,
          api_key_prefix: keyPrefix,
        },
      };
    },

    /** POST /api/cloud/onboarding/verify — poll for first event */
    async verifyFirstEvent(
      orgId: string,
    ): Promise<{ status: number; body: { received: boolean; event_count: number } }> {
      const result = await deps.db.query(
        `SELECT COUNT(*)::int as count FROM events WHERE org_id = $1`,
        [orgId],
      );
      const count = (result.rows as any[])[0]?.count ?? 0;
      return {
        status: 200,
        body: { received: count > 0, event_count: count },
      };
    },
  };
}

/**
 * Billing Module Index (S-6.1, S-6.2, S-6.3)
 */

export {
  type IStripeClient,
  type StripeCustomer,
  type StripeSubscription,
  type StripeSubscriptionItem,
  type StripeInvoice,
  type StripeWebhookEvent,
  type CreateSubscriptionParams,
  type UsageRecordParams,
  type TierName,
  TIER_CONFIG,
  MockStripeClient,
  createStripeClient,
} from './stripe-client.js';

export { BillingService, type BillingServiceDeps, type WebhookResult } from './billing-service.js';

export {
  UsageAccumulator,
  UsageQuery,
  reportOverageToStripe,
  type UsageMeteringDeps,
  type UsageSummary,
  type RedisUsageStore,
} from './usage-metering.js';

export {
  QuotaEnforcer,
  type QuotaCheckResult,
  type QuotaEnforcerDeps,
  type OrgQuotaInfo,
} from './quota-enforcement.js';

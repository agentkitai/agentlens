/**
 * Billing Module Index (S-6.1 through S-6.6)
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

export {
  PlanManager,
  ANNUAL_PRICE_IDS,
  type PlanManagementDeps,
  type PlanChangeResult,
} from './plan-management.js';

export {
  InvoiceService,
  ANNUAL_DISCOUNT,
  calculateAnnualPrice,
  type InvoiceServiceDeps,
  type InvoiceRecord,
  type InvoiceLineItem,
} from './invoice-service.js';

export {
  TrialService,
  TRIAL_DURATION_DAYS,
  type TrialServiceDeps,
  type TrialStatus,
} from './trial-service.js';

import type { HealthWeights } from './types.js';
import { EMBEDDED_MODEL_COSTS } from '@agentkitai/pricing';

/**
 * @agentlensai/core — Shared Constants
 */

/** Default number of results per page */
export const DEFAULT_PAGE_SIZE = 50;

/** Maximum number of results per page */
export const MAX_PAGE_SIZE = 500;

/** Maximum payload size in UTF-8 bytes (10KB). Measured with Buffer.byteLength(). */
export const MAX_PAYLOAD_SIZE = 10240;

/** Default retention period in days */
export const DEFAULT_RETENTION_DAYS = 90;

// ─── Health Score Defaults ──────────────────────────────────────────

/** Default weights for health score dimensions (sum = 1.0) */
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  errorRate: 0.30,
  costEfficiency: 0.20,
  toolSuccess: 0.20,
  latency: 0.15,
  completionRate: 0.15,
};

// ─── Model Cost Defaults (per 1M tokens) ───────────────────────────
// Pricing is owned by @agentkitai/pricing (the single source of truth, seeded
// from LiteLLM). Re-exported here so existing @agentlensai/core consumers keep
// importing DEFAULT_MODEL_COSTS / lookupModelCost / costUsd unchanged.

/** Default model costs per 1M tokens (input/output). @see \@agentkitai/pricing */
export const DEFAULT_MODEL_COSTS = EMBEDDED_MODEL_COSTS;

export { lookupModelCost, costUsd, costUsdDetailed, refreshFromLiteLLM, pricingVersion, getModelCosts, setModelCosts } from '@agentkitai/pricing';
export type { UsageTokens, ModelRate, ModelCostTable } from '@agentkitai/pricing';

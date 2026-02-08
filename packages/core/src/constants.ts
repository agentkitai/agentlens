import type { HealthWeights, ModelCosts } from './types.js';

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

/** Default model costs per 1M tokens (input/output) */
export const DEFAULT_MODEL_COSTS: ModelCosts = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-3.5': { input: 0.80, output: 4.00 },
};

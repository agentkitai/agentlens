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
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  // Anthropic - match actual model IDs from API
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-haiku-3.5': { input: 0.80, output: 4.00 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
};

/**
 * Fuzzy lookup for model costs. Strips version/date suffixes to find a match.
 * e.g., 'claude-opus-4-6-20250115' → matches 'claude-opus-4-6'
 */
export function lookupModelCost(model: string, costs: ModelCosts = DEFAULT_MODEL_COSTS): { input: number; output: number } | undefined {
  // Exact match first
  if (costs[model]) return costs[model];

  // Try progressively shorter prefixes by stripping trailing -YYYYMMDD or -N segments
  const keys = Object.keys(costs);
  // Sort by length descending so longer (more specific) keys match first
  const sorted = keys.sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (model.startsWith(key)) return costs[key];
  }

  return undefined;
}

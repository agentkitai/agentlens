// @agentkit/pricing — canonical LLM model pricing.
//
// Single source of truth for token→USD pricing across the AgentKit suite,
// replacing the per-package hand-maintained tables that had already drifted in
// units and model coverage. Rates are per 1,000,000 tokens (USD), the same
// convention AgentLens already used. The embedded table below is seeded from
// LiteLLM's published prices (model_prices_and_context_window.json) and can be
// refreshed live at runtime via refreshFromLiteLLM().

/** Per-1M-token rates in USD. */
export interface ModelRate {
  input: number;
  output: number;
  /** Cached-input READ rate (Anthropic ≈ 0.1× input). Omitted → no cache discount. */
  cacheRead?: number;
  /** Cache WRITE/creation rate (Anthropic ≈ 1.25× input). Omitted → charged at input. */
  cacheWrite?: number;
}

export type ModelCostTable = Record<string, ModelRate>;

/**
 * Embedded fallback rates (per 1M tokens), seeded from LiteLLM. Generic family
 * keys (e.g. `claude-opus-4`) let the fuzzy lookup price new minor versions
 * (`claude-opus-4-8`) before LiteLLM lists them. Older per-1K keys from the
 * legacy cloud table are folded in (converted to per-1M) so nothing regresses.
 */
export const EMBEDDED_MODEL_COSTS: ModelCostTable = {
  // ─── OpenAI ───
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "o1": { input: 15.0, output: 60.0 },
  "o3": { input: 2.0, output: 8.0 },
  "o3-mini": { input: 1.1, output: 4.4 },
  // legacy (converted from per-1K)
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  // ─── Anthropic (generic family keys + current ids) ───
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-opus-4-1": { input: 15.0, output: 75.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "claude-haiku-3.5": { input: 0.8, output: 4.0 },
  // legacy Claude 3.x (converted from per-1K)
  "claude-3-opus": { input: 15.0, output: 75.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  // ─── Google ───
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

// The live table consulted by lookups; starts as the embedded fallback and is
// replaced in place by refreshFromLiteLLM(). Module-scoped (per process).
let currentTable: ModelCostTable = { ...EMBEDDED_MODEL_COSTS };

/** Replace the active pricing table (used by refreshFromLiteLLM). */
export function setModelCosts(table: ModelCostTable): void {
  currentTable = table;
}

/** The active pricing table (embedded, or the last successful LiteLLM refresh). */
export function getModelCosts(): ModelCostTable {
  return currentTable;
}

/**
 * A stable content fingerprint of a pricing table — changes iff any rate
 * changes. Stamped on cost-bearing events at ingest as pricing provenance
 * (#89), so reconciliation can tell whether a stored cost predates a price
 * change (FNV-1a over the canonical rate list; pure JS, no crypto dependency).
 */
export function pricingVersion(table: ModelCostTable = currentTable): string {
  const canonical = JSON.stringify(
    Object.keys(table)
      .sort()
      .map((k) => {
        const r = table[k]!;
        return [k, r.input, r.output, r.cacheRead ?? null, r.cacheWrite ?? null];
      }),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'pv_' + (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Look up a model's rate. Exact match first, then the longest matching prefix
 * key (so `claude-opus-4-8-20260101` resolves via `claude-opus-4`). Returns
 * undefined for genuinely unknown models.
 */
export function lookupModelCost(
  model: string,
  table: ModelCostTable = currentTable,
): ModelRate | undefined {
  if (table[model]) return table[model];
  const sorted = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (model.startsWith(key)) return table[key];
  }
  return undefined;
}

/**
 * Cost in USD for a call. Returns 0 for an unpriced model (never throws), so
 * callers that need to distinguish "unknown" from "free" should check
 * lookupModelCost first.
 */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  table: ModelCostTable = currentTable,
): number {
  const rate = lookupModelCost(model, table);
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

/** Token usage for a single call, with optional prompt-cache breakdown. */
export interface UsageTokens {
  /** Uncached input tokens (provider convention: excludes cache read/creation). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Non-negative finite token count (guards malformed/negative/NaN telemetry). */
function tok(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Per-1M cache read/write rates for a model. Explicit table rates win; otherwise
 * derived from the input rate per provider convention — Anthropic: read 0.1×,
 * write 1.25×; OpenAI: read 0.5× (no separate write charge). Unknown providers get
 * the full input rate (conservative — never under-counts) with `hasDiscount=false`
 * so we never claim savings we can't substantiate. Deriving at COMPUTE time (not
 * mutating the table) keeps rates correct after a refreshFromLiteLLM() that drops
 * them.
 */
function resolveCacheRates(model: string, rate: ModelRate): { read: number; write: number; hasDiscount: boolean } {
  if (rate.cacheRead !== undefined) {
    return { read: rate.cacheRead, write: rate.cacheWrite ?? rate.input, hasDiscount: true };
  }
  if (model.startsWith('claude')) {
    return { read: rate.input * 0.1, write: rate.input * 1.25, hasDiscount: true };
  }
  if (/^(gpt-|o1|o3|o4|chatgpt)/.test(model)) {
    return { read: rate.input * 0.5, write: rate.input, hasDiscount: true };
  }
  return { read: rate.input, write: rate.input, hasDiscount: false };
}

/**
 * Cache-aware cost. Cache read/write tokens are charged ADDITIVELY (the provider
 * convention — Anthropic/OpenAI report input_tokens excluding cache), at the
 * model's resolved cache rates. `cacheSavingsUsd` is what the cache reads WOULD
 * have cost at the full input rate minus what they actually cost — claimed only
 * when a cache discount is known for the model (else 0). Negative/NaN token counts
 * are treated as 0. Returns zeros for an unpriced model (never throws).
 */
export function costUsdDetailed(
  model: string,
  usage: UsageTokens,
  table: ModelCostTable = currentTable,
): { costUsd: number; cacheSavingsUsd: number } {
  const rate = lookupModelCost(model, table);
  if (!rate) return { costUsd: 0, cacheSavingsUsd: 0 };
  const input = tok(usage.inputTokens);
  const output = tok(usage.outputTokens);
  const cr = tok(usage.cacheReadTokens);
  const cw = tok(usage.cacheWriteTokens);
  const cache = resolveCacheRates(model, rate);
  const costUsd =
    (input * rate.input + output * rate.output + cr * cache.read + cw * cache.write) / 1_000_000;
  const cacheSavingsUsd = cache.hasDiscount ? (cr * (rate.input - cache.read)) / 1_000_000 : 0;
  return { costUsd, cacheSavingsUsd };
}

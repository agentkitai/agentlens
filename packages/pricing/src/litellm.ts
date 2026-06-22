// @agentkit/pricing — live refresh from LiteLLM's published prices.
//
// LiteLLM maintains a community-updated price list keyed by model name, with
// per-TOKEN rates. We convert to per-1M and merge over the embedded table, so a
// refresh only ever ADDS/UPDATES coverage and a fetch failure silently keeps
// the embedded fallback. Never throws; never blocks startup.

import { EMBEDDED_MODEL_COSTS, setModelCosts, type ModelCostTable } from "./models.js";

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

interface LiteLlmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

/** Convert LiteLLM's per-token map into our per-1M ModelCostTable. */
export function mapLiteLlmPrices(raw: Record<string, unknown>): ModelCostTable {
  const out: ModelCostTable = {};
  for (const [model, value] of Object.entries(raw)) {
    const e = value as LiteLlmEntry;
    const input = e?.input_cost_per_token;
    const output = e?.output_cost_per_token;
    // Skip non-priced entries (e.g. the "sample_spec" doc key, embeddings).
    if (typeof input !== "number" || typeof output !== "number") continue;
    out[model] = { input: input * 1_000_000, output: output * 1_000_000 };
  }
  return out;
}

export interface RefreshOptions {
  url?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch LiteLLM prices, merge over the embedded fallback, and install the
 * result as the active table. Returns the table actually installed — the merged
 * table on success, or the unchanged embedded fallback on any failure. Logs a
 * warning on failure; does not throw.
 */
export async function refreshFromLiteLLM(opts: RefreshOptions = {}): Promise<ModelCostTable> {
  const { url = LITELLM_PRICES_URL, timeoutMs = 5_000, fetchImpl = fetch } = opts;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, unknown>;
    // Embedded stays as the base so curated/generic family keys survive.
    const merged: ModelCostTable = { ...EMBEDDED_MODEL_COSTS, ...mapLiteLlmPrices(raw) };
    setModelCosts(merged);
    return merged;
  } catch (err) {
    console.warn(
      `[pricing] LiteLLM refresh failed, using embedded fallback: ${(err as Error).message}`,
    );
    return EMBEDDED_MODEL_COSTS;
  }
}

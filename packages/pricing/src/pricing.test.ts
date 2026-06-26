import { describe, it, expect, beforeEach } from "vitest";
import {
  EMBEDDED_MODEL_COSTS,
  lookupModelCost,
  costUsd,
  costUsdDetailed,
  getModelCosts,
  setModelCosts,
  getPricingProvenance,
} from "./models.js";
import { mapLiteLlmPrices, refreshFromLiteLLM } from "./litellm.js";

beforeEach(() => {
  setModelCosts({ ...EMBEDDED_MODEL_COSTS }, { source: "embedded", asOf: null }); // reset live table between tests
});

describe("cache-aware pricing (costUsdDetailed)", () => {
  it("charges Anthropic cache read/write additively (0.1x/1.25x input) and reports savings", () => {
    // 1M cache reads + 1M cache writes on claude-haiku-4-5 (input 0.8).
    const { costUsd: c, cacheSavingsUsd: saved } = costUsdDetailed("claude-haiku-4-5", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000,
    });
    expect(c).toBeCloseTo(0.08 + 1.0, 6); // read (0.1×0.8) + write (1.25×0.8)
    expect(saved).toBeCloseTo(0.8 - 0.08, 6); // reads at full input − actual cache-read cost
  });

  it("derives the discount at compute time, so it SURVIVES a LiteLLM refresh", () => {
    // Refresh replaces the table with input/output-only rows (no cache fields).
    setModelCosts(mapLiteLlmPrices({
      "claude-haiku-4-5": { input_cost_per_token: 0.0000008, output_cost_per_token: 0.000004 },
    }));
    const { costUsd: c, cacheSavingsUsd: saved } = costUsdDetailed("claude-haiku-4-5", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000,
    });
    expect(c).toBeCloseTo(0.08, 6); // still discounted, not 0.8
    expect(saved).toBeCloseTo(0.72, 6);
  });

  it("applies OpenAI cache-read discount (0.5x input)", () => {
    const { costUsd: c, cacheSavingsUsd: saved } = costUsdDetailed("gpt-4o", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000,
    });
    expect(c).toBeCloseTo(1.25, 6); // 0.5 × 2.5
    expect(saved).toBeCloseTo(1.25, 6);
  });

  it("charges unknown providers at full input rate with NO savings claimed", () => {
    const { costUsd: c, cacheSavingsUsd: saved } = costUsdDetailed("gemini-2.5-pro", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000,
    });
    expect(c).toBeCloseTo(1.25, 6); // gemini input rate, no discount
    expect(saved).toBe(0);
  });

  it("treats negative / NaN token counts as zero (malformed telemetry)", () => {
    const r = costUsdDetailed("claude-haiku-4-5", {
      inputTokens: -100, outputTokens: NaN, cacheReadTokens: -5, cacheWriteTokens: Infinity,
    });
    expect(r.costUsd).toBe(0);
    expect(r.cacheSavingsUsd).toBe(0);
  });

  it("returns zeros for an unpriced model", () => {
    expect(costUsdDetailed("who-knows-x", { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100 }))
      .toEqual({ costUsd: 0, cacheSavingsUsd: 0 });
  });
});

describe("lookupModelCost", () => {
  it("matches exact model ids", () => {
    expect(lookupModelCost("gpt-4o")).toEqual({ input: 2.5, output: 10.0 });
  });

  it("fuzzy-matches versioned ids via the longest family prefix", () => {
    // claude-opus-4-8 is not an explicit key, but claude-opus-4 is.
    expect(lookupModelCost("claude-opus-4-8")).toEqual({ input: 15.0, output: 75.0 });
    expect(lookupModelCost("claude-opus-4-8-20260101")).toEqual({ input: 15.0, output: 75.0 });
    // claude-opus-4-6 has its own explicit key (longer prefix wins, same value).
    expect(lookupModelCost("claude-sonnet-4-6-20250115")).toEqual({ input: 3.0, output: 15.0 });
  });

  it("returns undefined for genuinely unknown models", () => {
    expect(lookupModelCost("totally-made-up-model")).toBeUndefined();
  });

  it("covers models the legacy hand tables missed (gpt-5, o1)", () => {
    expect(lookupModelCost("gpt-5")).toBeDefined();
    expect(lookupModelCost("o1")).toBeDefined();
  });
});

describe("costUsd", () => {
  it("prices per 1M tokens", () => {
    // 1M in + 1M out on claude-opus-4 = 15 + 75
    expect(costUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(90.0, 6);
    expect(costUsd("gpt-4o", 500_000, 250_000)).toBeCloseTo(2.5 * 0.5 + 10 * 0.25, 6);
  });

  it("returns 0 for an unpriced model (never throws)", () => {
    expect(costUsd("nope", 1000, 1000)).toBe(0);
  });
});

describe("mapLiteLlmPrices", () => {
  it("converts per-token rates to per-1M and skips unpriced entries", () => {
    const mapped = mapLiteLlmPrices({
      "claude-opus-4-20250514": { input_cost_per_token: 0.000015, output_cost_per_token: 0.000075 },
      "text-embedding-3-small": { input_cost_per_token: 0.00000002 }, // no output → skipped
      sample_spec: { note: "doc" },
    });
    expect(mapped["claude-opus-4-20250514"]).toEqual({ input: 15, output: 75 });
    expect(mapped["text-embedding-3-small"]).toBeUndefined();
    expect(mapped["sample_spec"]).toBeUndefined();
  });
});

describe("refreshFromLiteLLM", () => {
  const fakeFetch = (body: unknown, ok = true): typeof fetch =>
    (async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response) as unknown as typeof fetch;

  it("merges fetched prices over the embedded table and installs them", async () => {
    const table = await refreshFromLiteLLM({
      fetchImpl: fakeFetch({
        "brand-new-model": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
      }),
    });
    expect(table["brand-new-model"]).toEqual({ input: 1, output: 2 });
    expect(table["gpt-4o"]).toEqual({ input: 2.5, output: 10 }); // embedded survives
    expect(getModelCosts()["brand-new-model"]).toBeDefined(); // installed as active
  });

  it("falls back to the embedded table on fetch failure (no throw)", async () => {
    const table = await refreshFromLiteLLM({ fetchImpl: fakeFetch({}, false) });
    expect(table).toBe(EMBEDDED_MODEL_COSTS);
    // active table unchanged → known model still priced
    expect(lookupModelCost("gpt-4o")).toBeDefined();
  });

  it("stamps provenance: source=litellm + an asOf date after a refresh (#100)", async () => {
    await refreshFromLiteLLM({
      fetchImpl: fakeFetch({ "x-model": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } }),
    });
    const p = getPricingProvenance();
    expect(p.source).toBe("litellm");
    expect(p.asOf).toBeTruthy();
    expect(() => new Date(p.asOf as string).toISOString()).not.toThrow();
  });
});

describe("pricing provenance (#100)", () => {
  it("reports embedded source, null date, version + model count", () => {
    setModelCosts({ ...EMBEDDED_MODEL_COSTS }, { source: "embedded", asOf: null });
    const p = getPricingProvenance();
    expect(p.source).toBe("embedded");
    expect(p.asOf).toBeNull();
    expect(p.version).toMatch(/^pv_/);
    expect(p.modelCount).toBe(Object.keys(EMBEDDED_MODEL_COSTS).length);
  });

  it("records a custom override (dated) and defaults to custom when omitted", () => {
    setModelCosts({ "only-model": { input: 1, output: 2 } }, { source: "custom", asOf: "2026-06-01T00:00:00Z" });
    let p = getPricingProvenance();
    expect(p.source).toBe("custom");
    expect(p.asOf).toBe("2026-06-01T00:00:00Z");
    expect(p.modelCount).toBe(1);

    setModelCosts({ "a": { input: 1, output: 1 } }); // no provenance → custom, no date
    p = getPricingProvenance();
    expect(p.source).toBe("custom");
    expect(p.asOf).toBeNull();
  });

  it("version changes when a rate changes", () => {
    setModelCosts({ "m": { input: 1, output: 2 } }, { source: "custom" });
    const v1 = getPricingProvenance().version;
    setModelCosts({ "m": { input: 9, output: 2 } }, { source: "custom" });
    expect(getPricingProvenance().version).not.toBe(v1);
  });
});

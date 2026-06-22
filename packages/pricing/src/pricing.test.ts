import { describe, it, expect, beforeEach } from "vitest";
import {
  EMBEDDED_MODEL_COSTS,
  lookupModelCost,
  costUsd,
  getModelCosts,
  setModelCosts,
} from "./models.js";
import { mapLiteLlmPrices, refreshFromLiteLLM } from "./litellm.js";

beforeEach(() => {
  setModelCosts({ ...EMBEDDED_MODEL_COSTS }); // reset live table between tests
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
});

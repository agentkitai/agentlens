import { describe, it, expect } from 'vitest';

import { otelCostUsd } from '../routes/otlp.js';

describe('otelCostUsd — cost attribution for OTel-ingested GenAI spans', () => {
  it('reconstructs cost from per-1M-token model rates', () => {
    // gpt-4o: $2.50 / 1M input, $10.00 / 1M output
    const cost = otelCostUsd('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.5, 6);
  });

  it('matches fuzzy model ids (version/date suffixes stripped)', () => {
    const cost = otelCostUsd('gpt-4o-2024-08-06', 2_000_000, 0);
    expect(cost).toBeCloseTo(5.0, 6); // 2M input * $2.50/1M
  });

  it('returns 0 for unknown models instead of throwing', () => {
    expect(otelCostUsd('unknown', 1000, 1000)).toBe(0);
    expect(otelCostUsd('some-local-llama', 500, 500)).toBe(0);
  });
});

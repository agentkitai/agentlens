/**
 * Tests for Scorers (Feature 15 — Story 4)
 */

import { describe, it, expect } from 'vitest';
import type { EvalTestCase, ScorerConfig } from '@agentlensai/core';
import { ExactMatchScorer } from '../scorers/exact-match.js';
import { ContainsScorer } from '../scorers/contains.js';
import { RegexScorer } from '../scorers/regex.js';
import { ScorerRegistry } from '../scorers/index.js';

function makeTestCase(overrides: Partial<EvalTestCase> = {}): EvalTestCase {
  return {
    id: 'tc-1',
    datasetId: 'ds-1',
    tenantId: 't1',
    input: { prompt: 'test' },
    expectedOutput: 'expected answer',
    tags: [],
    metadata: {},
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── ExactMatchScorer ──────────────────────────────────────

describe('ExactMatchScorer', () => {
  const scorer = new ExactMatchScorer();

  it('returns 1.0 on exact match', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'hello' }),
      actualOutput: 'hello',
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('returns 0.0 on mismatch', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'hello' }),
      actualOutput: 'world',
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(0.0);
    expect(result.passed).toBe(false);
  });

  it('respects caseSensitive=false', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'Hello' }),
      actualOutput: 'hello',
      config: { type: 'exact_match', caseSensitive: false },
    });
    expect(result.score).toBe(1.0);
  });

  it('is case sensitive by default', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'Hello' }),
      actualOutput: 'hello',
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(0.0);
  });

  it('handles null expectedOutput', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: undefined }),
      actualOutput: 'something',
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('No expected output');
  });

  it('handles non-string values', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: { key: 'value' } }),
      actualOutput: { key: 'value' },
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(1.0);
  });
});

// ─── ContainsScorer ────────────────────────────────────────

describe('ContainsScorer', () => {
  const scorer = new ContainsScorer();

  it('returns 1.0 when output contains expected', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'hello' }),
      actualOutput: 'say hello world',
      config: { type: 'contains' },
    });
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('returns 0.0 when output does not contain expected', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'hello' }),
      actualOutput: 'goodbye world',
      config: { type: 'contains' },
    });
    expect(result.score).toBe(0.0);
  });

  it('case insensitive when configured', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: 'Hello' }),
      actualOutput: 'say hello',
      config: { type: 'contains', caseSensitive: false },
    });
    expect(result.score).toBe(1.0);
  });

  it('handles null expectedOutput', async () => {
    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: null }),
      actualOutput: 'something',
      config: { type: 'contains' },
    });
    expect(result.score).toBe(0);
  });
});

// ─── RegexScorer ───────────────────────────────────────────

describe('RegexScorer', () => {
  const scorer = new RegexScorer();

  it('returns 1.0 on regex match', async () => {
    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: 'answer is 42',
      config: { type: 'regex', pattern: '\\d+' },
    });
    expect(result.score).toBe(1.0);
  });

  it('returns 0.0 on no match', async () => {
    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: 'no numbers here',
      config: { type: 'regex', pattern: '^\\d+$' },
    });
    expect(result.score).toBe(0.0);
  });

  it('throws on invalid regex', async () => {
    await expect(
      scorer.score({
        testCase: makeTestCase(),
        actualOutput: 'test',
        config: { type: 'regex', pattern: '[invalid' },
      }),
    ).rejects.toThrow('Invalid regex');
  });

  it('throws when no pattern provided', async () => {
    await expect(
      scorer.score({
        testCase: makeTestCase(),
        actualOutput: 'test',
        config: { type: 'regex' },
      }),
    ).rejects.toThrow('pattern');
  });

  it('supports case insensitive flag', async () => {
    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: 'HELLO',
      config: { type: 'regex', pattern: 'hello', caseSensitive: false },
    });
    expect(result.score).toBe(1.0);
  });
});

// ─── ScorerRegistry ────────────────────────────────────────

describe('ScorerRegistry', () => {
  it('dispatches to registered scorer', async () => {
    const registry = new ScorerRegistry();
    registry.register(new ExactMatchScorer());

    const result = await registry.score({
      testCase: makeTestCase({ expectedOutput: 'yes' }),
      actualOutput: 'yes',
      config: { type: 'exact_match' },
    });
    expect(result.score).toBe(1.0);
  });

  it('throws for unknown scorer type', async () => {
    const registry = new ScorerRegistry();
    await expect(
      registry.score({
        testCase: makeTestCase(),
        actualOutput: 'x',
        config: { type: 'custom' },
      }),
    ).rejects.toThrow('Unknown scorer type');
  });
});

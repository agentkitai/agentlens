import { describe, it, expect } from 'vitest';
import { computeRegression } from '../regression.js';
import type { EvalRun, EvalResult } from '@agentkitai/agentlens-core';

function run(o: Partial<EvalRun> & { id: string }): EvalRun {
  return {
    tenantId: 't1',
    datasetId: 'ds1',
    datasetVersion: 1,
    agentId: 'a1',
    webhookUrl: 'http://x',
    status: 'completed',
    config: { scorers: [], passThreshold: 0.7, concurrency: 1 },
    totalCases: 0,
    passedCases: 0,
    failedCases: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...o,
  };
}

function result(testCaseId: string, passed: boolean, score: number): EvalResult {
  return {
    id: `r_${testCaseId}_${passed ? 'p' : 'f'}`,
    runId: 'run',
    testCaseId,
    tenantId: 't1',
    score,
    passed,
    scorerType: 'exact_match',
    scorerDetails: { score, passed, scorerType: 'exact_match' },
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('computeRegression', () => {
  it('reports no regression for identical runs', () => {
    const base = run({ id: 'b', totalCases: 2, passedCases: 2, avgScore: 1 });
    const cur = run({ id: 'c', totalCases: 2, passedCases: 2, avgScore: 1 });
    const rb = [result('1', true, 1), result('2', true, 1)];
    const rc = [result('1', true, 1), result('2', true, 1)];
    const rep = computeRegression(base, cur, rb, rc);
    expect(rep.flippedCases).toHaveLength(0);
    expect(rep.passRateDelta).toBe(0);
    expect(rep.avgScoreDelta).toBe(0);
    expect(rep.overallRegression).toBe(false);
    expect(rep.datasetVersionMismatch).toBe(false);
  });

  it('flags a pass→fail flip as a regression', () => {
    const base = run({ id: 'b', totalCases: 2, passedCases: 2, avgScore: 1 });
    const cur = run({ id: 'c', totalCases: 2, passedCases: 1, avgScore: 0.5 });
    const rb = [result('1', true, 1), result('2', true, 1)];
    const rc = [result('1', true, 1), result('2', false, 0)];
    const rep = computeRegression(base, cur, rb, rc);
    expect(rep.flippedCases).toEqual([{ testCaseId: '2', direction: 'pass_to_fail', baselineScore: 1, currentScore: 0 }]);
    expect(rep.passRateDelta).toBeCloseTo(-0.5);
    expect(rep.avgScoreDelta).toBeCloseTo(-0.5);
    expect(rep.overallRegression).toBe(true);
  });

  it('treats a fail→pass flip as improvement, not regression', () => {
    const base = run({ id: 'b', totalCases: 2, passedCases: 1, avgScore: 0.5 });
    const cur = run({ id: 'c', totalCases: 2, passedCases: 2, avgScore: 1 });
    const rb = [result('1', true, 1), result('2', false, 0)];
    const rc = [result('1', true, 1), result('2', true, 1)];
    const rep = computeRegression(base, cur, rb, rc);
    expect(rep.flippedCases).toEqual([{ testCaseId: '2', direction: 'fail_to_pass', baselineScore: 0, currentScore: 1 }]);
    expect(rep.passRateDelta).toBeCloseTo(0.5);
    expect(rep.overallRegression).toBe(false);
  });

  it('respects tolerance for small drops and allowed flips', () => {
    const base = run({ id: 'b', totalCases: 2, passedCases: 2, avgScore: 1 });
    const cur = run({ id: 'c', totalCases: 2, passedCases: 1, avgScore: 0.9 });
    const rb = [result('1', true, 1), result('2', true, 1)];
    const rc = [result('1', true, 1), result('2', false, 0.8)];
    // 1 pass→fail flip + a 0.1 score drop — both within tolerance.
    expect(computeRegression(base, cur, rb, rc, { maxFlips: 1, maxScoreDrop: 0.2 }).overallRegression).toBe(false);
    // Default tolerance (0/0) → regression.
    expect(computeRegression(base, cur, rb, rc).overallRegression).toBe(true);
  });

  it('flags a dataset version mismatch', () => {
    const base = run({ id: 'b', datasetVersion: 1, totalCases: 1, passedCases: 1, avgScore: 1 });
    const cur = run({ id: 'c', datasetVersion: 2, totalCases: 1, passedCases: 1, avgScore: 1 });
    const rep = computeRegression(base, cur, [result('1', true, 1)], [result('1', true, 1)]);
    expect(rep.datasetVersionMismatch).toBe(true);
  });

  it('ignores cases absent from the baseline (no phantom flips)', () => {
    const base = run({ id: 'b', totalCases: 1, passedCases: 1, avgScore: 1 });
    const cur = run({ id: 'c', totalCases: 2, passedCases: 1, avgScore: 1 });
    const rb = [result('1', true, 1)];
    const rc = [result('1', true, 1), result('2', false, 0)]; // '2' is new
    const rep = computeRegression(base, cur, rb, rc);
    expect(rep.flippedCases).toHaveLength(0);
    expect(rep.overallRegression).toBe(false);
  });
});

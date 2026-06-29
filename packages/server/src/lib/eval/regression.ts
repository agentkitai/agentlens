/**
 * Dataset-run regression comparison (#121).
 *
 * Pure function: given a baseline and a current run (+ their per-case results),
 * compute pass-rate / avg-score deltas, the set of cases that flipped
 * (pass↔fail), and an overall regression verdict against a configurable
 * tolerance. Comparing across different dataset versions is FLAGGED
 * (`datasetVersionMismatch`) rather than silently treated as comparable.
 *
 * Statistical significance is out of scope for this epic — `passRateSignificant`
 * / `avgScoreSignificant` stay false; the verdict is the deterministic
 * delta + flips.
 */
import type { EvalRun, EvalResult, RegressionReport, FlippedCase } from '@agentkitai/agentlens-core';

export interface RegressionTolerance {
  /** Max allowed avg-score drop before it counts as a regression (default 0). */
  maxScoreDrop?: number;
  /** Max allowed pass→fail flips before it counts as a regression (default 0). */
  maxFlips?: number;
}

function passRate(run: EvalRun): number {
  return run.totalCases > 0 ? run.passedCases / run.totalCases : 0;
}

export function computeRegression(
  baselineRun: EvalRun,
  currentRun: EvalRun,
  baselineResults: EvalResult[],
  currentResults: EvalResult[],
  tolerance: RegressionTolerance = {},
): RegressionReport {
  const passRateDelta = passRate(currentRun) - passRate(baselineRun);
  const avgScoreDelta = (currentRun.avgScore ?? 0) - (baselineRun.avgScore ?? 0);

  const baseByCase = new Map(baselineResults.map((r) => [r.testCaseId, r]));
  const flippedCases: FlippedCase[] = [];
  for (const cur of currentResults) {
    const base = baseByCase.get(cur.testCaseId);
    if (!base) continue; // case absent from baseline ⇒ not a flip
    if (base.passed && !cur.passed) {
      flippedCases.push({ testCaseId: cur.testCaseId, direction: 'pass_to_fail', baselineScore: base.score, currentScore: cur.score });
    } else if (!base.passed && cur.passed) {
      flippedCases.push({ testCaseId: cur.testCaseId, direction: 'fail_to_pass', baselineScore: base.score, currentScore: cur.score });
    }
  }
  // Stable ordering: regressions (pass→fail) first, then by test-case id.
  flippedCases.sort((a, b) =>
    a.direction !== b.direction
      ? a.direction === 'pass_to_fail'
        ? -1
        : 1
      : a.testCaseId < b.testCaseId
        ? -1
        : a.testCaseId > b.testCaseId
          ? 1
          : 0,
  );

  const maxScoreDrop = tolerance.maxScoreDrop ?? 0;
  const maxFlips = tolerance.maxFlips ?? 0;
  const passToFail = flippedCases.filter((f) => f.direction === 'pass_to_fail').length;
  const overallRegression = -avgScoreDelta > maxScoreDrop || passToFail > maxFlips;

  return {
    currentRunId: currentRun.id,
    baselineRunId: baselineRun.id,
    passRateDelta,
    avgScoreDelta,
    passRateSignificant: false,
    avgScoreSignificant: false,
    flippedCases,
    overallRegression,
    datasetVersionMismatch:
      baselineRun.datasetId !== currentRun.datasetId || baselineRun.datasetVersion !== currentRun.datasetVersion,
  };
}

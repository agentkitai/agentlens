/**
 * agenteval run → eval_result (#55 — the agenteval→lens federation).
 *
 * agenteval (the external Python eval framework) runs a suite against an agent and
 * reports the aggregate result here. We record it as a server-authoritative
 * eval_result chained into a session's tamper-evident audit trail — so a team can
 * prove "agenteval suite X scored Y on this date, here's the cryptographic record."
 *
 * agenteval cannot POST eval_result directly (it's excluded from the client ingest
 * enum so evidence can't be forged); this server-side builder + the service-token
 * internal route are the only path in. Failed cases become violations so the
 * single run-level event still carries per-case detail.
 */

import type { EvalResultPayload, EvalRunRequest } from '@agentkitai/agentlens-core';

export function buildAgentEvalResult(run: EvalRunRequest['run']): EvalResultPayload {
  const { summary } = run;

  const violations: NonNullable<EvalResultPayload['violations']> = (run.failedCases ?? []).map((c) => ({
    ruleId: c.name,
    ruleType: 'eval_case',
    detail:
      c.detail ?? (typeof c.score === 'number' ? `case failed (score ${c.score.toFixed(2)})` : 'case failed'),
  }));

  const costSuffix =
    typeof summary.totalCostUsd === 'number' ? `, cost $${summary.totalCostUsd.toFixed(4)}` : '';

  return {
    scorerType: 'agenteval',
    method: run.method ?? 'deterministic',
    score: summary.passRate,
    // The run is a pass only if no case failed — the gate of record, not the score.
    passed: summary.failed === 0,
    violations,
    rulesEvaluated: summary.total,
    evalRunId: run.id,
    reasoning:
      `agenteval suite "${run.suite}": ${summary.passed}/${summary.total} cases passed ` +
      `(pass rate ${(summary.passRate * 100).toFixed(0)}%)${costSuffix}.`,
  };
}

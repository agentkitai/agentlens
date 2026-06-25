/**
 * Guardrail-breach → compliance eval_result (#55 — the gate→lens wedge).
 *
 * When AgentGate denies an action (MCP tool-call hard-deny, reactive metric
 * breach, …), it reports the breach here. We record it as a DETERMINISTIC
 * compliance result chained into the session's tamper-evident audit trail — so a
 * tenant can prove "the gate enforced policy X, here's the cryptographic record."
 *
 * The gate's decision is authoritative, so the breach is always recorded as a
 * violation. We additionally run the Phase-1 deterministic compliance scorer with
 * a denylist rule derived from the denied tool, which catches any recorded
 * attempts of that tool already present in the session timeline.
 */

import { evaluateCompliance } from './compliance.js';
import type { AgentLensEvent, ComplianceRule, EvalResultPayload } from '@agentlensai/core';

export interface GuardrailBreach {
  ruleId: string;
  ruleType?: string;
  tool?: string;
  description?: string;
  reason?: string;
  source: string;
}

export function buildBreachEvalResult(
  timeline: AgentLensEvent[],
  breach: GuardrailBreach,
): EvalResultPayload {
  const violations: NonNullable<EvalResultPayload['violations']> = [];
  let rulesEvaluated = 1;

  if (breach.tool) {
    const rule: ComplianceRule = {
      id: breach.ruleId,
      type: 'tool_denylist',
      tools: [breach.tool],
      description: breach.description,
    };
    const result = evaluateCompliance(timeline, [rule]);
    rulesEvaluated = result.rulesEvaluated;
    violations.push(...result.violations);
  }

  // The gate's denial is authoritative — record it even if the blocked call never
  // reached the session timeline (a hard-deny may stop it before any event).
  if (!violations.some((v) => v.ruleId === breach.ruleId)) {
    violations.push({
      ruleId: breach.ruleId,
      ruleType: breach.ruleType ?? 'tool_denylist',
      description: breach.description,
      detail: breach.reason ?? `AgentGate denied "${breach.tool ?? 'action'}"`,
    });
  }

  return {
    scorerType: 'compliance',
    method: 'deterministic',
    score: 0, // a breach is, by definition, a compliance failure
    passed: false,
    violations,
    rulesEvaluated,
    reasoning: `AgentGate guardrail breach recorded (source: ${breach.source}).`,
  };
}

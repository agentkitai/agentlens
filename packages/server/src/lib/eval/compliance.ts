/**
 * Deterministic compliance evaluation (Feature 15 / #55 — Phase 1).
 *
 * Scores a session's events against policy rules with NO LLM dependency, so the
 * result is provable and reproducible — exactly what makes it audit evidence.
 * (The `llm_judge` scorer covers rubric-style judgment separately.)
 */

import type { AgentLensEvent, ComplianceRule, ComplianceViolation } from '@agentlensai/core';

const SEVERITY_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, critical: 4 };

export interface ComplianceEvalResult {
  /** Fraction of rules satisfied, in [0, 1] */
  score: number;
  /** True when no rule was violated */
  passed: boolean;
  violations: ComplianceViolation[];
  rulesEvaluated: number;
  reasoning: string;
}

/** Match a tool name against a pattern supporting `*` wildcards (e.g. `delete_*`). */
export function matchTool(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (!pattern.includes('*')) return false;
  const rx = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return rx.test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toolNamesFrom(events: AgentLensEvent[]): string[] {
  const names: string[] = [];
  for (const e of events) {
    if (e.eventType !== 'tool_call') continue;
    const tn = (e.payload as { toolName?: unknown }).toolName;
    if (typeof tn === 'string') names.push(tn);
  }
  return names;
}

function sessionCostUsd(events: AgentLensEvent[]): number {
  // ponytail: sum ONE source to avoid double-counting — prefer explicit
  // cost_tracked events; fall back to llm_response costs only if none exist.
  let costTracked = 0;
  let sawCostTracked = false;
  let llmCost = 0;
  for (const e of events) {
    const c = (e.payload as { costUsd?: unknown }).costUsd;
    // Ignore non-numeric and negative costs: a negative cost could otherwise
    // shrink the total below a max_cost cap and evade it (budget evasion).
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) continue;
    if (e.eventType === 'cost_tracked') { costTracked += c; sawCostTracked = true; }
    else if (e.eventType === 'llm_response') { llmCost += c; }
  }
  return sawCostTracked ? costTracked : llmCost;
}

/**
 * Evaluate `events` against `rules`. Each rule yields at most one violation.
 */
export function evaluateCompliance(events: AgentLensEvent[], rules: ComplianceRule[]): ComplianceEvalResult {
  const violations: ComplianceViolation[] = [];

  for (const rule of rules) {
    switch (rule.type) {
      case 'tool_denylist': {
        const hits = [...new Set(toolNamesFrom(events).filter((n) => rule.tools.some((p) => matchTool(p, n))))];
        if (hits.length > 0) {
          violations.push(v(rule, `denied tool(s) called: ${hits.join(', ')}`));
        }
        break;
      }
      case 'tool_allowlist': {
        const bad = [...new Set(toolNamesFrom(events).filter((n) => !rule.tools.some((p) => matchTool(p, n))))];
        if (bad.length > 0) {
          violations.push(v(rule, `tool(s) outside allowlist called: ${bad.join(', ')}`));
        }
        break;
      }
      case 'max_cost': {
        const cost = sessionCostUsd(events);
        if (cost > rule.maxUsd) {
          violations.push(v(rule, `session cost $${cost.toFixed(4)} exceeds max $${rule.maxUsd.toFixed(4)}`));
        }
        break;
      }
      case 'no_severity_above': {
        const limit = SEVERITY_RANK[rule.severity] ?? 4;
        const offending = events.filter((e) => (SEVERITY_RANK[e.severity] ?? 0) > limit);
        if (offending.length > 0) {
          const worst = offending.reduce((a, b) =>
            (SEVERITY_RANK[b.severity] ?? 0) > (SEVERITY_RANK[a.severity] ?? 0) ? b : a);
          violations.push(v(rule, `${offending.length} event(s) above '${rule.severity}' (worst: '${worst.severity}')`));
        }
        break;
      }
    }
  }

  const rulesEvaluated = rules.length;
  const violatedRuleIds = new Set(violations.map((vv) => vv.ruleId));
  const score = rulesEvaluated === 0 ? 1 : (rulesEvaluated - violatedRuleIds.size) / rulesEvaluated;
  const passed = violations.length === 0;
  const reasoning = passed
    ? `All ${rulesEvaluated} compliance rule(s) satisfied`
    : `${violatedRuleIds.size}/${rulesEvaluated} rule(s) violated: ${[...violatedRuleIds].join(', ')}`;

  return { score, passed, violations, rulesEvaluated, reasoning };
}

function v(rule: ComplianceRule, detail: string): ComplianceViolation {
  return { ruleId: rule.id, ruleType: rule.type, description: rule.description, detail };
}

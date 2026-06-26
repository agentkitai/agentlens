/**
 * Compliance evaluation tests (#55 — Phase 1).
 */
import { describe, it, expect } from 'vitest';
import type { AgentLensEvent, ComplianceRule } from '@agentkitai/agentlens-core';
import { evaluateCompliance, matchTool } from '../compliance.js';

function ev(partial: Partial<AgentLensEvent> & { eventType: string }): AgentLensEvent {
  return {
    id: partial.id ?? 'e',
    timestamp: partial.timestamp ?? '2026-01-01T00:00:00.000Z',
    sessionId: 'sess',
    agentId: 'agent',
    eventType: partial.eventType as AgentLensEvent['eventType'],
    severity: partial.severity ?? 'info',
    payload: partial.payload ?? {},
    metadata: {},
    prevHash: null,
    hash: 'h',
    tenantId: 'default',
  } as AgentLensEvent;
}

const toolCall = (name: string) => ev({ eventType: 'tool_call', payload: { toolName: name, callId: 'c', arguments: {} } });

describe('matchTool', () => {
  it('matches exact and wildcard patterns', () => {
    expect(matchTool('delete_file', 'delete_file')).toBe(true);
    expect(matchTool('delete_*', 'delete_file')).toBe(true);
    expect(matchTool('delete_*', 'read_file')).toBe(false);
    expect(matchTool('*_admin', 'grant_admin')).toBe(true);
    expect(matchTool('*', 'anything')).toBe(true);
    expect(matchTool('exact', 'other')).toBe(false);
  });
});

describe('evaluateCompliance', () => {
  it('flags denylisted tools (wildcard) and passes clean sessions', () => {
    const rule: ComplianceRule = { id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] };
    const bad = evaluateCompliance([toolCall('search'), toolCall('delete_db')], [rule]);
    expect(bad.passed).toBe(false);
    expect(bad.violations[0].ruleId).toBe('no_delete');
    expect(bad.violations[0].detail).toContain('delete_db');

    const good = evaluateCompliance([toolCall('search'), toolCall('read_file')], [rule]);
    expect(good.passed).toBe(true);
    expect(good.score).toBe(1);
  });

  it('flags tools outside an allowlist', () => {
    const rule: ComplianceRule = { id: 'allow', type: 'tool_allowlist', tools: ['search', 'read_*'] };
    const r = evaluateCompliance([toolCall('search'), toolCall('write_file')], [rule]);
    expect(r.passed).toBe(false);
    expect(r.violations[0].detail).toContain('write_file');
  });

  it('enforces max cost from cost_tracked, falling back to llm_response', () => {
    const rule: ComplianceRule = { id: 'budget', type: 'max_cost', maxUsd: 1.0 };

    const tracked = [ev({ eventType: 'cost_tracked', payload: { costUsd: 1.5 } })];
    expect(evaluateCompliance(tracked, [rule]).passed).toBe(false);

    // No cost_tracked → fall back to summing llm_response costs.
    const llm = [
      ev({ eventType: 'llm_response', payload: { costUsd: 0.6 } }),
      ev({ eventType: 'llm_response', payload: { costUsd: 0.6 } }),
    ];
    expect(evaluateCompliance(llm, [rule]).passed).toBe(false);

    // cost_tracked present → llm_response is NOT also counted (no double-count).
    const mixed = [
      ev({ eventType: 'cost_tracked', payload: { costUsd: 0.5 } }),
      ev({ eventType: 'llm_response', payload: { costUsd: 5.0 } }),
    ];
    expect(evaluateCompliance(mixed, [rule]).passed).toBe(true);

    // Negative costs are ignored, so a refund/negative can't shrink the total
    // below the cap to evade it.
    const evasion = [
      ev({ eventType: 'cost_tracked', payload: { costUsd: 5.0 } }),
      ev({ eventType: 'cost_tracked', payload: { costUsd: -4.5 } }),
    ];
    expect(evaluateCompliance(evasion, [rule]).passed).toBe(false);
  });

  it('flags events above a severity ceiling', () => {
    const rule: ComplianceRule = { id: 'no_errors', type: 'no_severity_above', severity: 'warn' };
    const r = evaluateCompliance([ev({ eventType: 'error', severity: 'critical' })], [rule]);
    expect(r.passed).toBe(false);
    expect(r.violations[0].detail).toContain('critical');

    const ok = evaluateCompliance([ev({ eventType: 'tool_call', severity: 'warn' })], [rule]);
    expect(ok.passed).toBe(true);
  });

  it('scores the fraction of rules satisfied across multiple rules', () => {
    const rules: ComplianceRule[] = [
      { id: 'r1', type: 'tool_denylist', tools: ['delete_*'] }, // violated
      { id: 'r2', type: 'max_cost', maxUsd: 10 },               // satisfied
    ];
    const r = evaluateCompliance([toolCall('delete_x'), ev({ eventType: 'cost_tracked', payload: { costUsd: 1 } })], rules);
    expect(r.rulesEvaluated).toBe(2);
    expect(r.violations).toHaveLength(1);
    expect(r.score).toBe(0.5);
  });

  it('treats an empty rule set as trivially passing', () => {
    const r = evaluateCompliance([toolCall('anything')], []);
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });
});

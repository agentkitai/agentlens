/**
 * buildBreachEvalResult — gate→lens wedge (#55).
 */
import { describe, it, expect } from 'vitest';
import type { AgentLensEvent } from '@agentkitai/agentlens-core';
import { buildBreachEvalResult } from '../guardrail-breach.js';

function toolCall(toolName: string): AgentLensEvent {
  return {
    id: `e-${toolName}`,
    timestamp: '2026-01-01T00:00:01.000Z',
    sessionId: 's1',
    agentId: 'agt_a',
    eventType: 'tool_call',
    severity: 'info',
    payload: { toolName, callId: 'c1', arguments: {} },
    metadata: {},
    prevHash: null,
    hash: 'h',
    tenantId: 'default',
  } as AgentLensEvent;
}

describe('buildBreachEvalResult', () => {
  it('always records the gate breach as a failing violation', () => {
    const r = buildBreachEvalResult([], { ruleId: 'no_delete', tool: 'delete_db', source: 'mcp_guardrail' });
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.method).toBe('deterministic');
    expect(r.scorerType).toBe('compliance');
    expect(r.violations).toHaveLength(1);
    expect(r.violations![0].ruleId).toBe('no_delete');
  });

  it('does not double-count when the denied tool is also present in the timeline', () => {
    // evaluateCompliance flags the recorded delete_db call under the same ruleId;
    // the authoritative breach must not be added a second time.
    const r = buildBreachEvalResult([toolCall('delete_db')], {
      ruleId: 'no_delete',
      tool: 'delete_db',
      source: 'mcp_guardrail',
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations![0].ruleId).toBe('no_delete');
  });

  it('falls back to a generic detail when neither tool nor reason is given', () => {
    const r = buildBreachEvalResult([], { ruleId: 'mystery', source: 'reactive_guardrail' });
    expect(r.violations).toHaveLength(1);
    expect(r.violations![0].detail).toContain('action');
    expect(r.rulesEvaluated).toBe(1);
  });

  it('records a breach with no specific tool', () => {
    const r = buildBreachEvalResult([], { ruleId: 'budget_exceeded', ruleType: 'budget', reason: 'over monthly cap', source: 'reactive_guardrail' });
    expect(r.violations).toHaveLength(1);
    expect(r.violations![0].ruleType).toBe('budget');
    expect(r.violations![0].detail).toContain('over monthly cap');
    expect(r.rulesEvaluated).toBe(1);
  });
});

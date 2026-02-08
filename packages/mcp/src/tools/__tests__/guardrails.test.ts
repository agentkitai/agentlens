/**
 * Tests for agentlens_guardrails MCP Tool (v0.8.0 — Story 3.1)
 */

import { describe, it, expect, vi } from 'vitest';
import { formatGuardrailStatus } from '../guardrails-format.js';

// Since the MCP tool requires a full server setup, we test the formatting logic

describe('Guardrail MCP Tool Formatting', () => {
  it('should format empty rules list', () => {
    const result = formatGuardrailStatus([], []);
    expect(result).toContain('No guardrail rules configured');
  });

  it('should format active rules', () => {
    const rules = [
      { id: 'r1', name: 'Error Guard', enabled: true, conditionType: 'error_rate_threshold', actionType: 'pause_agent', cooldownMinutes: 15, dryRun: false },
    ];
    const statuses = [
      { rule: rules[0], state: { triggerCount: 3, lastTriggeredAt: '2026-01-01T00:00:00Z' }, recentTriggers: [] },
    ];
    const result = formatGuardrailStatus(rules as any, statuses as any);
    expect(result).toContain('Error Guard');
    expect(result).toContain('Enabled');
    expect(result).toContain('Triggers: 3');
  });

  it('should show dry run badge', () => {
    const rules = [
      { id: 'r1', name: 'Test Guard', enabled: true, conditionType: 'cost_limit', actionType: 'notify_webhook', cooldownMinutes: 15, dryRun: true },
    ];
    const statuses = [
      { rule: rules[0], state: null, recentTriggers: [] },
    ];
    const result = formatGuardrailStatus(rules as any, statuses as any);
    expect(result).toContain('DRY RUN');
  });

  it('should show disabled rules', () => {
    const rules = [
      { id: 'r1', name: 'Disabled Guard', enabled: false, conditionType: 'error_rate_threshold', actionType: 'pause_agent', cooldownMinutes: 15, dryRun: false },
    ];
    const statuses = [
      { rule: rules[0], state: null, recentTriggers: [] },
    ];
    const result = formatGuardrailStatus(rules as any, statuses as any);
    expect(result).toContain('Disabled');
  });

  it('should show recent triggers', () => {
    const rules = [
      { id: 'r1', name: 'Test', enabled: true, conditionType: 'error_rate_threshold', actionType: 'pause_agent', cooldownMinutes: 15, dryRun: false },
    ];
    const statuses = [
      {
        rule: rules[0],
        state: { triggerCount: 1 },
        recentTriggers: [
          { triggeredAt: '2026-01-01T12:00:00Z', conditionValue: 45, conditionThreshold: 30, actionResult: 'success' },
        ],
      },
    ];
    const result = formatGuardrailStatus(rules as any, statuses as any);
    expect(result).toContain('Recent:');
    expect(result).toContain('value=45');
    expect(result).toContain('success');
  });
});

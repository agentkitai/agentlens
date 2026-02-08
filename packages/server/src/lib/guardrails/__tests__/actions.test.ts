/**
 * Tests for Guardrail Action Executors (v0.8.0 — Story 1.5)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GuardrailRule, GuardrailConditionResult } from '@agentlensai/core';
import { executePauseAgent, executeNotifyWebhook, executeDowngradeModel, executeAgentgatePolicy, executeAction } from '../actions.js';
import { eventBus } from '../../event-bus.js';

const tenantId = 'test-tenant';

function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: 'rule_1', tenantId, name: 'Test Rule', enabled: true,
    conditionType: 'error_rate_threshold', conditionConfig: {},
    actionType: 'pause_agent', actionConfig: {},
    cooldownMinutes: 15, dryRun: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const condResult: GuardrailConditionResult = {
  triggered: true, currentValue: 45, threshold: 30,
  message: 'Error rate 45% exceeds threshold 30%',
};

describe('Guardrail Actions', () => {
  afterEach(() => {
    eventBus.removeAllListeners();
    vi.restoreAllMocks();
  });

  describe('executePauseAgent', () => {
    it('should emit alert_triggered event', async () => {
      const events: unknown[] = [];
      eventBus.on('alert_triggered', (e) => events.push(e));
      const result = await executePauseAgent(makeRule(), condResult, 'agent_1');
      expect(result.success).toBe(true);
      expect(events).toHaveLength(1);
    });

    it('should include rule name in emitted event', async () => {
      const events: any[] = [];
      eventBus.on('alert_triggered', (e) => events.push(e));
      await executePauseAgent(makeRule({ name: 'My Guard' }), condResult, 'agent_1');
      expect(events[0].rule.name).toContain('guardrail:My Guard');
    });
  });

  describe('executeNotifyWebhook', () => {
    it('should fail when no URL configured', async () => {
      const result = await executeNotifyWebhook(makeRule({ actionConfig: {} }), condResult, 'agent_1');
      expect(result.success).toBe(false);
      expect(result.result).toContain('no webhook URL');
    });

    it('should send HTTP POST to configured URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const rule = makeRule({ actionConfig: { url: 'https://example.com/hook' } });
      const result = await executeNotifyWebhook(rule, condResult, 'agent_1');
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.guardrailName).toBe('Test Rule');
    });

    it('should include custom headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      await executeNotifyWebhook(makeRule({ actionConfig: { url: 'https://example.com/hook', headers: { 'X-Custom': 'val' } } }), condResult, 'agent_1');
      expect(fetchMock.mock.calls[0][1].headers['X-Custom']).toBe('val');
    });

    it('should handle HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const result = await executeNotifyWebhook(makeRule({ actionConfig: { url: 'https://example.com/hook' } }), condResult, 'agent_1');
      expect(result.success).toBe(false);
      expect(result.result).toContain('HTTP 500');
    });

    it('should handle network error gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      const result = await executeNotifyWebhook(makeRule({ actionConfig: { url: 'https://example.com/hook' } }), condResult, 'agent_1');
      expect(result.success).toBe(false);
      expect(result.result).toContain('Network error');
    });
  });

  describe('executeDowngradeModel', () => {
    it('should emit alert_triggered event', async () => {
      const events: any[] = [];
      eventBus.on('alert_triggered', (e) => events.push(e));
      const result = await executeDowngradeModel(makeRule({ actionConfig: { targetModel: 'gpt-4o-mini' } }), condResult, 'agent_1');
      expect(result.success).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0].history.message).toContain('gpt-4o-mini');
    });
  });

  describe('executeAgentgatePolicy', () => {
    it('should fail when no AgentGate URL', async () => {
      const result = await executeAgentgatePolicy(makeRule({ actionConfig: {} }), condResult, 'agent_1');
      expect(result.success).toBe(false);
      expect(result.result).toContain('no AgentGate URL');
    });

    it('should call AgentGate API', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      const result = await executeAgentgatePolicy(makeRule({ actionConfig: { agentgateUrl: 'https://gate.example.com', policyId: 'p1' } }), condResult, 'agent_1');
      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain('/api/policies/p1');
    });
  });

  describe('executeAction (dispatch)', () => {
    it('should dispatch to pause_agent', async () => {
      const events: unknown[] = [];
      eventBus.on('alert_triggered', (e) => events.push(e));
      const result = await executeAction(makeRule({ actionType: 'pause_agent' }), condResult, 'agent_1');
      expect(result.success).toBe(true);
    });

    it('should handle unknown action type', async () => {
      const result = await executeAction(makeRule({ actionType: 'unknown' as any }), condResult, 'agent_1');
      expect(result.success).toBe(false);
    });
  });
});

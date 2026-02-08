/**
 * Guardrail Action Executors (v0.8.0 — Story 1.5)
 *
 * All executors are FAIL-SAFE — catch errors and return a result string.
 */

import type { GuardrailRule, GuardrailConditionResult } from '@agentlensai/core';
import { eventBus } from '../event-bus.js';

export interface ActionResult {
  success: boolean;
  result: string;
}

/**
 * Optional store interface for agent-level DB updates.
 * Story 1.2 will implement the agents table migration with paused_at, pause_reason,
 * and model_override columns. When available, pass an AgentStore to the action
 * executors to persist state changes to the DB.
 */
export interface AgentStore {
  pauseAgent?(tenantId: string, agentId: string, reason: string): void;
  unpauseAgent?(tenantId: string, agentId: string): void;
  setModelOverride?(tenantId: string, agentId: string, model: string): void;
}

/** Module-level agent store — set via `setAgentStore()` when available (Story 1.2). */
let agentStore: AgentStore | null = null;

export function setAgentStore(store: AgentStore | null): void {
  agentStore = store;
}

export function getAgentStore(): AgentStore | null {
  return agentStore;
}

export async function executePauseAgent(
  rule: GuardrailRule,
  conditionResult: GuardrailConditionResult,
  _agentId: string,
): Promise<ActionResult> {
  try {
    const config = rule.actionConfig as { message?: string };
    const message = config.message ?? `Guardrail "${rule.name}" triggered: ${conditionResult.message}`;

    // TODO [Story 1.2]: When agents table has paused_at/pause_reason columns,
    // UPDATE agents SET paused_at = NOW(), pause_reason = message
    // WHERE id = agentId AND tenant_id = tenantId
    // This is required for: SDK X-AgentLens-Agent-Paused header, dashboard paused badge, unpause endpoint.
    if (agentStore?.pauseAgent) {
      agentStore.pauseAgent(rule.tenantId, _agentId, message);
    }

    eventBus.emit({
      type: 'alert_triggered',
      rule: {
        id: rule.id, name: `guardrail:${rule.name}`, enabled: rule.enabled,
        condition: 'error_rate_exceeds' as const, threshold: conditionResult.threshold, windowMinutes: 0,
        scope: rule.agentId ? { agentId: rule.agentId } : {},
        notifyChannels: [], createdAt: rule.createdAt, updatedAt: rule.updatedAt, tenantId: rule.tenantId,
      },
      history: {
        id: `gh_${Date.now()}`, ruleId: rule.id, triggeredAt: new Date().toISOString(),
        currentValue: conditionResult.currentValue, threshold: conditionResult.threshold,
        message, tenantId: rule.tenantId,
      },
      timestamp: new Date().toISOString(),
    });
    return { success: true, result: 'success' };
  } catch (err) {
    return { success: false, result: `failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

export async function executeNotifyWebhook(
  rule: GuardrailRule,
  conditionResult: GuardrailConditionResult,
  agentId: string,
): Promise<ActionResult> {
  try {
    const config = rule.actionConfig as { url?: string; headers?: Record<string, string> };
    if (!config.url) return { success: false, result: 'failed: no webhook URL configured' };

    const payload = {
      guardrailId: rule.id, guardrailName: rule.name, conditionType: rule.conditionType,
      conditionValue: conditionResult.currentValue, conditionThreshold: conditionResult.threshold,
      message: conditionResult.message, agentId, triggeredAt: new Date().toISOString(),
    };

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    return response.ok ? { success: true, result: 'success' } : { success: false, result: `failed: HTTP ${response.status}` };
  } catch (err) {
    return { success: false, result: `failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

export async function executeDowngradeModel(
  rule: GuardrailRule,
  conditionResult: GuardrailConditionResult,
  _agentId: string,
): Promise<ActionResult> {
  try {
    const config = rule.actionConfig as { targetModel?: string; message?: string };
    const message = config.message ?? `Guardrail "${rule.name}" recommends downgrading model`;

    // TODO [Story 1.2]: When agents table has model_override column,
    // UPDATE agents SET model_override = config.targetModel
    // WHERE id = agentId AND tenant_id = tenantId
    // This is required for: SDK to read the override and use the downgraded model.
    if (agentStore?.setModelOverride && config.targetModel) {
      agentStore.setModelOverride(rule.tenantId, _agentId, config.targetModel);
    }

    eventBus.emit({
      type: 'alert_triggered',
      rule: {
        id: rule.id, name: `guardrail:downgrade:${rule.name}`, enabled: rule.enabled,
        condition: 'error_rate_exceeds' as const, threshold: conditionResult.threshold, windowMinutes: 0,
        scope: rule.agentId ? { agentId: rule.agentId } : {},
        notifyChannels: [], createdAt: rule.createdAt, updatedAt: rule.updatedAt, tenantId: rule.tenantId,
      },
      history: {
        id: `gh_${Date.now()}`, ruleId: rule.id, triggeredAt: new Date().toISOString(),
        currentValue: conditionResult.currentValue, threshold: conditionResult.threshold,
        message: `${message} (target: ${config.targetModel ?? 'unknown'})`, tenantId: rule.tenantId,
      },
      timestamp: new Date().toISOString(),
    });
    return { success: true, result: 'success' };
  } catch (err) {
    return { success: false, result: `failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

export async function executeAgentgatePolicy(
  rule: GuardrailRule,
  conditionResult: GuardrailConditionResult,
  agentId: string,
): Promise<ActionResult> {
  try {
    const config = rule.actionConfig as { agentgateUrl?: string; policyId?: string; action?: string };
    if (!config.agentgateUrl) return { success: false, result: 'failed: no AgentGate URL configured' };

    const url = `${config.agentgateUrl.replace(/\/$/, '')}/api/policies/${config.policyId ?? 'default'}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: config.action ?? 'restrict',
        reason: `Guardrail "${rule.name}" triggered: ${conditionResult.message}`,
        agentId, triggeredBy: 'agentlens-guardrail', ruleId: rule.id,
      }),
      signal: AbortSignal.timeout(10000),
    });

    return response.ok ? { success: true, result: 'success' } : { success: false, result: `failed: HTTP ${response.status}` };
  } catch (err) {
    return { success: false, result: `failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

export async function executeAction(
  rule: GuardrailRule,
  conditionResult: GuardrailConditionResult,
  agentId: string,
): Promise<ActionResult> {
  switch (rule.actionType) {
    case 'pause_agent': return executePauseAgent(rule, conditionResult, agentId);
    case 'notify_webhook': return executeNotifyWebhook(rule, conditionResult, agentId);
    case 'downgrade_model': return executeDowngradeModel(rule, conditionResult, agentId);
    case 'agentgate_policy': return executeAgentgatePolicy(rule, conditionResult, agentId);
    default: return { success: false, result: `unknown action type: ${rule.actionType}` };
  }
}

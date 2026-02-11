/**
 * Guardrail Action Executors (v0.8.0 — Story 1.5)
 *
 * All executors are FAIL-SAFE — catch errors and return a result string.
 */

import type { GuardrailRule, GuardrailConditionResult } from '@agentlensai/core';
import { eventBus } from '../event-bus.js';

// ─── SSRF Protection (C-3, C-4) ────────────────────────────────────

/**
 * Validate a URL is safe to fetch (not targeting private/internal IPs).
 * Blocks RFC 1918, link-local, loopback, and non-HTTP(S) schemes.
 */
function validateExternalUrl(urlStr: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    return { valid: false, reason: 'Localhost URLs are not allowed' };
  }

  // Block private IP ranges
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    // 10.0.0.0/8
    if (a === 10) return { valid: false, reason: 'Private IP range (10.x.x.x)' };
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return { valid: false, reason: 'Private IP range (172.16-31.x.x)' };
    // 192.168.0.0/16
    if (a === 192 && b === 168) return { valid: false, reason: 'Private IP range (192.168.x.x)' };
    // 169.254.0.0/16 (link-local / cloud metadata)
    if (a === 169 && b === 254) return { valid: false, reason: 'Link-local/metadata IP (169.254.x.x)' };
    // 0.0.0.0
    if (a === 0) return { valid: false, reason: 'Disallowed IP (0.x.x.x)' };
  }

  return { valid: true };
}

export interface ActionResult {
  success: boolean;
  result: string;
}

/**
 * Store interface for agent-level DB updates.
 * B1 (Story 1.2) wires this to the real SqliteEventStore methods
 * that UPDATE the agents table's paused_at, pause_reason, model_override columns.
 */
export interface AgentStore {
  pauseAgent(tenantId: string, agentId: string, reason: string): Promise<boolean> | void;
  unpauseAgent(tenantId: string, agentId: string, clearModelOverride?: boolean): Promise<boolean> | void;
  setModelOverride(tenantId: string, agentId: string, model: string): Promise<boolean> | void;
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

    // B1 (Story 1.2): Update agents table with paused_at + pause_reason
    if (agentStore?.pauseAgent) {
      await agentStore.pauseAgent(rule.tenantId, _agentId, message);
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

    // C-3 FIX: SSRF protection
    const urlCheck = validateExternalUrl(config.url);
    if (!urlCheck.valid) return { success: false, result: `failed: ${urlCheck.reason}` };

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

    // B1 (Story 1.2): Update agents table with model_override
    if (agentStore?.setModelOverride && config.targetModel) {
      await agentStore.setModelOverride(rule.tenantId, _agentId, config.targetModel);
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

    // C-4 FIX: SSRF protection
    const urlCheck = validateExternalUrl(config.agentgateUrl);
    if (!urlCheck.valid) return { success: false, result: `failed: ${urlCheck.reason}` };

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

import { request, toQueryString } from './core';

export type GuardrailDirection = 'input' | 'output' | 'both';

export interface GuardrailRuleData {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;
  conditionType: string;
  conditionConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  agentId?: string;
  cooldownMinutes: number;
  dryRun: boolean;
  direction?: GuardrailDirection;
  toolNames?: string[];
  priority?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGuardrailData {
  name: string;
  description?: string;
  enabled?: boolean;
  conditionType: string;
  conditionConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  agentId?: string;
  cooldownMinutes?: number;
  dryRun?: boolean;
  direction?: GuardrailDirection;
  toolNames?: string[];
  priority?: number;
}

export interface GuardrailTriggerData {
  id: string;
  ruleId: string;
  triggeredAt: string;
  conditionValue: number;
  conditionThreshold: number;
  actionExecuted: boolean;
  actionResult?: string;
  metadata: Record<string, unknown>;
}

export async function getGuardrailRules(): Promise<{ rules: GuardrailRuleData[] }> {
  return request<{ rules: GuardrailRuleData[] }>('/api/guardrails');
}

export async function createGuardrailRule(data: CreateGuardrailData): Promise<GuardrailRuleData> {
  return request<GuardrailRuleData>('/api/guardrails', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGuardrailRule(id: string, data: Partial<CreateGuardrailData>): Promise<GuardrailRuleData> {
  return request<GuardrailRuleData>(`/api/guardrails/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteGuardrailRule(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/guardrails/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getGuardrailStatus(id: string): Promise<{
  rule: GuardrailRuleData;
  state: { triggerCount: number; lastTriggeredAt?: string; currentValue?: number } | null;
  recentTriggers: GuardrailTriggerData[];
}> {
  return request(`/api/guardrails/${encodeURIComponent(id)}/status`);
}

export async function getGuardrailHistory(params?: {
  ruleId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ triggers: GuardrailTriggerData[]; total: number }> {
  const qs = toQueryString({
    ruleId: params?.ruleId,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request(`/api/guardrails/history${qs}`);
}

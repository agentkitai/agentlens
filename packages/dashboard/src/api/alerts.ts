import { request, toQueryString } from './core';

export interface AlertRuleData {
  id: string;
  name: string;
  enabled: boolean;
  condition: string;
  threshold: number;
  windowMinutes: number;
  scope: { agentId?: string; tags?: string[] };
  notifyChannels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertRuleData {
  name: string;
  enabled?: boolean;
  condition: string;
  threshold: number;
  windowMinutes: number;
  scope?: { agentId?: string; tags?: string[] };
  notifyChannels?: string[];
}

export interface AlertHistoryEntry {
  id: string;
  ruleId: string;
  triggeredAt: string;
  resolvedAt?: string;
  currentValue: number;
  threshold: number;
  message: string;
}

interface AlertRulesResponse {
  rules: AlertRuleData[];
}

interface AlertHistoryResponse {
  entries: AlertHistoryEntry[];
  total: number;
  hasMore: boolean;
}

export async function getAlertRules(): Promise<AlertRuleData[]> {
  const data = await request<AlertRulesResponse>('/api/alerts/rules');
  return data.rules;
}

export async function getAlertRule(id: string): Promise<AlertRuleData> {
  return request<AlertRuleData>(`/api/alerts/rules/${encodeURIComponent(id)}`);
}

export async function createAlertRule(data: CreateAlertRuleData): Promise<AlertRuleData> {
  return request<AlertRuleData>('/api/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAlertRule(id: string, data: Partial<CreateAlertRuleData>): Promise<AlertRuleData> {
  return request<AlertRuleData>(`/api/alerts/rules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAlertRule(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/alerts/rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getAlertHistory(opts?: { ruleId?: string; limit?: number; offset?: number }): Promise<AlertHistoryResponse> {
  const qs = toQueryString({
    ruleId: opts?.ruleId,
    limit: opts?.limit,
    offset: opts?.offset,
  });
  return request<AlertHistoryResponse>(`/api/alerts/history${qs}`);
}

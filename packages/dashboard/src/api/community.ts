import { request, toQueryString } from './core';

export interface SharingConfigData {
  tenantId: string;
  enabled: boolean;
  humanReviewEnabled: boolean;
  poolEndpoint: string | null;
  anonymousContributorId: string | null;
  purgeToken: string | null;
  rateLimitPerHour: number;
  volumeAlertThreshold: number;
  updatedAt: string;
}

export interface AgentSharingConfigData {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  categories: string[];
  updatedAt: string;
}

export interface DenyListRuleData {
  id: string;
  tenantId: string;
  pattern: string;
  isRegex: boolean;
  reason: string;
  createdAt: string;
}

export interface SharedLessonData {
  id: string;
  category: string;
  title: string;
  content: string;
  reputationScore: number;
  qualitySignals: Record<string, unknown>;
}

export interface SharingAuditEventData {
  id: string;
  tenantId: string;
  eventType: string;
  lessonId?: string;
  anonymousLessonId?: string;
  queryText?: string;
  initiatedBy: string;
  timestamp: string;
}

export async function getSharingConfig(): Promise<SharingConfigData> {
  return request<SharingConfigData>('/api/community/config');
}

export async function updateSharingConfig(data: Partial<SharingConfigData>): Promise<SharingConfigData> {
  return request<SharingConfigData>('/api/community/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getAgentSharingConfigs(): Promise<{ configs: AgentSharingConfigData[] }> {
  return request<{ configs: AgentSharingConfigData[] }>('/api/community/agents');
}

export async function updateAgentSharingConfig(agentId: string, data: Partial<AgentSharingConfigData>): Promise<AgentSharingConfigData> {
  return request<AgentSharingConfigData>(`/api/community/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getDenyList(): Promise<{ rules: DenyListRuleData[] }> {
  return request<{ rules: DenyListRuleData[] }>('/api/community/deny-list');
}

export async function addDenyListRule(data: { pattern: string; isRegex: boolean; reason: string }): Promise<DenyListRuleData> {
  return request<DenyListRuleData>('/api/community/deny-list', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteDenyListRule(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/community/deny-list/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function communitySearch(params?: {
  query?: string;
  category?: string;
  minReputation?: number;
  limit?: number;
}): Promise<{ lessons: SharedLessonData[]; total: number }> {
  const qs = toQueryString({
    query: params?.query,
    category: params?.category,
    minReputation: params?.minReputation,
    limit: params?.limit,
  });
  return request<{ lessons: SharedLessonData[]; total: number }>(`/api/community/search${qs}`);
}

export async function communityRate(lessonId: string, delta: number): Promise<{ status: string; reputationScore: number }> {
  return request<{ status: string; reputationScore: number }>('/api/community/rate', {
    method: 'POST',
    body: JSON.stringify({ lessonId, delta }),
  });
}

export async function getSharingAuditLog(params?: {
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<{ events: SharingAuditEventData[]; total: number }> {
  const qs = toQueryString({
    eventType: params?.eventType,
    from: params?.from,
    to: params?.to,
    limit: params?.limit,
  });
  return request<{ events: SharingAuditEventData[]; total: number }>(`/api/community/audit${qs}`);
}

export async function killSwitchPurge(confirmation: string): Promise<{ status: string; deleted: number }> {
  return request<{ status: string; deleted: number }>('/api/community/purge', {
    method: 'POST',
    body: JSON.stringify({ confirmation }),
  });
}

export async function getSharingStats(): Promise<{ countShared: number; lastShared: string | null; auditSummary: Record<string, number> }> {
  return request<{ countShared: number; lastShared: string | null; auditSummary: Record<string, number> }>('/api/community/stats');
}

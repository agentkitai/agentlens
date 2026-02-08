/**
 * Typed API client for AgentLens Dashboard
 *
 * All functions hit the server via relative URLs (proxied by Vite in dev).
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  SessionQueryResult,
  Agent,
  StorageStats,
} from '@agentlensai/core';

// ─── Helpers ────────────────────────────────────────────────────────

const BASE = '';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function toQueryString(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      sp.set(key, val.join(','));
    } else {
      sp.set(key, String(val));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

// ─── Events ─────────────────────────────────────────────────────────

export async function getEvents(query: EventQuery = {}): Promise<EventQueryResult> {
  const qs = toQueryString({
    sessionId: query.sessionId,
    agentId: query.agentId,
    eventType: Array.isArray(query.eventType) ? query.eventType : query.eventType ? [query.eventType] : undefined,
    severity: Array.isArray(query.severity) ? query.severity : query.severity ? [query.severity] : undefined,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
    order: query.order,
    search: query.search,
  });
  return request<EventQueryResult>(`/api/events${qs}`);
}

// ─── Sessions ───────────────────────────────────────────────────────

export async function getSessions(query: SessionQuery = {}): Promise<SessionQueryResult & { hasMore: boolean }> {
  const qs = toQueryString({
    agentId: query.agentId,
    status: query.status,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
    tags: query.tags,
  });
  return request<SessionQueryResult & { hasMore: boolean }>(`/api/sessions${qs}`);
}

export async function getSession(id: string): Promise<Session> {
  return request<Session>(`/api/sessions/${encodeURIComponent(id)}`);
}

export interface SessionTimeline {
  events: AgentLensEvent[];
  chainValid: boolean;
}

export async function getSessionTimeline(id: string): Promise<SessionTimeline> {
  return request<SessionTimeline>(`/api/sessions/${encodeURIComponent(id)}/timeline`);
}

// ─── Agents ─────────────────────────────────────────────────────────

interface AgentsResponse {
  agents: Agent[];
}

export async function getAgents(): Promise<Agent[]> {
  const data = await request<AgentsResponse>('/api/agents');
  return data.agents;
}

export async function getAgent(id: string): Promise<Agent> {
  return request<Agent>(`/api/agents/${encodeURIComponent(id)}`);
}

// ─── Stats ──────────────────────────────────────────────────────────

export async function getStats(): Promise<StorageStats> {
  return request<StorageStats>('/api/stats');
}

// ─── API Keys ───────────────────────────────────────────────────────

export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface KeysResponse {
  keys: ApiKeyInfo[];
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string;
}

export async function getKeys(): Promise<ApiKeyInfo[]> {
  const data = await request<KeysResponse>('/api/keys');
  return data.keys;
}

export async function createKey(name?: string, scopes?: string[]): Promise<ApiKeyCreated> {
  return request<ApiKeyCreated>('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  });
}

export async function revokeKey(id: string): Promise<{ id: string; revoked: boolean }> {
  return request<{ id: string; revoked: boolean }>(`/api/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Config ─────────────────────────────────────────────────────────

export interface ConfigData {
  retentionDays: number;
  agentGateUrl: string;
  agentGateSecret: string;
  formBridgeUrl: string;
  formBridgeSecret: string;
}

export async function getConfig(): Promise<ConfigData> {
  return request<ConfigData>('/api/config');
}

export async function updateConfig(data: Partial<ConfigData>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ─── Analytics ──────────────────────────────────────────────────────

export interface AnalyticsBucket {
  timestamp: string;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  uniqueSessions: number;
}

export interface AnalyticsResult {
  buckets: AnalyticsBucket[];
  totals: {
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    uniqueSessions: number;
    uniqueAgents: number;
  };
}

export interface CostByAgent {
  agentId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  eventCount: number;
}

export interface CostOverTime {
  bucket: string;
  totalCostUsd: number;
  eventCount: number;
  byAgent?: Record<string, number>;
}

export interface CostAnalyticsResult {
  byAgent: CostByAgent[];
  overTime: CostOverTime[];
  totals: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  };
}

export interface AgentAnalytics {
  agentId: string;
  sessionCount: number;
  totalEvents: number;
  totalErrors: number;
  errorRate: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

export interface ToolAnalytics {
  toolName: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
}

export async function getAnalytics(params: {
  from?: string;
  to?: string;
  granularity?: string;
  agentId?: string;
}): Promise<AnalyticsResult> {
  const qs = toQueryString({
    from: params.from,
    to: params.to,
    granularity: params.granularity,
    agentId: params.agentId,
  });
  return request<AnalyticsResult>(`/api/analytics${qs}`);
}

export async function getCostAnalytics(params: {
  from?: string;
  to?: string;
  granularity?: string;
}): Promise<CostAnalyticsResult> {
  const qs = toQueryString({
    from: params.from,
    to: params.to,
    granularity: params.granularity,
  });
  return request<CostAnalyticsResult>(`/api/analytics/costs${qs}`);
}

export async function getAgentAnalytics(params: {
  from?: string;
  to?: string;
}): Promise<{ agents: AgentAnalytics[] }> {
  const qs = toQueryString({ from: params.from, to: params.to });
  return request<{ agents: AgentAnalytics[] }>(`/api/analytics/agents${qs}`);
}

export async function getToolAnalytics(params: {
  from?: string;
  to?: string;
}): Promise<{ tools: ToolAnalytics[] }> {
  const qs = toQueryString({ from: params.from, to: params.to });
  return request<{ tools: ToolAnalytics[] }>(`/api/analytics/tools${qs}`);
}

// ─── Alerts ─────────────────────────────────────────────────────────

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

export { ApiError };

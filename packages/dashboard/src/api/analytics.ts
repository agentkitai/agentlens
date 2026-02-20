import { request, toQueryString } from './core';
import type { StorageStats } from './core';

export async function getStats(): Promise<StorageStats> {
  return request<StorageStats>('/api/stats');
}

export interface OverviewStats {
  eventsTodayCount: number;
  eventsYesterdayCount: number;
  errorsTodayCount: number;
  errorsYesterdayCount: number;
  sessionsTodayCount: number;
  sessionsYesterdayCount: number;
  totalAgents: number;
  errorRate: number;
}

export async function getOverviewStats(params?: { from?: string; to?: string }): Promise<OverviewStats> {
  const qs = params ? toQueryString(params) : '';
  return request<OverviewStats>(`/api/stats/overview${qs}`);
}

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
  range?: string;
  granularity?: string;
  agentId?: string;
}): Promise<AnalyticsResult> {
  const qs = toQueryString({
    from: params.from,
    to: params.to,
    range: params.range,
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

// ─── LLM Analytics ──────────────────────────────────────────────────

export interface LlmModelBreakdown {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmTimeBucket {
  bucket: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmAnalyticsResult {
  summary: {
    totalCalls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgLatencyMs: number;
    avgCostPerCall: number;
  };
  byModel: LlmModelBreakdown[];
  byTime: LlmTimeBucket[];
}

export async function getLlmAnalytics(params: {
  from?: string;
  to?: string;
  granularity?: string;
  agentId?: string;
  model?: string;
  provider?: string;
}): Promise<LlmAnalyticsResult> {
  const qs = toQueryString({
    from: params.from,
    to: params.to,
    granularity: params.granularity,
    agentId: params.agentId,
    model: params.model,
    provider: params.provider,
  });
  return request<LlmAnalyticsResult>(`/api/analytics/llm${qs}`);
}

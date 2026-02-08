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

// ─── Session Replay (Story 5.1) ─────────────────────────────────────

export interface SessionReplayData {
  session: Session;
  events: AgentLensEvent[];
  chainValid: boolean;
}

export async function getSessionReplay(id: string): Promise<SessionReplayData> {
  return request<SessionReplayData>(`/api/sessions/${encodeURIComponent(id)}/replay`);
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

// ─── Recall (Semantic Search) ───────────────────────────────────

export interface RecallResultItem {
  sourceType: string;
  sourceId: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RecallResult {
  results: RecallResultItem[];
  query: string;
  totalResults: number;
}

export async function recall(params: {
  query: string;
  scope?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  minScore?: number;
}): Promise<RecallResult> {
  const qs = toQueryString({
    query: params.query,
    scope: params.scope,
    agentId: params.agentId,
    from: params.from,
    to: params.to,
    limit: params.limit,
    minScore: params.minScore,
  });
  return request<RecallResult>(`/api/recall${qs}`);
}

// ─── Lessons ────────────────────────────────────────────────────

export type LessonImportance = 'low' | 'normal' | 'high' | 'critical';

export interface LessonData {
  id: string;
  tenantId: string;
  agentId?: string;
  category: string;
  title: string;
  content: string;
  context: Record<string, unknown>;
  importance: LessonImportance;
  sourceSessionId?: string;
  sourceEventId?: string;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateLessonData {
  title: string;
  content: string;
  category?: string;
  importance?: LessonImportance;
  agentId?: string;
  context?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceEventId?: string;
}

interface LessonsResponse {
  lessons: LessonData[];
  total: number;
}

export async function getLessons(params?: {
  agentId?: string;
  category?: string;
  importance?: string;
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}): Promise<LessonsResponse> {
  const qs = toQueryString({
    agentId: params?.agentId,
    category: params?.category,
    importance: params?.importance,
    search: params?.search,
    limit: params?.limit,
    offset: params?.offset,
    includeArchived: params?.includeArchived,
  });
  return request<LessonsResponse>(`/api/lessons${qs}`);
}

export async function getLesson(id: string): Promise<LessonData> {
  return request<LessonData>(`/api/lessons/${encodeURIComponent(id)}`);
}

export async function createLesson(data: CreateLessonData): Promise<LessonData> {
  return request<LessonData>('/api/lessons', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLesson(id: string, data: Partial<CreateLessonData>): Promise<LessonData> {
  return request<LessonData>(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteLesson(id: string): Promise<{ id: string; archived: boolean }> {
  return request<{ id: string; archived: boolean }>(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Reflect (Pattern Analysis) ─────────────────────────────────

export type ReflectAnalysis =
  | 'error_patterns'
  | 'tool_sequences'
  | 'cost_analysis'
  | 'performance_trends';

export interface ReflectInsight {
  type: string;
  summary: string;
  data: Record<string, unknown>;
  confidence: number;
}

export interface ReflectResultData {
  analysis: ReflectAnalysis;
  insights: ReflectInsight[];
  metadata: {
    sessionsAnalyzed: number;
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

export async function reflect(params: {
  analysis: ReflectAnalysis;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ReflectResultData> {
  const qs = toQueryString({
    analysis: params.analysis,
    agentId: params.agentId,
    from: params.from,
    to: params.to,
    limit: params.limit,
  });
  return request<ReflectResultData>(`/api/reflect${qs}`);
}

// ─── Health Overview (Story 3.4) ────────────────────────────────────

export interface AgentHealth {
  agentId: string;
  agentName?: string;
  overallScore: number;
  trend: 'improving' | 'stable' | 'degrading';
  dimensions: Record<string, number>;
}

export interface HealthOverviewData {
  agents: AgentHealth[];
  window: number;
}

export async function getHealthOverview(params: {
  window?: number;
}): Promise<HealthOverviewData> {
  const qs = toQueryString({ window: params.window });
  return request<HealthOverviewData>(`/api/health/overview${qs}`);
}

// ─── Cost Optimization (Story 3.5) ──────────────────────────────────

export interface OptimizationRecommendation {
  agentId?: string;
  agentName?: string;
  currentModel: string;
  recommendedModel: string;
  complexityTier: string;
  monthlySavings: number;
  confidence: 'low' | 'medium' | 'high';
  callVolume: number;
}

export interface OptimizationRecommendationsData {
  recommendations: OptimizationRecommendation[];
  period: number;
  totalPotentialSavings: number;
}

export async function getOptimizationRecommendations(params: {
  period?: number;
  limit?: number;
  agentId?: string;
}): Promise<OptimizationRecommendationsData> {
  const qs = toQueryString({
    period: params.period,
    limit: params.limit,
    agentId: params.agentId,
  });
  return request<OptimizationRecommendationsData>(`/api/optimize/recommendations${qs}`);
}

// ─── Benchmarks (Stories 6.1, 6.2) ─────────────────────────────────

export type BenchmarkStatus = 'draft' | 'running' | 'completed' | 'cancelled';

export interface BenchmarkVariant {
  id?: string;
  name: string;
  tag: string;
  description?: string;
  sessionCount?: number;
}

export interface BenchmarkData {
  id: string;
  name: string;
  description?: string;
  status: BenchmarkStatus;
  agentId?: string;
  agentName?: string;
  variants: BenchmarkVariant[];
  metrics: string[];
  minSessions: number;
  startDate?: string;
  endDate?: string;
  totalSessions: number;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkListResponse {
  benchmarks: BenchmarkData[];
  total: number;
  hasMore: boolean;
}

export interface CreateBenchmarkData {
  name: string;
  description?: string;
  agentId?: string;
  minSessions?: number;
  variants: { name: string; tag: string; description?: string }[];
  metrics: string[];
  startDate?: string;
  endDate?: string;
}

export interface BenchmarkMetricResult {
  metric: string;
  variantResults: {
    variantId: string;
    variantName: string;
    mean: number;
    median: number;
    stdDev: number;
    sampleSize: number;
    ci95: [number, number];
  }[];
  pValue?: number;
  significant?: boolean;
}

export interface BenchmarkResultsData {
  benchmarkId: string;
  metrics: BenchmarkMetricResult[];
  summary?: {
    winner?: string;
    confidence: number;
    recommendation: string;
  };
}

export async function getBenchmarks(params?: {
  status?: BenchmarkStatus;
  limit?: number;
  offset?: number;
}): Promise<BenchmarkListResponse> {
  const qs = toQueryString({
    status: params?.status,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request<BenchmarkListResponse>(`/api/benchmarks${qs}`);
}

export async function createBenchmark(data: CreateBenchmarkData): Promise<BenchmarkData> {
  return request<BenchmarkData>('/api/benchmarks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getBenchmark(id: string): Promise<BenchmarkData> {
  return request<BenchmarkData>(`/api/benchmarks/${encodeURIComponent(id)}`);
}

export async function updateBenchmarkStatus(
  id: string,
  status: BenchmarkStatus,
): Promise<BenchmarkData> {
  return request<BenchmarkData>(`/api/benchmarks/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function getBenchmarkResults(
  id: string,
  params?: { includeDistributions?: boolean },
): Promise<BenchmarkResultsData> {
  const qs = toQueryString({
    includeDistributions: params?.includeDistributions,
  });
  return request<BenchmarkResultsData>(`/api/benchmarks/${encodeURIComponent(id)}/results${qs}`);
}

export async function deleteBenchmark(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/benchmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export { ApiError };

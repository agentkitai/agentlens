/**
 * Analytics methods — extracted from client.ts (cq-003)
 */

import type {
  RecallQuery,
  RecallResult,
  ReflectQuery,
  ReflectResult,
  ContextQuery,
  ContextResult,
  HealthScore,
  HealthSnapshot,
  OptimizationResult,
} from '@agentlensai/core';
import { NotFoundError } from '../errors.js';
import { SessionMethods } from './sessions.js';
import type {
  LlmAnalyticsParams,
  LlmAnalyticsResult,
  HealthResult,
  VerificationReport,
} from './types.js';

export abstract class AnalyticsMethods extends SessionMethods {
  /**
   * Get LLM analytics (aggregate metrics by model, time, etc.).
   */
  async getLlmAnalytics(params: LlmAnalyticsParams = {}): Promise<LlmAnalyticsResult> {
    const searchParams = new URLSearchParams();
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (params.agentId) searchParams.set('agentId', params.agentId);
    if (params.model) searchParams.set('model', params.model);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.granularity) searchParams.set('granularity', params.granularity);

    const qs = searchParams.toString();
    const path = qs ? `/api/analytics/llm?${qs}` : '/api/analytics/llm';
    return this.request<LlmAnalyticsResult>(path);
  }

  /**
   * Semantic search over embeddings.
   */
  async recall(query: RecallQuery): Promise<RecallResult> {
    const params = new URLSearchParams();
    params.set('query', query.query);
    if (query.scope) params.set('scope', query.scope);
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.minScore != null) params.set('minScore', String(query.minScore));

    return this.request<RecallResult>(`/api/recall?${params.toString()}`);
  }

  /**
   * Analyze patterns across sessions.
   */
  async reflect(query: ReflectQuery): Promise<ReflectResult> {
    const params = new URLSearchParams();
    params.set('analysis', query.analysis);
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.params) params.set('params', JSON.stringify(query.params));

    return this.request<ReflectResult>(`/api/reflect?${params.toString()}`);
  }

  /**
   * Get cross-session context for a topic.
   */
  async getContext(query: ContextQuery): Promise<ContextResult> {
    const params = new URLSearchParams();
    params.set('topic', query.topic);
    if (query.userId) params.set('userId', query.userId);
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.limit != null) params.set('limit', String(query.limit));

    return this.request<ContextResult>(`/api/context?${params.toString()}`);
  }

  /**
   * Get the health score for a single agent.
   */
  async getHealth(agentId: string, window?: number): Promise<HealthScore> {
    const params = new URLSearchParams();
    if (window != null) params.set('window', String(window));
    const qs = params.toString();
    return this.request<HealthScore>(
      `/api/agents/${encodeURIComponent(agentId)}/health${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get health score overview for all agents.
   */
  async getHealthOverview(window?: number): Promise<HealthScore[]> {
    const params = new URLSearchParams();
    if (window != null) params.set('window', String(window));
    const qs = params.toString();
    return this.request<HealthScore[]>(
      `/api/health/overview${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get historical health snapshots for an agent.
   */
  async getHealthHistory(agentId: string, days?: number): Promise<HealthSnapshot[]> {
    const params = new URLSearchParams();
    params.set('agentId', agentId);
    if (days != null) params.set('days', String(days));
    return this.request<HealthSnapshot[]>(
      `/api/health/history?${params.toString()}`,
    );
  }

  /**
   * Get cost optimization recommendations.
   */
  async getOptimizationRecommendations(options?: {
    agentId?: string;
    period?: number;
    limit?: number;
  }): Promise<OptimizationResult> {
    const params = new URLSearchParams();
    if (options?.agentId) params.set('agentId', options.agentId);
    if (options?.period != null) params.set('period', String(options.period));
    if (options?.limit != null) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<OptimizationResult>(
      `/api/optimize/recommendations${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Check server health (no auth required).
   */
  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('/api/health', { skipAuth: true });
  }

  /**
   * Verify audit trail hash chain integrity.
   */
  async verifyAudit(params: {
    from?: string;
    to?: string;
    sessionId?: string;
  }): Promise<VerificationReport> {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.sessionId) query.set('sessionId', params.sessionId);
    return this.request<VerificationReport>(`/api/audit/verify?${query.toString()}`);
  }

  /**
   * Resolve a prompt template: fetch current version, interpolate variables.
   */
  async resolvePrompt(
    templateId: string,
    variables?: Record<string, string>,
  ): Promise<{ content: string; templateId: string; versionId: string }> {
    const data = await this.request<{
      template: { id: string; currentVersionId?: string };
      versions: Array<{ id: string; versionNumber: number; content: string }>;
    }>(`/api/prompts/${encodeURIComponent(templateId)}`);

    const currentVersion = data.versions?.[0];
    if (!currentVersion) {
      throw new NotFoundError(`No versions found for template ${templateId}`);
    }

    let content = currentVersion.content;
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        content = content.replaceAll(`{{${key}}}`, value);
      }
    }

    return {
      content,
      templateId: data.template.id,
      versionId: currentVersion.id,
    };
  }
}

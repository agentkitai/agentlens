/**
 * @agentlensai/sdk — AgentLensClient
 *
 * Typed HTTP client for the AgentLens REST API.
 * Uses native fetch — works in Node.js ≥ 18 and browsers.
 */

import { randomUUID } from 'node:crypto';
import type {
  EventQuery,
  EventQueryResult,
  AgentLensEvent,
  Agent,
  Session,
  SessionQuery,
  LlmMessage,
  RecallQuery,
  RecallResult,
  ReflectQuery,
  ReflectResult,
  ContextQuery,
  ContextResult,
  HealthScore,
  HealthSnapshot,
  OptimizationResult,
  GuardrailRule,
  GuardrailState,
  GuardrailTriggerHistory,
} from '@agentlensai/core';
import {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
} from './errors.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentLensClientOptions {
  /** Base URL of the AgentLens server (e.g. "http://localhost:3400") */
  url: string;
  /** API key for authentication */
  apiKey?: string;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof globalThis.fetch;
}

export interface SessionQueryResult {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

export interface TimelineResult {
  events: AgentLensEvent[];
  chainValid: boolean;
}

export interface HealthResult {
  status: string;
  version: string;
}

export interface LogLlmCallParams {
  provider: string;
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  completion: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    thinkingTokens?: number;
  };
  costUsd: number;
  latencyMs: number;
  parameters?: Record<string, unknown>;
  tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  /** If true, prompt/completion content is stripped (redacted) before sending */
  redact?: boolean;
}

export interface LlmAnalyticsParams {
  from?: string;
  to?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  granularity?: 'hour' | 'day' | 'week';
}

export interface LlmAnalyticsSummary {
  totalCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  avgCostPerCall: number;
}

export interface LlmAnalyticsByModel {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmAnalyticsByTime {
  bucket: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmAnalyticsResult {
  summary: LlmAnalyticsSummary;
  byModel: LlmAnalyticsByModel[];
  byTime: LlmAnalyticsByTime[];
}

// ─── Guardrail Types ────────────────────────────────────────────────

export interface GuardrailRuleListResult {
  rules: GuardrailRule[];
}

export interface GuardrailStatusResult {
  rule: GuardrailRule;
  state: GuardrailState | null;
  recentTriggers: GuardrailTriggerHistory[];
}

export interface GuardrailTriggerHistoryResult {
  triggers: GuardrailTriggerHistory[];
  total: number;
}

export interface CreateGuardrailRuleParams {
  name: string;
  description?: string;
  conditionType: string;
  conditionConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  agentId?: string;
  enabled?: boolean;
  dryRun?: boolean;
  cooldownMinutes?: number;
}

export interface UpdateGuardrailRuleParams {
  name?: string;
  description?: string;
  conditionType?: string;
  conditionConfig?: Record<string, unknown>;
  actionType?: string;
  actionConfig?: Record<string, unknown>;
  agentId?: string | null;
  enabled?: boolean;
  dryRun?: boolean;
  cooldownMinutes?: number;
}

// ─── Client ─────────────────────────────────────────────────────────

export class AgentLensClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: AgentLensClientOptions) {
    // Strip trailing slash
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ─── Events ──────────────────────────────────────────────

  /**
   * Query events with filters and pagination.
   */
  async queryEvents(query: EventQuery = {}): Promise<EventQueryResult> {
    const params = new URLSearchParams();
    if (query.sessionId) params.set('sessionId', query.sessionId);
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.eventType) {
      params.set('eventType', Array.isArray(query.eventType) ? query.eventType.join(',') : query.eventType);
    }
    if (query.severity) {
      params.set('severity', Array.isArray(query.severity) ? query.severity.join(',') : query.severity);
    }
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.search) params.set('search', query.search);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    if (query.order) params.set('order', query.order);

    return this.request<EventQueryResult>(`/api/events?${params.toString()}`);
  }

  /**
   * Get a single event by ID.
   */
  async getEvent(id: string): Promise<AgentLensEvent> {
    return this.request<AgentLensEvent>(`/api/events/${encodeURIComponent(id)}`);
  }

  // ─── Sessions ────────────────────────────────────────────

  /**
   * Query sessions with filters and pagination.
   */
  async getSessions(query: SessionQuery = {}): Promise<SessionQueryResult> {
    const params = new URLSearchParams();
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.status) {
      params.set('status', Array.isArray(query.status) ? query.status.join(',') : query.status);
    }
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.tags) params.set('tags', query.tags.join(','));
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));

    return this.request<SessionQueryResult>(`/api/sessions?${params.toString()}`);
  }

  /**
   * Get a single session by ID.
   */
  async getSession(id: string): Promise<Session> {
    return this.request<Session>(`/api/sessions/${encodeURIComponent(id)}`);
  }

  /**
   * Get the full timeline of events for a session, with hash chain verification.
   */
  async getSessionTimeline(sessionId: string): Promise<TimelineResult> {
    return this.request<TimelineResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/timeline`,
    );
  }

  // ─── LLM Call Tracking ────────────────────────────────────

  /**
   * Log a complete LLM call (request + response) by sending paired events via batch ingest.
   * Auto-generates a callId. Supports redaction of prompt/completion content.
   */
  async logLlmCall(
    sessionId: string,
    agentId: string,
    params: LogLlmCallParams,
  ): Promise<{ callId: string }> {
    const callId = randomUUID();
    const timestamp = new Date().toISOString();
    const redacted = params.redact === true;

    // Build llm_call payload
    const llmCallPayload: Record<string, unknown> = {
      callId,
      provider: params.provider,
      model: params.model,
      messages: redacted
        ? params.messages.map((m) => ({ role: m.role, content: '[REDACTED]' }))
        : params.messages,
      ...(params.systemPrompt !== undefined
        ? { systemPrompt: redacted ? '[REDACTED]' : params.systemPrompt }
        : {}),
      ...(params.parameters !== undefined ? { parameters: params.parameters } : {}),
      ...(params.tools !== undefined ? { tools: params.tools } : {}),
      ...(redacted ? { redacted: true } : {}),
    };

    // Build llm_response payload
    const llmResponsePayload: Record<string, unknown> = {
      callId,
      provider: params.provider,
      model: params.model,
      completion: redacted ? '[REDACTED]' : params.completion,
      ...(params.toolCalls !== undefined ? { toolCalls: params.toolCalls } : {}),
      finishReason: params.finishReason,
      usage: params.usage,
      costUsd: params.costUsd,
      latencyMs: params.latencyMs,
      ...(redacted ? { redacted: true } : {}),
    };

    // Send both events in a single batch request
    await this.request('/api/events', {
      method: 'POST',
      body: {
        events: [
          {
            sessionId,
            agentId,
            eventType: 'llm_call',
            severity: 'info',
            payload: llmCallPayload,
            metadata: {},
            timestamp,
          },
          {
            sessionId,
            agentId,
            eventType: 'llm_response',
            severity: 'info',
            payload: llmResponsePayload,
            metadata: {},
            timestamp,
          },
        ],
      },
    });

    return { callId };
  }

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

  // ─── Recall (Semantic Search) ──────────────────────────

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

  // ─── Lessons (Deprecated — use lore-sdk) ──────────────────

  /** @deprecated Use lore-sdk directly. See https://github.com/amitpaz1/lore */
  async createLesson(): Promise<never> {
    throw new Error('Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore');
  }

  /** @deprecated Use lore-sdk directly. See https://github.com/amitpaz1/lore */
  async getLessons(): Promise<never> {
    throw new Error('Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore');
  }

  /** @deprecated Use lore-sdk directly. See https://github.com/amitpaz1/lore */
  async getLesson(): Promise<never> {
    throw new Error('Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore');
  }

  /** @deprecated Use lore-sdk directly. See https://github.com/amitpaz1/lore */
  async updateLesson(): Promise<never> {
    throw new Error('Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore');
  }

  /** @deprecated Use lore-sdk directly. See https://github.com/amitpaz1/lore */
  async deleteLesson(): Promise<never> {
    throw new Error('Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore');
  }

  // ─── Reflect (Pattern Analysis) ──────────────────────────

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

  // ─── Context (Cross-Session) ─────────────────────────────

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

  // ─── Agents ────────────────────────────────────────────────

  /**
   * Get a single agent by ID, including modelOverride and pausedAt.
   */
  async getAgent(agentId: string): Promise<Agent> {
    return this.request<Agent>(
      `/api/agents/${encodeURIComponent(agentId)}`,
    );
  }

  // ─── Agent Health Scores ──────────────────────────────────

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

  // ─── Optimization ────────────────────────────────────────

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

  // ─── Guardrails ───────────────────────────────────────────

  /**
   * List all guardrail rules, optionally filtered by agent.
   */
  async listGuardrails(options?: { agentId?: string }): Promise<GuardrailRuleListResult> {
    const params = new URLSearchParams();
    if (options?.agentId) params.set('agentId', options.agentId);
    const qs = params.toString();
    return this.request<GuardrailRuleListResult>(
      `/api/guardrails${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get a single guardrail rule by ID.
   */
  async getGuardrail(id: string): Promise<GuardrailRule> {
    return this.request<GuardrailRule>(`/api/guardrails/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new guardrail rule.
   */
  async createGuardrail(params: CreateGuardrailRuleParams): Promise<GuardrailRule> {
    return this.request<GuardrailRule>('/api/guardrails', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Update a guardrail rule.
   */
  async updateGuardrail(id: string, updates: UpdateGuardrailRuleParams): Promise<GuardrailRule> {
    return this.request<GuardrailRule>(`/api/guardrails/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: updates,
    });
  }

  /**
   * Delete a guardrail rule.
   */
  async deleteGuardrail(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/api/guardrails/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Enable a guardrail rule.
   */
  async enableGuardrail(id: string): Promise<GuardrailRule> {
    return this.updateGuardrail(id, { enabled: true });
  }

  /**
   * Disable a guardrail rule.
   */
  async disableGuardrail(id: string): Promise<GuardrailRule> {
    return this.updateGuardrail(id, { enabled: false });
  }

  /**
   * Get trigger history for guardrail rules.
   */
  async getGuardrailHistory(options?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<GuardrailTriggerHistoryResult> {
    const params = new URLSearchParams();
    if (options?.ruleId) params.set('ruleId', options.ruleId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<GuardrailTriggerHistoryResult>(
      `/api/guardrails/history${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Get status + recent triggers for a guardrail rule.
   */
  async getGuardrailStatus(id: string): Promise<GuardrailStatusResult> {
    return this.request<GuardrailStatusResult>(
      `/api/guardrails/${encodeURIComponent(id)}/status`,
    );
  }

  // ─── Server Health ───────────────────────────────────────

  /**
   * Check server health (no auth required).
   */
  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('/api/health', { skipAuth: true });
  }

  // ─── Internal ────────────────────────────────────────────

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; skipAuth?: boolean } = {},
  ): Promise<T> {
    const { method = 'GET', body, skipAuth = false } = options;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (!skipAuth && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ConnectionError(
        `Failed to connect to AgentLens at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let parsed: { error?: string; details?: unknown } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }
      const message = parsed?.error ?? (text || `HTTP ${response.status}`);

      switch (response.status) {
        case 401:
          throw new AuthenticationError(message);
        case 404:
          throw new NotFoundError(message);
        case 400:
          throw new ValidationError(message, parsed?.details);
        default:
          throw new AgentLensError(message, response.status, 'API_ERROR', parsed?.details);
      }
    }

    return response.json() as Promise<T>;
  }
}

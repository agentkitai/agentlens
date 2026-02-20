/**
 * @agentlensai/mcp — HTTP Transport Layer (Story 5.6)
 *
 * HTTP client wrapping native fetch() for communicating with the AgentLens API server.
 * Includes an in-memory event buffer with automatic flush and graceful shutdown.
 */

export interface TransportConfig {
  /** Base URL for the AgentLens API server */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
}

export interface BufferedEvent {
  sessionId: string;
  agentId: string;
  eventType: string;
  severity?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface QueryEventsParams {
  sessionId: string;
  limit?: number;
  eventType?: string;
}

/** Maximum number of events to buffer before forcing a flush */
const MAX_BUFFER_COUNT = 10_000;
/** Maximum buffer size in bytes before forcing a flush (~10MB) */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class AgentLensTransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private buffer: BufferedEvent[] = [];
  private bufferBytes = 0;
  private flushing = false;
  private shutdownHandlersInstalled = false;

  /**
   * Maps sessionId → agentId for sessions started via this transport.
   * Populated by session_start, used by log_event and session_end.
   */
  private sessionAgentMap = new Map<string, string>();
  private sessionTimestamps = new Map<string, number>();
  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;
  /** H-8 FIX: Max session TTL (24 hours) to prevent memory leak from abandoned sessions */
  private static readonly SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  constructor(config: TransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.startSessionCleanup();
  }

  /** H-8 FIX: Periodically evict stale session entries */
  private startSessionCleanup(): void {
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, ts] of this.sessionTimestamps) {
        if (now - ts > AgentLensTransport.SESSION_TTL_MS) {
          this.sessionAgentMap.delete(sessionId);
          this.sessionTimestamps.delete(sessionId);
        }
      }
    }, AgentLensTransport.SESSION_CLEANUP_INTERVAL_MS);
    if (this.sessionCleanupInterval && typeof this.sessionCleanupInterval === 'object' && 'unref' in this.sessionCleanupInterval) {
      this.sessionCleanupInterval.unref();
    }
  }

  /**
   * Install SIGTERM/SIGINT handlers for graceful shutdown.
   * Safe to call multiple times — only installs once.
   */
  installShutdownHandlers(): void {
    if (this.shutdownHandlersInstalled) return;
    this.shutdownHandlersInstalled = true;

    const handler = async () => {
      await this.flush();
      process.exit(0);
    };

    process.on('SIGTERM', handler);
    process.on('SIGINT', handler);
  }

  /**
   * Send events to the API server. Events are buffered and flushed
   * when the buffer exceeds capacity or when flush() is called explicitly.
   */
  async sendEvents(events: BufferedEvent[]): Promise<void> {
    for (const event of events) {
      const size = JSON.stringify(event).length;
      this.buffer.push(event);
      this.bufferBytes += size;
    }

    if (this.buffer.length >= MAX_BUFFER_COUNT || this.bufferBytes >= MAX_BUFFER_BYTES) {
      await this.flush();
    }
  }

  /**
   * Send a single event immediately (no buffering).
   * Used for critical events like session_start/session_end.
   * Wraps the event in the { events: [...] } batch format expected by the server.
   */
  async sendEventImmediate(event: BufferedEvent): Promise<Response> {
    const url = `${this.baseUrl}/api/events`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ events: [event] }),
    });
    return response;
  }

  /**
   * Query events from the API server.
   */
  async queryEvents(params: QueryEventsParams): Promise<Response> {
    const searchParams = new URLSearchParams();
    searchParams.set('sessionId', params.sessionId);
    if (params.limit !== undefined) {
      searchParams.set('limit', String(params.limit));
    }
    if (params.eventType) {
      searchParams.set('eventType', params.eventType);
    }

    const url = `${this.baseUrl}/api/events?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    return response;
  }

  /**
   * Flush all buffered events to the API server.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) return;

    this.flushing = true;
    const eventsToFlush = [...this.buffer];
    this.buffer = [];
    this.bufferBytes = 0;

    try {
      // Send events in batches to the API server (same endpoint as immediate)
      const url = `${this.baseUrl}/api/events`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ events: eventsToFlush }),
      });

      if (!response.ok) {
        // Re-buffer events on failure (up to capacity)
        const remaining = MAX_BUFFER_COUNT - this.buffer.length;
        const requeue = eventsToFlush.slice(0, remaining);
        this.buffer.unshift(...requeue);
        for (const event of requeue) {
          this.bufferBytes += JSON.stringify(event).length;
        }
      }
    } catch {
      // Re-buffer events on network failure
      const remaining = MAX_BUFFER_COUNT - this.buffer.length;
      const requeue = eventsToFlush.slice(0, remaining);
      this.buffer.unshift(...requeue);
      for (const event of requeue) {
        this.bufferBytes += JSON.stringify(event).length;
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Get the current number of buffered events (for testing/monitoring).
   */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Get the current buffer size in bytes (for testing/monitoring).
   */
  get bufferedBytes(): number {
    return this.bufferBytes;
  }

  /**
   * Register an agentId for a session (called when session_start succeeds).
   */
  setSessionAgent(sessionId: string, agentId: string): void {
    this.sessionAgentMap.set(sessionId, agentId);
    this.sessionTimestamps.set(sessionId, Date.now());
  }

  /**
   * Retrieve the agentId for a session (returns empty string if unknown).
   */
  getSessionAgent(sessionId: string): string {
    return this.sessionAgentMap.get(sessionId) ?? '';
  }

  /**
   * Remove a session's agentId mapping (called when session_end succeeds).
   */
  clearSessionAgent(sessionId: string): void {
    this.sessionAgentMap.delete(sessionId);
    this.sessionTimestamps.delete(sessionId);
  }

  /**
   * Get the first active agent ID (if any sessions are active).
   * Used by tools that need to know the current agent (e.g. health).
   */
  getFirstActiveAgent(): string | undefined {
    for (const agentId of this.sessionAgentMap.values()) {
      if (agentId) return agentId;
    }
    return undefined;
  }

  // ─── Lesson API methods (Story 3.3) ─────────────────────────

  /**
   * Create a new lesson.
   */
  async createLesson(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/lessons`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  /**
   * List lessons with optional query parameters.
   */
  async getLessons(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const url = `${this.baseUrl}/api/lessons?${searchParams.toString()}`;
    return fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  /**
   * Get a single lesson by ID.
   */
  async getLesson(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/lessons/${encodeURIComponent(id)}`;
    return fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  /**
   * Update an existing lesson.
   */
  async updateLesson(id: string, body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/lessons/${encodeURIComponent(id)}`;
    return fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  // ─── Recall API methods (Story 2.5) ──────────────────────

  /**
   * Perform a semantic recall search.
   */
  async recall(params: {
    query: string;
    scope?: string;
    agentId?: string;
    from?: string;
    to?: string;
    limit?: number;
    minScore?: number;
  }): Promise<Response> {
    const searchParams = new URLSearchParams();
    searchParams.set('query', params.query);
    if (params.scope) searchParams.set('scope', params.scope);
    if (params.agentId) searchParams.set('agentId', params.agentId);
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.minScore !== undefined) searchParams.set('minScore', String(params.minScore));

    const url = `${this.baseUrl}/api/recall?${searchParams.toString()}`;
    return fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  /**
   * Delete (archive) a lesson.
   */
  async deleteLesson(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/lessons/${encodeURIComponent(id)}`;
    return fetch(url, {
      method: 'DELETE',
      headers: this.buildHeaders(),
    });
  }

  // ─── Context API method (Story 5.3) ──────────────────────────

  /**
   * Call the context retrieval endpoint.
   */
  async getContext(params: {
    topic: string;
    userId?: string;
    agentId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<unknown> {
    const searchParams = new URLSearchParams();
    searchParams.set('topic', params.topic);
    if (params.userId) searchParams.set('userId', params.userId);
    if (params.agentId) searchParams.set('agentId', params.agentId);
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));

    const url = `${this.baseUrl}/api/context?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Context API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Optimize API method (Story 2.5) ──────────────────────────

  /**
   * Get cost optimization recommendations.
   */
  async getOptimizationRecommendations(params: {
    period?: number;
    limit?: number;
    agentId?: string;
  } = {}): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (params.period !== undefined) searchParams.set('period', String(params.period));
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.agentId) searchParams.set('agentId', params.agentId);

    const url = `${this.baseUrl}/api/optimize/recommendations?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Optimize API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Reflect API method (Story 4.5) ──────────────────────────

  /**
   * Call the reflect analysis endpoint.
   */
  async reflect(query: {
    analysis: string;
    agentId?: string;
    from?: string;
    to?: string;
    params?: Record<string, unknown>;
    limit?: number;
  }): Promise<unknown> {
    const searchParams = new URLSearchParams();
    searchParams.set('analysis', query.analysis);
    if (query.agentId) searchParams.set('agentId', query.agentId);
    if (query.from) searchParams.set('from', query.from);
    if (query.to) searchParams.set('to', query.to);
    if (query.limit !== undefined) searchParams.set('limit', String(query.limit));

    const url = `${this.baseUrl}/api/reflect?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Reflect API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Health API method (Story 1.5) ────────────────────────────

  /**
   * Get the health score for an agent.
   */
  async getHealth(agentId: string, window?: number): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (window !== undefined) searchParams.set('window', String(window));

    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/health${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Health API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Replay API method (Story 4.1) ─────────────────────────────

  /**
   * Get a replay of a session.
   */
  async replay(
    sessionId: string,
    options?: {
      fromStep?: number;
      toStep?: number;
      eventTypes?: string;
    },
  ): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (options?.fromStep !== undefined) searchParams.set('offset', String(options.fromStep));
    if (options?.toStep !== undefined && options?.fromStep !== undefined) {
      searchParams.set('limit', String(options.toStep - options.fromStep + 1));
    } else if (options?.toStep !== undefined) {
      searchParams.set('limit', String(options.toStep + 1));
    }
    if (options?.eventTypes) searchParams.set('eventTypes', options.eventTypes);

    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/replay${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replay API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Benchmark API methods (Stories 4.2, 4.3) ────────────────────

  /**
   * Create a new benchmark.
   */
  async createBenchmark(body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseUrl}/api/benchmarks`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const respBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`Benchmark API error ${response.status}: ${respBody}`);
    }

    return response.json();
  }

  /**
   * List benchmarks with optional status filter.
   */
  async listBenchmarks(status?: string): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (status) searchParams.set('status', status);

    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/benchmarks${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Benchmark API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  /**
   * Get a single benchmark by ID (with session counts).
   */
  async getBenchmark(benchmarkId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/benchmarks/${encodeURIComponent(benchmarkId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Benchmark API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  /**
   * Get benchmark results (statistical comparison).
   */
  async getBenchmarkResults(benchmarkId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/benchmarks/${encodeURIComponent(benchmarkId)}/results`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Benchmark API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  /**
   * Update benchmark status (start, complete).
   */
  async updateBenchmarkStatus(benchmarkId: string, status: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/benchmarks/${encodeURIComponent(benchmarkId)}/status`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Benchmark API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ─── Content Guardrails (Feature 8) ────────────────────

  /**
   * Evaluate content against guardrail rules via the server API.
   * Fail-open: returns allow on error/timeout.
   */
  async evaluateContent(
    content: string,
    context: { tenantId: string; agentId: string; toolName: string; direction: 'input' | 'output' },
    timeoutMs?: number,
  ): Promise<{ decision: 'allow' | 'block' | 'redact'; matches: unknown[]; blockingRuleId?: string; redactedContent?: string; evaluationMs: number; rulesEvaluated: number }> {
    try {
      const effectiveTimeout = timeoutMs ?? 200;
      const url = `${this.baseUrl}/api/guardrails/evaluate`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ content, context, timeoutMs }),
        signal: AbortSignal.timeout(effectiveTimeout + 100),
      });
      if (!response.ok) {
        return { decision: 'allow', matches: [], evaluationMs: 0, rulesEvaluated: 0 };
      }
      return response.json() as any;
    } catch {
      // Fail-open
      return { decision: 'allow', matches: [], evaluationMs: 0, rulesEvaluated: 0 };
    }
  }

  /** Get the tenant ID from the API key or default */
  getTenantId(): string {
    return 'default';
  }

  // ─── Guardrails (v0.8.0) ──────────────────────────────

  async getGuardrailRules(): Promise<unknown> {
    const url = `${this.baseUrl}/api/guardrails`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Guardrail API error ${response.status}: ${body}`);
    }
    return response.json();
  }

  async getGuardrailStatus(ruleId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/guardrails/${encodeURIComponent(ruleId)}/status`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Guardrail API error ${response.status}: ${body}`);
    }
    return response.json();
  }

  // ─── Community API methods (Story 7.1) ──────────────────────

  async communityShare(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/community/share`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  async communitySearch(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const url = `${this.baseUrl}/api/community/search?${searchParams.toString()}`;
    return fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  async communityRate(body: { lessonId: string; delta: number }): Promise<Response> {
    const url = `${this.baseUrl}/api/community/rate`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  // ─── Discovery API methods (Story 7.1) ─────────────────────

  async discover(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const url = `${this.baseUrl}/api/discovery?${searchParams.toString()}`;
    return fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  // ─── Delegation API methods (Story 7.1) ────────────────────

  async delegate(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/delegations`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  // ─── Server Info / Auto-Discovery (Feature 10, Story 10.3) ───

  async probeCapabilities(): Promise<ServerInfo | null> {
    try {
      const url = `${this.baseUrl}/api/server-info`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as ServerInfo;
    } catch {
      return null;
    }
  }

  // ─── Sessions API (Feature 10, Story 10.6) ───────────────────

  async listSessions(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/sessions${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getSession(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(id)}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getSessionTimeline(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(id)}/timeline`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  // ─── Agents API (Feature 10, Story 10.7) ─────────────────────

  async listAgents(): Promise<Response> {
    const url = `${this.baseUrl}/api/agents`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getAgent(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(id)}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async unpauseAgent(id: string, clearModelOverride?: boolean): Promise<Response> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(id)}/unpause`;
    return fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify({ clearModelOverride: clearModelOverride ?? false }),
    });
  }

  // ─── Alerts API (Feature 10, Story 10.8) ─────────────────────

  async listAlertRules(): Promise<Response> {
    const url = `${this.baseUrl}/api/alerts/rules`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async createAlertRule(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/alerts/rules`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  async updateAlertRule(id: string, body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/alerts/rules/${encodeURIComponent(id)}`;
    return fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  async deleteAlertRule(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/alerts/rules/${encodeURIComponent(id)}`;
    return fetch(url, { method: 'DELETE', headers: this.buildHeaders() });
  }

  async getAlertHistory(params?: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params ?? {});
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/alerts/history${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  // ─── Analytics API (Feature 10, Story 10.9) ──────────────────

  async getAnalytics(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/analytics${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getAnalyticsCosts(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/analytics/costs${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getAnalyticsAgents(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/analytics/agents${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getAnalyticsTools(params: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/analytics/tools${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  // ─── Cost Budgets API (Feature 10, Story 10.10) ──────────────

  async listCostBudgets(params?: Record<string, string>): Promise<Response> {
    const searchParams = new URLSearchParams(params ?? {});
    const qs = searchParams.toString();
    const url = `${this.baseUrl}/api/cost-budgets${qs ? `?${qs}` : ''}`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async createCostBudget(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets`;
    return fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  async updateCostBudget(id: string, body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets/${encodeURIComponent(id)}`;
    return fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  async deleteCostBudget(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets/${encodeURIComponent(id)}`;
    return fetch(url, { method: 'DELETE', headers: this.buildHeaders() });
  }

  async getCostBudgetStatus(id: string): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets/${encodeURIComponent(id)}/status`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getAnomalyConfig(): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets/anomaly/config`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async updateAnomalyConfig(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/api/cost-budgets/anomaly/config`;
    return fetch(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }

  // ─── Stats API (Feature 10, Story 10.12) ─────────────────────

  async getStats(): Promise<Response> {
    const url = `${this.baseUrl}/api/stats`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  async getStatsOverview(): Promise<Response> {
    const url = `${this.baseUrl}/api/stats/overview`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  // ─── Trust API (Feature 10, Story 10.13) ─────────────────────

  async getTrustScore(agentId: string): Promise<Response> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/trust`;
    return fetch(url, { method: 'GET', headers: this.buildHeaders() });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}

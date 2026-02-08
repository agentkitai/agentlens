/**
 * @agentlens/sdk — AgentLensClient
 *
 * Typed HTTP client for the AgentLens REST API.
 * Uses native fetch — works in Node.js ≥ 18 and browsers.
 */

import type {
  EventQuery,
  EventQueryResult,
  AgentLensEvent,
  Session,
  SessionQuery,
} from '@agentlens/core';
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

  // ─── Health ──────────────────────────────────────────────

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

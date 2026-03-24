/**
 * Session query methods — extracted from client.ts (cq-003)
 */

import type {
  Session,
  SessionQuery,
  Agent,
} from '@agentlensai/core';
import { EventMethods } from './events.js';
import type { SessionQueryResult, TimelineResult } from './types.js';

export abstract class SessionMethods extends EventMethods {
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

  /**
   * Get a single agent by ID, including modelOverride and pausedAt.
   */
  async getAgent(agentId: string): Promise<Agent> {
    return this.request<Agent>(
      `/api/agents/${encodeURIComponent(agentId)}`,
    );
  }
}

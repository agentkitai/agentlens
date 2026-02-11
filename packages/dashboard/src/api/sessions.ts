import { request, toQueryString } from './core';
import type { AgentLensEvent, Session, SessionQuery, SessionQueryResult } from './core';

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

export interface SessionReplayData {
  session: Session;
  events: AgentLensEvent[];
  chainValid: boolean;
}

export async function getSessionReplay(id: string): Promise<SessionReplayData> {
  return request<SessionReplayData>(`/api/sessions/${encodeURIComponent(id)}/replay`);
}

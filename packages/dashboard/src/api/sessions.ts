import { request, toQueryString } from './core';
import type { AgentLensEvent, Session, SessionQuery, SessionQueryResult } from './core';
import type { TraceTree } from '@agentkitai/agentlens-core';

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
  /** false ⇒ OTLP/unchained telemetry (record-integrity only, no hash chain). (#119) */
  chained?: boolean;
}

export async function getSessionTimeline(id: string): Promise<SessionTimeline> {
  return request<SessionTimeline>(`/api/sessions/${encodeURIComponent(id)}/timeline`);
}

export interface SessionReplayData {
  session: Session;
  events: AgentLensEvent[];
  chainValid: boolean;
  totalSteps: number;
}

export async function getSessionReplay(id: string): Promise<SessionReplayData> {
  // The server returns a ReplayState ({ session, chainValid, totalSteps, steps[] }),
  // where each event lives under steps[].event — it has no flat `events` array.
  // Flatten it here so the page's `replay.events` reads work.
  const state = await request<{
    session: Session;
    chainValid: boolean;
    totalSteps?: number;
    steps?: Array<{ event: AgentLensEvent }>;
  }>(`/api/sessions/${encodeURIComponent(id)}/replay`);
  const events = (state.steps ?? []).map((s) => s.event);
  return {
    session: state.session,
    chainValid: state.chainValid,
    events,
    totalSteps: state.totalSteps ?? events.length,
  };
}

export interface SessionTrace {
  /** Server-assembled execution tree (#119). */
  tree: TraceTree;
  chainValid: boolean;
  /** false ⇒ OTLP/unchained telemetry (record-integrity only). */
  chained: boolean;
}

export async function getSessionTrace(id: string): Promise<SessionTrace> {
  return request<SessionTrace>(`/api/sessions/${encodeURIComponent(id)}/trace`);
}

import { request, toQueryString } from './core';
import type { EventQuery, EventQueryResult } from './core';

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

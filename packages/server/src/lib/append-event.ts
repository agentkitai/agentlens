/**
 * Append a single new event to a session's hash chain (server-side emit).
 *
 * Used to record server-generated evidence (e.g. compliance eval_result events)
 * into the same tamper-evident audit trail as ingested events. Mirrors the
 * chaining done in routes/events.ts: read the session tail hash, compute this
 * event's hash, insert. insertEvents() re-validates chain continuity inside a
 * transaction, so a concurrent append racing on the same session fails closed
 * with HashChainError rather than forking the chain.
 */

import { computeEventHash, truncatePayload } from '@agentlensai/core';
import type {
  AgentLensEvent,
  EventPayload,
  EventSeverity,
  EventType,
  IEventStore,
} from '@agentlensai/core';
import { nextEventId } from './event-id.js';

export interface AppendEventInput {
  tenantId: string;
  sessionId: string;
  agentId: string;
  eventType: EventType;
  severity: EventSeverity;
  payload: EventPayload;
  metadata?: Record<string, unknown>;
}

export async function appendEventToSession(
  store: IEventStore,
  input: AppendEventInput,
): Promise<AgentLensEvent> {
  const id = nextEventId();
  const timestamp = new Date().toISOString();
  const metadata = input.metadata ?? {};
  const payload = truncatePayload(input.payload) as EventPayload;
  const prevHash = await store.getLastEventHash(input.sessionId);

  const hash = computeEventHash({
    id,
    timestamp,
    sessionId: input.sessionId,
    agentId: input.agentId,
    eventType: input.eventType,
    severity: input.severity,
    payload,
    metadata,
    prevHash,
  });

  const event: AgentLensEvent = {
    id,
    timestamp,
    sessionId: input.sessionId,
    agentId: input.agentId,
    eventType: input.eventType,
    severity: input.severity,
    payload,
    metadata,
    prevHash,
    hash,
    tenantId: input.tenantId,
  };

  await store.insertEvents([event]);
  return event;
}

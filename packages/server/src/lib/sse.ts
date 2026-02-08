/**
 * SSE Connection Manager (Story 14.1, Arch §11.3)
 *
 * Creates a ReadableStream that:
 *  - Subscribes to EventBus with optional filters
 *  - Sends heartbeat every 30s
 *  - Cleans up on client disconnect
 */

import type { AgentLensEvent } from '@agentlensai/core';
import { eventBus } from './event-bus.js';
import type {
  BusEvent,
  EventIngestedEvent,
  SessionUpdatedEvent,
  AlertTriggeredEvent,
} from './event-bus.js';

export interface SSEFilters {
  sessionId?: string;
  agentId?: string;
  eventTypes?: string[];
  tenantId?: string;
}

/** Default heartbeat interval in ms */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Format an SSE message (event: type\ndata: json\n\n)
 */
function formatSSE(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Check if an ingested event matches the SSE filters.
 */
function matchesFilters(event: AgentLensEvent, filters: SSEFilters): boolean {
  if (filters.tenantId && event.tenantId !== filters.tenantId) return false;
  if (filters.sessionId && event.sessionId !== filters.sessionId) return false;
  if (filters.agentId && event.agentId !== filters.agentId) return false;
  if (
    filters.eventTypes &&
    filters.eventTypes.length > 0 &&
    !filters.eventTypes.includes(event.eventType)
  ) {
    return false;
  }
  return true;
}

/**
 * Create a ReadableStream for SSE that subscribes to the EventBus.
 *
 * @param filters — optional filters for sessionId, agentId, eventTypes
 * @param signal — AbortSignal from the request for disconnect cleanup
 */
export function createSSEStream(
  filters: SSEFilters,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(eventName, data)));
        } catch {
          // Controller may be closed if client disconnected
        }
      };

      // Send initial heartbeat so client knows connection is alive
      send('heartbeat', { time: new Date().toISOString() });

      // Heartbeat every 30s to keep connection alive
      const heartbeatTimer = setInterval(() => {
        send('heartbeat', { time: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);

      // Handler for all bus events
      const handler = (busEvent: BusEvent) => {
        switch (busEvent.type) {
          case 'event_ingested': {
            const ev = (busEvent as EventIngestedEvent).event;
            if (matchesFilters(ev, filters)) {
              send('event', ev);
            }
            break;
          }
          case 'session_updated': {
            const session = (busEvent as SessionUpdatedEvent).session;
            // Session updates are sent if:
            //   - Matching tenantId (if filtered)
            //   - No sessionId filter, or matching sessionId
            //   - No agentId filter, or matching agentId
            if (filters.tenantId && session.tenantId !== filters.tenantId) break;
            if (filters.sessionId && session.id !== filters.sessionId) break;
            if (filters.agentId && session.agentId !== filters.agentId) break;
            send('session_update', session);
            break;
          }
          case 'alert_triggered': {
            const alert = busEvent as AlertTriggeredEvent;
            // Alerts are tenant-scoped if filter is set
            if (filters.tenantId && alert.rule.tenantId !== filters.tenantId) break;
            send('alert', {
              ruleId: alert.rule.id,
              name: alert.rule.name,
              currentValue: alert.history.currentValue,
              threshold: alert.history.threshold,
              message: alert.history.message,
              triggeredAt: alert.history.triggeredAt,
            });
            break;
          }
          // alert_resolved is informational, not critical for SSE
          default:
            break;
        }
      };

      // Subscribe to all bus events
      eventBus.on('*', handler);

      // Cleanup on client disconnect
      const cleanup = () => {
        clearInterval(heartbeatTimer);
        eventBus.off('*', handler);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      signal.addEventListener('abort', cleanup, { once: true });
    },
  });
}

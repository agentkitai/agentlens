/**
 * In-process EventBus for real-time notifications (Story 12.5, Epic 14 — Arch §11.1)
 *
 * Typed EventEmitter for decoupled communication between
 * server components. Consumed by SSE endpoint (Epic 14) and Alert Engine (Epic 12).
 */

import { EventEmitter } from 'node:events';
import type { AgentLensEvent, AlertRule, AlertHistory, Session } from '@agentlens/core';

// ─── Bus Event Types ─────────────────────────────────────────────

export interface AlertTriggeredEvent {
  type: 'alert_triggered';
  rule: AlertRule;
  history: AlertHistory;
  timestamp: string;
}

export interface AlertResolvedEvent {
  type: 'alert_resolved';
  ruleId: string;
  historyId: string;
  timestamp: string;
}

/** New event ingested (Epic 14 — Story 14.1) */
export interface EventIngestedEvent {
  type: 'event_ingested';
  event: AgentLensEvent;
  timestamp: string;
}

/** Session updated (Epic 14 — Story 14.1) */
export interface SessionUpdatedEvent {
  type: 'session_updated';
  session: Session;
  timestamp: string;
}

export type BusEvent =
  | AlertTriggeredEvent
  | AlertResolvedEvent
  | EventIngestedEvent
  | SessionUpdatedEvent;

/**
 * Typed event bus for internal server communication.
 * Wraps Node.js EventEmitter with type safety.
 */
class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE clients
    this.emitter.setMaxListeners(1000);
  }

  emit(event: BusEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // wildcard for "all events"
  }

  on(type: BusEvent['type'] | '*', listener: (event: BusEvent) => void): void {
    this.emitter.on(type, listener);
  }

  off(type: BusEvent['type'] | '*', listener: (event: BusEvent) => void): void {
    this.emitter.off(type, listener);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

/** Singleton event bus instance */
export const eventBus = new EventBus();

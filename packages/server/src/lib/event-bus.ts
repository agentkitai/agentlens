/**
 * In-process EventBus for real-time notifications (Story 12.5, Arch §11.1)
 *
 * Simple typed EventEmitter for decoupled communication between
 * server components. Will be consumed by SSE endpoint (Epic 14).
 */

import { EventEmitter } from 'node:events';
import type { AlertRule, AlertHistory } from '@agentlens/core';

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

export type BusEvent = AlertTriggeredEvent | AlertResolvedEvent;

/**
 * Typed event bus for internal server communication.
 * Wraps Node.js EventEmitter with type safety.
 */
class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE clients
    this.emitter.setMaxListeners(100);
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

/**
 * @agentlens/core — Event Creation Helpers
 *
 * Factory functions for creating events with proper defaults.
 */
import { ulid } from 'ulid';
import type { AgentLensEvent, EventType, EventSeverity, EventPayload } from './types.js';
import { computeEventHash } from './hash.js';
import { MAX_PAYLOAD_SIZE } from './constants.js';

/**
 * Options for creating an event
 */
export interface CreateEventOptions {
  /** Session this event belongs to */
  sessionId: string;
  /** Agent that produced this event */
  agentId: string;
  /** Event type */
  eventType: EventType;
  /** Event payload */
  payload: EventPayload;
  /** Severity level (defaults to 'info') */
  severity?: EventSeverity;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
  /** Hash of the previous event in the session chain (null for first event) */
  prevHash?: string | null;
  /** Optional client-provided timestamp (defaults to now) */
  timestamp?: string;
}

/**
 * Create a fully-formed AgentLensEvent with generated ULID id,
 * ISO timestamp, default severity, and computed hash.
 *
 * @param options - Event creation options
 * @returns A complete AgentLensEvent ready for persistence
 */
export function createEvent(options: CreateEventOptions): AgentLensEvent {
  const id = ulid();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const severity = options.severity ?? 'info';
  const metadata = options.metadata ?? {};
  const prevHash = options.prevHash ?? null;

  // Truncate payload if needed
  const payload = truncatePayload(options.payload);

  const hash = computeEventHash({
    id,
    timestamp,
    sessionId: options.sessionId,
    agentId: options.agentId,
    eventType: options.eventType,
    severity,
    payload,
    metadata,
    prevHash,
  });

  return {
    id,
    timestamp,
    sessionId: options.sessionId,
    agentId: options.agentId,
    eventType: options.eventType,
    severity,
    payload,
    metadata,
    prevHash,
    hash,
  };
}

/**
 * Truncate a payload if its JSON serialization exceeds MAX_PAYLOAD_SIZE.
 *
 * When truncated, the payload is replaced with a summary object containing
 * a `_truncated: true` flag and the original size.
 *
 * @param payload - The event payload to potentially truncate
 * @returns The original payload or a truncated version
 */
export function truncatePayload(payload: EventPayload): EventPayload {
  const serialized = JSON.stringify(payload);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength <= MAX_PAYLOAD_SIZE) {
    return payload;
  }

  return {
    type: '_truncated',
    data: {
      _truncated: true,
      originalSize: byteLength,
      maxSize: MAX_PAYLOAD_SIZE,
      preview: serialized.slice(0, 200) + '...',
    },
  } as EventPayload;
}

/**
 * API Gateway Service (S-3.2)
 *
 * Ingestion endpoints:
 *   POST /v1/events       — single event
 *   POST /v1/events/batch — up to 100 events
 *
 * Flow: Auth → Validate → Enrich → Publish to queue → 202 Accepted
 */

import { randomUUID } from 'crypto';
import type { EventQueue, QueuedEvent } from './event-queue.js';
import { BACKPRESSURE_THRESHOLD } from './event-queue.js';
import type { ApiKeyAuthContext } from '../auth/api-key-middleware.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

/** Raw event from SDK */
export interface IncomingEvent {
  id?: string;
  type: string;
  timestamp?: string;
  session_id: string;
  data?: Record<string, unknown>;
}

export interface SingleEventRequest {
  event: IncomingEvent;
}

export interface BatchEventRequest {
  events: IncomingEvent[];
}

export interface BatchEventResponse {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
  request_id: string;
}

export interface SingleEventResponse {
  accepted: boolean;
  request_id: string;
}

export interface ValidationError {
  index: number;
  error: string;
}

// ═══════════════════════════════════════════
// Known event types
// ═══════════════════════════════════════════

const KNOWN_EVENT_TYPES = new Set([
  'llm_call',
  'tool_use',
  'agent_action',
  'error',
  'session_start',
  'session_end',
  'guardrail',
  'benchmark',
  'custom',
  'health_check',
  'lesson',
  'embedding',
]);

// ═══════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════

export function validateEvent(event: unknown, index: number): ValidationError | null {
  if (!event || typeof event !== 'object') {
    return { index, error: 'event must be an object' };
  }

  const e = event as Record<string, unknown>;

  if (!e.type || typeof e.type !== 'string') {
    return { index, error: 'missing required field: type' };
  }

  if (!KNOWN_EVENT_TYPES.has(e.type)) {
    return { index, error: `unknown event type: ${e.type}` };
  }

  if (!e.session_id || typeof e.session_id !== 'string') {
    return { index, error: 'missing required field: session_id' };
  }

  if (e.timestamp !== undefined) {
    const ts = new Date(e.timestamp as string);
    if (isNaN(ts.getTime())) {
      return { index, error: 'invalid timestamp format' };
    }
    // Reject timestamps more than 5 minutes in the future
    if (ts.getTime() > Date.now() + 5 * 60 * 1000) {
      return { index, error: 'timestamp in future' };
    }
  }

  if (e.data !== undefined && (typeof e.data !== 'object' || e.data === null || Array.isArray(e.data))) {
    return { index, error: 'data must be an object' };
  }

  return null;
}

// ═══════════════════════════════════════════
// Enrichment
// ═══════════════════════════════════════════

function enrichEvent(
  event: IncomingEvent,
  auth: ApiKeyAuthContext,
  requestId: string,
): QueuedEvent {
  return {
    id: event.id ?? randomUUID(),
    type: event.type,
    timestamp: event.timestamp ?? new Date().toISOString(),
    session_id: event.session_id,
    data: event.data ?? {},
    org_id: auth.orgId,
    api_key_id: auth.keyId,
    received_at: new Date().toISOString(),
    request_id: requestId,
  };
}

// ═══════════════════════════════════════════
// Gateway Service
// ═══════════════════════════════════════════

export class IngestionGateway {
  constructor(private queue: EventQueue) {}

  /**
   * POST /v1/events — ingest a single event
   */
  async ingestSingle(
    event: unknown,
    auth: ApiKeyAuthContext,
  ): Promise<{ status: number; body: SingleEventResponse | { error: string }; requestId: string }> {
    const requestId = randomUUID();

    // Check backpressure
    const streamLen = await this.queue.getStreamLength();
    if (streamLen >= BACKPRESSURE_THRESHOLD) {
      return {
        status: 503,
        body: { error: 'Service temporarily unavailable. Retry later.' } as { error: string },
        requestId,
      };
    }

    // Validate
    const error = validateEvent(event, 0);
    if (error) {
      return {
        status: 400,
        body: { error: error.error } as { error: string },
        requestId,
      };
    }

    // Check ingest scope
    if (!auth.scopes.includes('ingest')) {
      return {
        status: 403,
        body: { error: 'API key does not have ingest scope' } as { error: string },
        requestId,
      };
    }

    // Enrich & publish
    const enriched = enrichEvent(event as IncomingEvent, auth, requestId);
    await this.queue.publish(enriched);

    return {
      status: 202,
      body: { accepted: true, request_id: requestId },
      requestId,
    };
  }

  /**
   * POST /v1/events/batch — ingest up to 100 events
   */
  async ingestBatch(
    events: unknown,
    auth: ApiKeyAuthContext,
  ): Promise<{ status: number; body: BatchEventResponse | { error: string }; requestId: string }> {
    const requestId = randomUUID();

    // Must be array
    if (!Array.isArray(events)) {
      return {
        status: 400,
        body: { error: 'events must be an array' } as { error: string },
        requestId,
      };
    }

    // Max 100
    if (events.length > 100) {
      return {
        status: 400,
        body: { error: 'batch size exceeds maximum of 100 events' } as { error: string },
        requestId,
      };
    }

    if (events.length === 0) {
      return {
        status: 400,
        body: { error: 'events array must not be empty' } as { error: string },
        requestId,
      };
    }

    // Check ingest scope
    if (!auth.scopes.includes('ingest')) {
      return {
        status: 403,
        body: { error: 'API key does not have ingest scope' } as { error: string },
        requestId,
      };
    }

    // Check backpressure
    const streamLen = await this.queue.getStreamLength();
    if (streamLen >= BACKPRESSURE_THRESHOLD) {
      return {
        status: 503,
        body: { error: 'Service temporarily unavailable. Retry later.' } as { error: string },
        requestId,
      };
    }

    // Validate each event
    const errors: ValidationError[] = [];
    const valid: QueuedEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const err = validateEvent(events[i], i);
      if (err) {
        errors.push(err);
      } else {
        valid.push(enrichEvent(events[i] as IncomingEvent, auth, requestId));
      }
    }

    // Publish valid events
    if (valid.length > 0) {
      await this.queue.publishBatch(valid);
    }

    return {
      status: 202,
      body: {
        accepted: valid.length,
        rejected: errors.length,
        errors,
        request_id: requestId,
      },
      requestId,
    };
  }
}

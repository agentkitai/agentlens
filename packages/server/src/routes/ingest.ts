/**
 * Webhook Ingestion Endpoint (Stories 9.1, 10.1, 10.2, 10.3)
 *
 * POST /api/events/ingest — receives webhooks from AgentGate, FormBridge, or generic sources.
 *
 * Each source is verified using HMAC-SHA256 with a per-source secret.
 * Events are mapped to AgentLens event types and persisted via the standard pipeline.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ulid } from 'ulid';
import { computeEventHash, truncatePayload } from '@agentlens/core';
import type {
  AgentLensEvent,
  EventType,
  EventPayload,
  FormSubmittedPayload,
  FormCompletedPayload,
  FormExpiredPayload,
  ApprovalRequestedPayload,
  ApprovalDecisionPayload,
} from '@agentlens/core';
import type { IEventStore } from '@agentlens/core';

// ─── Types ──────────────────────────────────────────────────────────

export type WebhookSource = 'agentgate' | 'formbridge' | 'generic';

export interface WebhookPayload {
  source: WebhookSource;
  event: string;
  data: Record<string, unknown>;
  timestamp?: string;
  context?: Record<string, unknown>;
}

export interface IngestConfig {
  /** HMAC secret for AgentGate webhooks */
  agentgateWebhookSecret?: string;
  /** HMAC secret for FormBridge webhooks */
  formbridgeWebhookSecret?: string;
}

// ─── Signature Verification ─────────────────────────────────────────

/**
 * Verify HMAC-SHA256 webhook signature using timing-safe comparison.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  // Ensure buffers are equal length for timingSafeEqual
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}

// ─── AgentGate Event Mapping ────────────────────────────────────────

const AGENTGATE_EVENT_MAP: Record<string, EventType> = {
  'request.created': 'approval_requested',
  'request.approved': 'approval_granted',
  'request.denied': 'approval_denied',
  'request.expired': 'approval_expired',
};

function mapAgentGateEvent(
  webhookEvent: string,
  data: Record<string, unknown>,
): { eventType: EventType; payload: EventPayload } | null {
  const eventType = AGENTGATE_EVENT_MAP[webhookEvent];
  if (!eventType) return null;

  if (eventType === 'approval_requested') {
    const payload: ApprovalRequestedPayload = {
      requestId: String(data['requestId'] ?? data['id'] ?? ''),
      action: String(data['action'] ?? ''),
      params: (data['params'] as Record<string, unknown>) ?? {},
      urgency: String(data['urgency'] ?? 'normal'),
    };
    return { eventType, payload };
  }

  // approval_granted, approval_denied, approval_expired
  const payload: ApprovalDecisionPayload = {
    requestId: String(data['requestId'] ?? data['id'] ?? ''),
    action: String(data['action'] ?? ''),
    decidedBy: String(data['decidedBy'] ?? data['approvedBy'] ?? data['deniedBy'] ?? 'system'),
    reason: data['reason'] ? String(data['reason']) : undefined,
  };
  return { eventType, payload };
}

// ─── FormBridge Event Mapping (Story 10.2) ──────────────────────────

const FORMBRIDGE_EVENT_MAP: Record<string, EventType> = {
  'submission.created': 'form_submitted',
  'submission.completed': 'form_completed',
  'submission.expired': 'form_expired',
};

function mapFormBridgeEvent(
  webhookEvent: string,
  data: Record<string, unknown>,
): { eventType: EventType; payload: EventPayload } | null {
  const eventType = FORMBRIDGE_EVENT_MAP[webhookEvent];
  if (!eventType) return null;

  if (eventType === 'form_submitted') {
    const payload: FormSubmittedPayload = {
      submissionId: String(data['submissionId'] ?? data['id'] ?? ''),
      formId: String(data['formId'] ?? ''),
      formName: data['formName'] ? String(data['formName']) : undefined,
      fieldCount: typeof data['fieldCount'] === 'number' ? data['fieldCount'] : 0,
    };
    return { eventType, payload };
  }

  if (eventType === 'form_completed') {
    const payload: FormCompletedPayload = {
      submissionId: String(data['submissionId'] ?? data['id'] ?? ''),
      formId: String(data['formId'] ?? ''),
      completedBy: String(data['completedBy'] ?? 'unknown'),
      durationMs: typeof data['durationMs'] === 'number' ? data['durationMs'] : 0,
    };
    return { eventType, payload };
  }

  if (eventType === 'form_expired') {
    const payload: FormExpiredPayload = {
      submissionId: String(data['submissionId'] ?? data['id'] ?? ''),
      formId: String(data['formId'] ?? ''),
      expiredAfterMs: typeof data['expiredAfterMs'] === 'number' ? data['expiredAfterMs'] : 0,
    };
    return { eventType, payload };
  }

  return null;
}

// ─── Generic Event Mapping ──────────────────────────────────────────

function mapGenericEvent(
  data: Record<string, unknown>,
): { eventType: EventType; payload: EventPayload } {
  return {
    eventType: (data['eventType'] as EventType) ?? 'custom',
    payload: {
      type: String(data['type'] ?? 'generic'),
      data: (data['data'] as Record<string, unknown>) ?? data,
    },
  };
}

// ─── Session Correlation (Story 10.3) ───────────────────────────────

/**
 * Extract session ID and agent ID from webhook context.
 * Falls back to generating an unlinked session ID if not present.
 */
function extractCorrelation(context?: Record<string, unknown>): {
  sessionId: string;
  agentId: string;
} {
  const sessionId = context?.['agentlens_session_id']
    ? String(context['agentlens_session_id'])
    : `unlinked_${ulid()}`;

  const agentId = context?.['agentlens_agent_id']
    ? String(context['agentlens_agent_id'])
    : context?.['agent_id']
    ? String(context['agent_id'])
    : 'external';

  return { sessionId, agentId };
}

// ─── Secret Resolver ────────────────────────────────────────────────

function getSecretForSource(
  source: WebhookSource,
  config: IngestConfig,
): string | undefined {
  switch (source) {
    case 'agentgate':
      return config.agentgateWebhookSecret;
    case 'formbridge':
      return config.formbridgeWebhookSecret;
    case 'generic':
      return undefined; // Generic webhooks don't require HMAC
  }
}

// ─── Route Factory ──────────────────────────────────────────────────

export function ingestRoutes(store: IEventStore, config: IngestConfig) {
  const app = new Hono();

  /**
   * POST /api/events/ingest — Webhook ingestion endpoint.
   *
   * Accepts JSON body with:
   *   source: 'agentgate' | 'formbridge' | 'generic'
   *   event:  source-specific event name
   *   data:   event payload
   *   timestamp?: ISO 8601
   *   context?: { agentlens_session_id?, agentlens_agent_id?, ... }
   *
   * Signature header: X-Webhook-Signature (HMAC-SHA256 hex)
   */
  app.post('/', async (c) => {
    // Read raw body for signature verification
    const rawBody = await c.req.text();

    let body: WebhookPayload;
    try {
      body = JSON.parse(rawBody) as WebhookPayload;
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    // Validate source
    const source = body.source;
    if (!source || !['agentgate', 'formbridge', 'generic'].includes(source)) {
      return c.json({
        error: 'Invalid or missing source. Expected: agentgate, formbridge, or generic',
        status: 400,
      }, 400);
    }

    // Verify signature for agentgate/formbridge
    const secret = getSecretForSource(source, config);
    if (source !== 'generic') {
      if (!secret) {
        return c.json({
          error: `Webhook secret not configured for source: ${source}`,
          status: 500,
        }, 500);
      }

      const signature = c.req.header('X-Webhook-Signature') ?? '';
      if (!verifyWebhookSignature(rawBody, signature, secret)) {
        return c.json({ error: 'Invalid webhook signature', status: 401 }, 401);
      }
    }

    // Validate required fields
    if (!body.event) {
      return c.json({ error: 'Missing event field', status: 400 }, 400);
    }
    if (!body.data || typeof body.data !== 'object') {
      return c.json({ error: 'Missing or invalid data field', status: 400 }, 400);
    }

    // Map webhook event to AgentLens event
    let mapped: { eventType: EventType; payload: EventPayload } | null = null;

    switch (source) {
      case 'agentgate':
        mapped = mapAgentGateEvent(body.event, body.data);
        break;
      case 'formbridge':
        mapped = mapFormBridgeEvent(body.event, body.data);
        break;
      case 'generic':
        mapped = mapGenericEvent(body.data);
        break;
    }

    if (!mapped) {
      return c.json({
        error: `Unknown event type '${body.event}' for source '${source}'`,
        status: 400,
      }, 400);
    }

    // Extract session/agent correlation
    const { sessionId, agentId } = extractCorrelation(body.context);

    // Build the AgentLens event
    const id = ulid();
    const timestamp = body.timestamp ?? new Date().toISOString();
    const metadata: Record<string, unknown> = {
      source,
      webhookEvent: body.event,
      ...(body.context ?? {}),
    };

    // Get last hash for session chain
    const timeline = await store.getSessionTimeline(sessionId);
    const prevHash = timeline.length > 0 ? timeline[timeline.length - 1]!.hash : null;

    const payload = truncatePayload(mapped.payload);

    const hash = computeEventHash({
      id,
      timestamp,
      sessionId,
      agentId,
      eventType: mapped.eventType,
      severity: 'info',
      payload,
      metadata,
      prevHash,
    });

    const event: AgentLensEvent = {
      id,
      timestamp,
      sessionId,
      agentId,
      eventType: mapped.eventType,
      severity: 'info',
      payload,
      metadata,
      prevHash,
      hash,
    };

    // Persist
    await store.insertEvents([event]);

    return c.json({
      ok: true,
      eventId: event.id,
      eventType: event.eventType,
      sessionId,
    }, 201);
  });

  return app;
}

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
import { computeEventHash, truncatePayload } from '@agentkitai/agentlens-core';
import { nextEventId } from '../lib/event-id.js';
import type {
  AgentLensEvent,
  EventType,
  EventPayload,
  FormSubmittedPayload,
  FormCompletedPayload,
  FormExpiredPayload,
  ApprovalRequestedPayload,
  ApprovalDecisionPayload,
} from '@agentkitai/agentlens-core';
import type { IEventStore } from '@agentkitai/agentlens-core';
import type { SqliteEventStore } from '../db/sqlite-store.js';
import { TenantScopedStore } from '../db/tenant-scoped-store.js';
import { stripVerifiedAgentKeys } from '../lib/agent-identity.js';
import { eventBus } from '../lib/event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────

export type WebhookSource = 'agentgate' | 'formbridge' | 'generic';

export interface WebhookPayload {
  source: WebhookSource;
  event: string;
  data: Record<string, unknown>;
  timestamp?: string;
  context?: Record<string, unknown>;
}

/** A secret may be a fixed string or a resolver read per-request (e.g. from the
 *  config store, so a secret set in the Settings UI takes effect without a restart). */
export type SecretSource = string | (() => string | undefined);

export interface IngestConfig {
  /** HMAC secret for AgentGate webhooks */
  agentgateWebhookSecret?: SecretSource;
  /** HMAC secret for FormBridge webhooks */
  formbridgeWebhookSecret?: SecretSource;
  /** Tenant ID for AgentGate webhooks (defaults to 'default') */
  agentgateTenantId?: string;
  /** Tenant ID for FormBridge webhooks (defaults to 'default') */
  formbridgeTenantId?: string;
  /** Tenant ID for generic webhooks (defaults to 'default') */
  genericTenantId?: string;
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

// ─── Source + signature resolution ──────────────────────────────────
// The real AgentKit products don't send the canonical `{source,event,data}` +
// `X-Webhook-Signature` envelope: AgentGate signs with `X-AgentGate-Signature`
// (raw hex) and omits `source`; FormBridge signs with `X-FormBridge-Signature:
// sha256=<hex>`. Accept those natively while keeping the canonical path working.

const VALID_SOURCES: WebhookSource[] = ['agentgate', 'formbridge', 'generic'];

const SIGNATURE_HEADERS: Array<{ header: string; source: WebhookSource }> = [
  { header: 'X-Webhook-Signature', source: 'generic' },
  { header: 'X-AgentGate-Signature', source: 'agentgate' },
  { header: 'X-FormBridge-Signature', source: 'formbridge' },
];

type GetHeader = (name: string) => string | undefined;

/** First present signature header value, with any `sha256=` prefix stripped. */
export function resolveSignature(getHeader: GetHeader): string {
  for (const { header } of SIGNATURE_HEADERS) {
    const v = getHeader(header);
    if (v) return v.startsWith('sha256=') ? v.slice('sha256='.length) : v;
  }
  return '';
}

/**
 * Resolve the webhook source: explicit `body.source` wins (canonical path); else
 * infer from which product's signature header is present; else from the
 * event-name prefix (`request.*` → agentgate, `submission.*` → formbridge).
 */
export function resolveSource(
  body: { source?: unknown; event?: unknown },
  getHeader: GetHeader,
): WebhookSource | null {
  if (typeof body.source === 'string' && (VALID_SOURCES as string[]).includes(body.source)) {
    return body.source as WebhookSource;
  }
  for (const { header, source } of SIGNATURE_HEADERS) {
    if (source !== 'generic' && getHeader(header)) return source;
  }
  const ev = typeof body.event === 'string' ? body.event : '';
  if (ev.startsWith('request.')) return 'agentgate';
  if (ev.startsWith('submission.')) return 'formbridge';
  return null;
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

// Real FormBridge (formbridge/src/core/webhook-manager.ts buildPayload) posts the
// FLAT submission — no `event`/`data`/`source` envelope, just the submission with
// its current `state`. The AgentLens event is DERIVED from that state.
const FB_COMPLETED_STATES = new Set(['submitted', 'finalized', 'approved']);
const FB_EXPIRED_STATES = new Set(['expired', 'cancelled', 'rejected']);

interface FormBridgeSubmissionBody {
  submissionId?: unknown;
  intakeId?: unknown;
  state?: unknown;
  fields?: unknown;
  metadata?: { createdAt?: unknown; updatedAt?: unknown; createdBy?: unknown };
}

/** True when the body looks like FormBridge's flat submission (no envelope). */
function isFormBridgeSubmissionBody(body: { event?: unknown; submissionId?: unknown; state?: unknown }): boolean {
  return body.event === undefined && typeof body.submissionId === 'string' && typeof body.state === 'string';
}

function mapFormBridgeSubmission(
  body: FormBridgeSubmissionBody,
): { eventType: EventType; payload: EventPayload; createdBy?: string } | null {
  const submissionId = String(body.submissionId ?? '');
  if (!submissionId) return null;
  const formId = String(body.intakeId ?? '');
  const state = String(body.state ?? '');
  const createdAt = typeof body.metadata?.createdAt === 'string' ? Date.parse(body.metadata.createdAt) : NaN;
  const updatedAt = typeof body.metadata?.updatedAt === 'string' ? Date.parse(body.metadata.updatedAt) : NaN;
  const elapsedMs = Number.isFinite(createdAt) && Number.isFinite(updatedAt) ? Math.max(0, updatedAt - createdAt) : 0;
  const createdBy = body.metadata?.createdBy ? String(body.metadata.createdBy) : undefined;

  if (FB_COMPLETED_STATES.has(state)) {
    const payload: FormCompletedPayload = { submissionId, formId, completedBy: createdBy ?? 'unknown', durationMs: elapsedMs };
    return { eventType: 'form_completed', payload, createdBy };
  }
  if (FB_EXPIRED_STATES.has(state)) {
    const payload: FormExpiredPayload = { submissionId, formId, expiredAfterMs: elapsedMs };
    return { eventType: 'form_expired', payload, createdBy };
  }
  const fieldCount = body.fields && typeof body.fields === 'object' ? Object.keys(body.fields as object).length : 0;
  const payload: FormSubmittedPayload = { submissionId, formId, fieldCount };
  return { eventType: 'form_submitted', payload, createdBy };
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

function resolveSecret(s?: SecretSource): string | undefined {
  return typeof s === 'function' ? s() : s;
}

function getSecretForSource(
  source: WebhookSource,
  config: IngestConfig,
): string | undefined {
  switch (source) {
    case 'agentgate':
      return resolveSecret(config.agentgateWebhookSecret);
    case 'formbridge':
      return resolveSecret(config.formbridgeWebhookSecret);
    case 'generic':
      return undefined; // Generic webhooks don't require HMAC
  }
}

// ─── Tenant Resolver ────────────────────────────────────────────────

function getTenantIdForSource(
  source: WebhookSource,
  config: IngestConfig,
): string {
  switch (source) {
    case 'agentgate':
      return config.agentgateTenantId ?? 'default';
    case 'formbridge':
      return config.formbridgeTenantId ?? 'default';
    case 'generic':
      return config.genericTenantId ?? 'default';
  }
}

// ─── Route Factory ──────────────────────────────────────────────────

export function ingestRoutes(store: IEventStore, config: IngestConfig) {
  const app = new Hono();

  // Cast to SqliteEventStore for TenantScopedStore wrapping.
  // IEventStore is the interface but we need the concrete type for the tenant wrapper.
  const innerStore = store as SqliteEventStore;

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

    // Resolve source — explicit body.source, or inferred from the product's
    // signature header / event-name prefix (real webhooks omit `source`).
    const getHeader: GetHeader = (name) => c.req.header(name);
    const source = resolveSource(body, getHeader);
    if (!source) {
      return c.json({
        error: 'Invalid or missing source. Expected source agentgate/formbridge/generic, ' +
          'or an X-AgentGate-Signature / X-FormBridge-Signature header.',
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

      const signature = resolveSignature(getHeader);
      if (!verifyWebhookSignature(rawBody, signature, secret)) {
        return c.json({ error: 'Invalid webhook signature', status: 401 }, 401);
      }
    }

    // Map the webhook to an AgentLens event. FormBridge's real webhook is a flat
    // submission with no event/data envelope, so map it from the submission state;
    // everything else uses the canonical {event, data} envelope.
    let mapped: { eventType: EventType; payload: EventPayload } | null = null;
    let fbCreatedBy: string | undefined;

    if (source === 'formbridge' && isFormBridgeSubmissionBody(body as unknown as Record<string, unknown>)) {
      const m = mapFormBridgeSubmission(body as unknown as FormBridgeSubmissionBody);
      if (m) {
        mapped = { eventType: m.eventType, payload: m.payload };
        fbCreatedBy = m.createdBy;
      }
    } else {
      if (!body.event) {
        return c.json({ error: 'Missing event field', status: 400 }, 400);
      }
      if (!body.data || typeof body.data !== 'object') {
        return c.json({ error: 'Missing or invalid data field', status: 400 }, 400);
      }
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
    }

    if (!mapped) {
      return c.json({
        error: `Unknown or unmappable event for source '${source}'`,
        status: 400,
      }, 400);
    }

    // Resolve tenant ID from webhook source configuration
    const tenantId = getTenantIdForSource(source, config);
    const tenantStore = new TenantScopedStore(innerStore, tenantId);

    // Extract session/agent correlation. FormBridge's flat payload carries no
    // context, so fall back to the submission's createdBy as the agent id.
    const correlation = extractCorrelation(body.context);
    const sessionId = correlation.sessionId;
    const agentId = correlation.agentId === 'external' && fbCreatedBy ? fbCreatedBy : correlation.agentId;

    // Build the AgentLens event
    const id = nextEventId();
    const timestamp = body.timestamp ?? new Date().toISOString();
    // body.context is caller-supplied; strip the reserved verified-agent keys so
    // a webhook can never forge a verifiedAgentId into the audit trail (#12). The
    // webhook never STAMPS one — only POST /api/events does, after verifying an
    // agent token. HMAC here proves the source, not the agent's identity.
    const metadata: Record<string, unknown> = stripVerifiedAgentKeys({
      source,
      webhookEvent: body.event,
      ...(body.context ?? {}),
    });

    // Get last hash for session chain (optimized — only fetches last event's hash)
    const prevHash = await tenantStore.getLastEventHash(sessionId);

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
      tenantId,
    };

    // Persist via tenant-scoped store (stamps tenantId on insert)
    await tenantStore.insertEvents([event]);

    // Emit to EventBus for SSE fan-out (async, non-blocking)
    const emitTimestamp = new Date().toISOString();
    eventBus.emit({ type: 'event_ingested', event, timestamp: emitTimestamp });

    // Emit session update
    const updatedSession = await tenantStore.getSession(sessionId);
    if (updatedSession) {
      eventBus.emit({ type: 'session_updated', session: updatedSession, timestamp: emitTimestamp });
    }

    return c.json({
      ok: true,
      eventId: event.id,
      eventType: event.eventType,
      sessionId,
    }, 201);
  });

  return app;
}

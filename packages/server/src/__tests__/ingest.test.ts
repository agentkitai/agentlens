/**
 * Tests for Stories 10.1, 10.2, 10.3: FormBridge Webhook Integration
 *
 * Also covers AgentGate webhook integration (Story 9.1, 9.2, 9.3) via the
 * shared ingest endpoint for completeness.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { createTestDb, type SqliteDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { ingestRoutes, verifyWebhookSignature } from '../routes/ingest.js';

// ─── Helpers ─────────────────────────────────────────────────────────

const FB_SECRET = 'formbridge-test-secret-abc123';
const AG_SECRET = 'agentgate-test-secret-xyz789';

interface TestCtx {
  app: Hono;
  store: SqliteEventStore;
  db: SqliteDb;
}

function setup(): TestCtx {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);
  const app = new Hono();
  app.route(
    '/',
    ingestRoutes(store, {
      formbridgeWebhookSecret: FB_SECRET,
      agentgateWebhookSecret: AG_SECRET,
    }),
  );
  return { app, store, db };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makeRequest(
  app: Hono,
  body: Record<string, unknown>,
  opts?: { secret?: string; signatureHeader?: string },
) {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts?.signatureHeader !== undefined) {
    headers['X-Webhook-Signature'] = opts.signatureHeader;
  } else if (opts?.secret) {
    headers['X-Webhook-Signature'] = sign(rawBody, opts.secret);
  }

  return app.request('/', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

// ─── verifyWebhookSignature unit tests ───────────────────────────────

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const payload = '{"test": true}';
    const secret = 'mysecret';
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    expect(verifyWebhookSignature('data', 'wrong', 'secret')).toBe(false);
  });

  it('returns false for empty signature', () => {
    expect(verifyWebhookSignature('data', '', 'secret')).toBe(false);
  });

  it('returns false for empty secret', () => {
    expect(verifyWebhookSignature('data', 'sig', '')).toBe(false);
  });
});

// ─── FormBridge Webhook Receiver (Story 10.1) ────────────────────────

describe('FormBridge Webhook Receiver — POST /api/events/ingest (Story 10.1)', () => {
  it('accepts a formbridge webhook with valid HMAC signature', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_001',
          formId: 'form_001',
          formName: 'Contact Form',
          fieldCount: 5,
        },
        context: { agentlens_session_id: 'sess_100' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.eventType).toBe('form_submitted');
    expect(body.sessionId).toBe('sess_100');
  });

  it('rejects formbridge webhook with invalid signature', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: { submissionId: 'sub_001', formId: 'form_001', fieldCount: 3 },
      },
      { signatureHeader: 'invalid_signature_hex' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it('rejects formbridge webhook with missing signature', async () => {
    const { app } = setup();

    const res = await makeRequest(app, {
      source: 'formbridge',
      event: 'submission.created',
      data: { submissionId: 'sub_001', formId: 'form_001', fieldCount: 3 },
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid source', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      { source: 'unknown', event: 'test', data: {} },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/source/i);
  });

  it('returns 400 for missing event field', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      { source: 'formbridge', data: {} },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const { app } = setup();

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
  });
});

// ─── FormBridge Event Mapping (Story 10.2) ───────────────────────────

describe('FormBridge Event Mapping (Story 10.2)', () => {
  it('maps submission.created to form_submitted', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_100',
          formId: 'form_200',
          formName: 'Feedback Form',
          fieldCount: 8,
        },
        context: { agentlens_session_id: 'sess_map1' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('form_submitted');

    // Verify stored event
    const event = await store.getEvent(body.eventId);
    expect(event).toBeTruthy();
    expect(event!.eventType).toBe('form_submitted');
    expect(event!.payload).toMatchObject({
      submissionId: 'sub_100',
      formId: 'form_200',
      formName: 'Feedback Form',
      fieldCount: 8,
    });
  });

  it('maps submission.completed to form_completed', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.completed',
        data: {
          submissionId: 'sub_100',
          formId: 'form_200',
          completedBy: 'user@example.com',
          durationMs: 45000,
        },
        context: { agentlens_session_id: 'sess_map2' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('form_completed');

    const event = await store.getEvent(body.eventId);
    expect(event!.payload).toMatchObject({
      submissionId: 'sub_100',
      formId: 'form_200',
      completedBy: 'user@example.com',
      durationMs: 45000,
    });
  });

  it('maps submission.expired to form_expired', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.expired',
        data: {
          submissionId: 'sub_100',
          formId: 'form_200',
          expiredAfterMs: 3600000,
        },
        context: { agentlens_session_id: 'sess_map3' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('form_expired');

    const event = await store.getEvent(body.eventId);
    expect(event!.payload).toMatchObject({
      submissionId: 'sub_100',
      formId: 'form_200',
      expiredAfterMs: 3600000,
    });
  });

  it('returns 400 for unknown formbridge event type', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.unknown_event',
        data: { submissionId: 'sub_100', formId: 'form_200' },
        context: { agentlens_session_id: 'sess_map4' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown.*event/i);
  });

  it('stores source metadata on mapped events', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_meta',
          formId: 'form_meta',
          fieldCount: 3,
        },
        context: { agentlens_session_id: 'sess_meta' },
      },
      { secret: FB_SECRET },
    );

    const body = await res.json();
    const event = await store.getEvent(body.eventId);
    expect(event!.metadata).toMatchObject({
      source: 'formbridge',
      webhookEvent: 'submission.created',
    });
  });
});

// ─── Session Correlation (Story 10.3) ────────────────────────────────

describe('FormBridge Session Correlation (Story 10.3)', () => {
  it('links event to session via context.agentlens_session_id', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_corr1',
          formId: 'form_corr1',
          fieldCount: 2,
        },
        context: { agentlens_session_id: 'sess_linked' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toBe('sess_linked');
  });

  it('creates unlinked session ID when no context provided', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_corr2',
          formId: 'form_corr2',
          fieldCount: 1,
        },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^unlinked_/);
  });

  it('creates unlinked session ID when context has no session ID', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.completed',
        data: {
          submissionId: 'sub_corr3',
          formId: 'form_corr3',
          completedBy: 'user@test.com',
          durationMs: 5000,
        },
        context: { some_other_key: 'value' },
      },
      { secret: FB_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^unlinked_/);
  });

  it('uses agent ID from context when available', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_agent',
          formId: 'form_agent',
          fieldCount: 4,
        },
        context: {
          agentlens_session_id: 'sess_agent_test',
          agentlens_agent_id: 'my-custom-agent',
        },
      },
      { secret: FB_SECRET },
    );

    const body = await res.json();
    const event = await store.getEvent(body.eventId);
    expect(event!.agentId).toBe('my-custom-agent');
  });

  it('defaults agent ID to "external" when not in context', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: {
          submissionId: 'sub_noagent',
          formId: 'form_noagent',
          fieldCount: 1,
        },
        context: { agentlens_session_id: 'sess_noagent' },
      },
      { secret: FB_SECRET },
    );

    const body = await res.json();
    const event = await store.getEvent(body.eventId);
    expect(event!.agentId).toBe('external');
  });

  it('chains hashes correctly across multiple webhook events in same session', async () => {
    const { app, store } = setup();

    // First event
    const res1 = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.created',
        data: { submissionId: 'sub_chain', formId: 'form_chain', fieldCount: 3 },
        context: { agentlens_session_id: 'sess_chain' },
      },
      { secret: FB_SECRET },
    );
    const body1 = await res1.json();

    // Second event — same session
    const res2 = await makeRequest(
      app,
      {
        source: 'formbridge',
        event: 'submission.completed',
        data: { submissionId: 'sub_chain', formId: 'form_chain', completedBy: 'user@x.com', durationMs: 10000 },
        context: { agentlens_session_id: 'sess_chain' },
      },
      { secret: FB_SECRET },
    );
    const body2 = await res2.json();

    const event1 = await store.getEvent(body1.eventId);
    const event2 = await store.getEvent(body2.eventId);

    // First event has null prevHash, second chains from first
    expect(event1!.prevHash).toBeNull();
    expect(event2!.prevHash).toBe(event1!.hash);
  });
});

// ─── AgentGate Webhook (Story 9.1, 9.2, 9.3 — sanity checks) ────────

describe('AgentGate Webhook via shared ingest endpoint', () => {
  it('maps request.created to approval_requested', async () => {
    const { app, store } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'agentgate',
        event: 'request.created',
        data: {
          requestId: 'req_001',
          action: 'delete_file',
          params: { file: '/tmp/data.txt' },
          urgency: 'high',
        },
        context: { agentlens_session_id: 'sess_ag1' },
      },
      { secret: AG_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('approval_requested');

    const event = await store.getEvent(body.eventId);
    expect(event!.payload).toMatchObject({
      requestId: 'req_001',
      action: 'delete_file',
      urgency: 'high',
    });
  });

  it('maps request.approved to approval_granted', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'agentgate',
        event: 'request.approved',
        data: {
          requestId: 'req_002',
          action: 'send_email',
          decidedBy: 'admin',
          reason: 'Looks good',
        },
        context: { agentlens_session_id: 'sess_ag2' },
      },
      { secret: AG_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('approval_granted');
  });

  it('maps request.denied to approval_denied', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'agentgate',
        event: 'request.denied',
        data: {
          requestId: 'req_003',
          action: 'deploy',
          decidedBy: 'ops',
          reason: 'Not now',
        },
        context: { agentlens_session_id: 'sess_ag3' },
      },
      { secret: AG_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('approval_denied');
  });

  it('maps request.expired to approval_expired', async () => {
    const { app } = setup();

    const res = await makeRequest(
      app,
      {
        source: 'agentgate',
        event: 'request.expired',
        data: {
          requestId: 'req_004',
          action: 'restart',
        },
        context: { agentlens_session_id: 'sess_ag4' },
      },
      { secret: AG_SECRET },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('approval_expired');
  });
});

// ─── Generic Webhook ─────────────────────────────────────────────────

describe('Generic Webhook via ingest endpoint', () => {
  it('accepts generic webhooks without HMAC verification', async () => {
    const { app } = setup();

    // No X-Webhook-Signature header
    const res = await makeRequest(app, {
      source: 'generic',
      event: 'deployment',
      data: {
        eventType: 'custom',
        type: 'deployment',
        data: { service: 'api', version: '1.2.3' },
      },
      context: { agentlens_session_id: 'sess_gen1' },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventType).toBe('custom');
  });
});

// ─── Webhook secret not configured ──────────────────────────────────

describe('Missing webhook secret configuration', () => {
  it('returns 500 when formbridge secret is not configured', async () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);
    const app = new Hono();
    app.route(
      '/',
      ingestRoutes(store, {
        // No formbridgeWebhookSecret
        agentgateWebhookSecret: AG_SECRET,
      }),
    );

    const body = {
      source: 'formbridge',
      event: 'submission.created',
      data: { submissionId: 's', formId: 'f', fieldCount: 1 },
    };
    const rawBody = JSON.stringify(body);

    const res = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sign(rawBody, 'any'),
      },
      body: rawBody,
    });

    expect(res.status).toBe(500);
    const respBody = await res.json();
    expect(respBody.error).toMatch(/secret.*not configured/i);
  });
});

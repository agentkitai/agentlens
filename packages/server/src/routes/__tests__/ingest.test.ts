/**
 * F7-S2.2: Webhook ingest route integration tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { ingestRoutes, type IngestConfig } from '../ingest.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';

const AGENTGATE_SECRET = 'test-agentgate-secret-1234';
const FORMBRIDGE_SECRET = 'test-formbridge-secret-5678';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function createApp(store: SqliteEventStore) {
  const config: IngestConfig = {
    agentgateWebhookSecret: AGENTGATE_SECRET,
    formbridgeWebhookSecret: FORMBRIDGE_SECRET,
  };
  const app = new Hono();
  app.route('/api/events/ingest', ingestRoutes(store, config));
  return app;
}

describe('Ingest Routes (F7-S2.2)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(store);
  });

  describe('POST /api/events/ingest — AgentGate', () => {
    function agentgatePayload(overrides?: Record<string, unknown>) {
      return {
        source: 'agentgate',
        event: 'request.created',
        data: {
          requestId: 'req-1',
          action: 'deploy',
          params: { env: 'prod' },
          urgency: 'high',
        },
        ...overrides,
      };
    }

    it('returns 201 for valid signed payload', async () => {
      const body = JSON.stringify(agentgatePayload());
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': sign(body, AGENTGATE_SECRET),
        },
        body,
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.eventId).toBeDefined();
      expect(json.eventType).toBe('approval_requested');
    });

    it('returns 401 for invalid signature', async () => {
      const body = JSON.stringify(agentgatePayload());
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'bad-signature',
        },
        body,
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for missing signature', async () => {
      const body = JSON.stringify(agentgatePayload());
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 for unknown event type', async () => {
      const payload = agentgatePayload({ event: 'unknown.event' });
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': sign(body, AGENTGATE_SECRET),
        },
        body,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/events/ingest — FormBridge', () => {
    it('returns 201 for valid submission.created', async () => {
      const payload = {
        source: 'formbridge',
        event: 'submission.created',
        data: { submissionId: 'sub-1', formId: 'form-1', formName: 'Contact', fieldCount: 5 },
      };
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': sign(body, FORMBRIDGE_SECRET),
        },
        body,
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.eventType).toBe('form_submitted');
    });
  });

  describe('POST /api/events/ingest — Generic', () => {
    it('returns 201 without signature for generic source', async () => {
      const payload = {
        source: 'generic',
        event: 'custom',
        data: { type: 'ping', data: { hello: 'world' } },
      };
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/events/ingest — validation errors', () => {
    it('returns 400 for invalid JSON', async () => {
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing source', async () => {
      const body = JSON.stringify({ event: 'test', data: {} });
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing event field', async () => {
      const payload = { source: 'generic', data: { type: 'test' } };
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing data field', async () => {
      const payload = { source: 'generic', event: 'test' };
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
    });
  });
});

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

    it('resolves the secret per-request from a function source (config-store wiring)', async () => {
      // The route reads the secret via a resolver, so a value set later (e.g. in
      // the Settings UI) takes effect without reconstructing the route.
      let current = 'first-secret';
      const dynApp = new Hono();
      dynApp.route('/api/events/ingest', ingestRoutes(store, { agentgateWebhookSecret: () => current }));
      const send = (secret: string) => {
        const body = JSON.stringify(agentgatePayload());
        return dynApp.request('/api/events/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sign(body, secret) },
          body,
        });
      };
      expect((await send('first-secret')).status).toBe(201);
      current = 'rotated-secret';
      expect((await send('first-secret')).status).toBe(401); // old secret now rejected
      expect((await send('rotated-secret')).status).toBe(201); // new secret honored
    });

    // Byte-faithful to what AgentGate actually emits from its Settings→Webhooks
    // path — agentgate/packages/server/src/lib/webhook.ts deliverToWebhook():
    //   payload   = JSON.stringify({ event, data, timestamp })   // no `source`
    //   signature = createHmac('sha256', secret).update(payload).digest('hex')
    //   header    = 'X-AgentGate-Signature': <hex>
    function agentgateWire(event: string, data: Record<string, unknown>, secret: string) {
      const body = JSON.stringify({ event, data, timestamp: 1730000000000 });
      return {
        body,
        headers: { 'Content-Type': 'application/json', 'X-AgentGate-Signature': sign(body, secret) },
      };
    }

    it('accepts a byte-faithful AgentGate webhook (X-AgentGate-Signature, no source field)', async () => {
      const { body, headers } = agentgateWire(
        'request.approved',
        { requestId: 'req-1', action: 'deploy', decidedBy: 'alice@example.com', reason: 'ok' },
        AGENTGATE_SECRET,
      );
      const res = await app.request('/api/events/ingest', { method: 'POST', headers, body });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.eventType).toBe('approval_granted');
    });

    it('rejects a byte-faithful AgentGate webhook signed with the wrong secret', async () => {
      const { body, headers } = agentgateWire('request.created', { requestId: 'r', action: 'x' }, 'wrong-secret');
      const res = await app.request('/api/events/ingest', { method: 'POST', headers, body });
      expect(res.status).toBe(401);
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

  describe('POST /api/events/ingest — agent identity (#12)', () => {
    it('strips a forged verifiedAgentId from the webhook context', async () => {
      const payload = {
        source: 'agentgate',
        event: 'request.created',
        data: { requestId: 'req-x', action: 'deploy', params: {}, urgency: 'high' },
        context: { agentId: 'agt_x', sessionId: 'sess-x', verifiedAgentId: 'agt_forged', note: 'keep' },
      };
      const body = JSON.stringify(payload);
      const res = await app.request('/api/events/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sign(body, AGENTGATE_SECRET) },
        body,
      });
      expect(res.status).toBe(201);
      const { eventId } = await res.json();
      const ev = await store.getEvent(eventId);
      expect(ev).not.toBeNull();
      // The forged reserved key is stripped; other context is preserved.
      expect(ev!.metadata['verifiedAgentId']).toBeUndefined();
      expect(ev!.metadata['note']).toBe('keep');
    });
  });
});

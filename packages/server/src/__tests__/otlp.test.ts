/**
 * Tests for OTLP HTTP Receiver endpoints
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { otlpRoutes } from '../routes/otlp.js';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

function makeApp() {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);
  const app = new Hono();
  app.route('/v1', otlpRoutes(store));
  return { app, store };
}

function makeTracesPayload(spans: Array<{
  name: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: number } }>;
}>, serviceName = 'openclaw') {
  return {
    resourceSpans: [{
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
      },
      scopeSpans: [{
        spans: spans.map((s, i) => ({
          name: s.name,
          traceId: 'abc123',
          spanId: `span${i}`,
          startTimeUnixNano: '1700000000000000000',
          endTimeUnixNano: '1700000001000000000',
          attributes: s.attributes ?? [],
        })),
      }],
    }],
  };
}

describe('OTLP Traces Endpoint', () => {
  it('should ingest openclaw.model.usage spans as llm_call events', async () => {
    const { app, store } = makeApp();
    const body = makeTracesPayload([{
      name: 'openclaw.model.usage',
      attributes: [
        { key: 'openclaw.model', value: { stringValue: 'claude-opus-4-6' } },
        { key: 'openclaw.provider', value: { stringValue: 'anthropic' } },
        { key: 'openclaw.tokens.input', value: { intValue: 100 } },
        { key: 'openclaw.tokens.output', value: { intValue: 50 } },
        { key: 'openclaw.tokens.total', value: { intValue: 150 } },
        { key: 'openclaw.sessionId', value: { stringValue: 'sess-123' } },
      ],
    }]);

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);

    const events = (await store.queryEvents({ sessionId: 'sess-123' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('llm_call');
    expect(events[0]!.agentId).toBe('openclaw');
    const payload = events[0]!.payload as { model: string; provider: string };
    expect(payload.model).toBe('claude-opus-4-6');
    expect(payload.provider).toBe('anthropic');
  });

  it('should ingest openclaw.message.processed as custom event', async () => {
    const { app, store } = makeApp();
    const body = makeTracesPayload([{
      name: 'openclaw.message.processed',
      attributes: [
        { key: 'openclaw.channel', value: { stringValue: 'discord' } },
        { key: 'openclaw.outcome', value: { stringValue: 'replied' } },
        { key: 'openclaw.sessionId', value: { stringValue: 'sess-456' } },
      ],
    }]);

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-456' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('custom');
    const payload = events[0]!.payload as { type: string; data: { channel: string } };
    expect(payload.type).toBe('message_processed');
    expect(payload.data.channel).toBe('discord');
  });

  it('should ingest openclaw.session.stuck as error severity custom event', async () => {
    const { app, store } = makeApp();
    const body = makeTracesPayload([{
      name: 'openclaw.session.stuck',
      attributes: [
        { key: 'openclaw.sessionId', value: { stringValue: 'sess-stuck' } },
      ],
    }]);

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-stuck' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe('error');
    expect((events[0]!.payload as { type: string }).type).toBe('session_stuck');
  });

  it('should map unknown spans to otlp_span custom events', async () => {
    const { app, store } = makeApp();
    const body = makeTracesPayload([{
      name: 'some.other.span',
      attributes: [{ key: 'foo', value: { stringValue: 'bar' } }],
    }]);

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'otlp-default' })).events;
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { type: string; data: { name: string } };
    expect(payload.type).toBe('otlp_span');
    expect(payload.data.name).toBe('some.other.span');
  });

  it('should extract agentId from service.name resource attribute', async () => {
    const { app, store } = makeApp();
    const body = makeTracesPayload([{ name: 'test.span' }], 'my-agent');

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'otlp-default' })).events;
    expect(events[0]!.agentId).toBe('my-agent');
  });

  it('should return 400 for invalid payload', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe('OTLP Metrics Endpoint', () => {
  it('should ingest openclaw.cost.usd as cost_tracked event', async () => {
    const { app, store } = makeApp();
    const body = {
      resourceMetrics: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'openclaw' } }] },
        scopeMetrics: [{
          metrics: [{
            name: 'openclaw.cost.usd',
            sum: {
              dataPoints: [{
                asDouble: 0.05,
                timeUnixNano: '1700000000000000000',
                attributes: [
                  { key: 'openclaw.provider', value: { stringValue: 'anthropic' } },
                  { key: 'openclaw.model', value: { stringValue: 'claude-opus-4-6' } },
                  { key: 'openclaw.sessionId', value: { stringValue: 'sess-cost' } },
                ],
              }],
            },
          }],
        }],
      }],
    };

    const res = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-cost' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('cost_tracked');
    const payload = events[0]!.payload as { costUsd: number; provider: string };
    expect(payload.costUsd).toBe(0.05);
    expect(payload.provider).toBe('anthropic');
  });

  it('should ingest generic metrics as custom events', async () => {
    const { app, store } = makeApp();
    const body = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{
          metrics: [{
            name: 'openclaw.tokens',
            sum: {
              dataPoints: [{
                asInt: '500',
                timeUnixNano: '1700000000000000000',
                attributes: [],
              }],
            },
          }],
        }],
      }],
    };

    const res = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'otlp-default' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('custom');
    const payload = events[0]!.payload as { type: string; data: { name: string; value: number } };
    expect(payload.type).toBe('otlp_metric');
    expect(payload.data.value).toBe(500);
  });
});

describe('OTLP Logs Endpoint', () => {
  it('should ingest log records as custom events', async () => {
    const { app, store } = makeApp();
    const body = {
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'openclaw' } }] },
        scopeLogs: [{
          logRecords: [{
            body: { stringValue: 'Something happened' },
            severityText: 'WARN',
            severityNumber: 13,
            timeUnixNano: '1700000000000000000',
            attributes: [
              { key: 'openclaw.sessionId', value: { stringValue: 'sess-log' } },
            ],
          }],
        }],
      }],
    };

    const res = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-log' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('custom');
    expect(events[0]!.severity).toBe('warn');
    const payload = events[0]!.payload as { type: string; data: { body: string; severityText: string } };
    expect(payload.type).toBe('otlp_log');
    expect(payload.data.body).toBe('Something happened');
    expect(payload.data.severityText).toBe('WARN');
  });

  it('should map error severity correctly', async () => {
    const { app, store } = makeApp();
    const body = {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{
          logRecords: [{
            body: { stringValue: 'Error occurred' },
            severityText: 'ERROR',
            timeUnixNano: '1700000000000000000',
            attributes: [],
          }],
        }],
      }],
    };

    const res = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'otlp-default' })).events;
    expect(events[0]!.severity).toBe('error');
  });
});

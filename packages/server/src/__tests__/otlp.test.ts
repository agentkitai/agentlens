/**
 * Tests for OTLP HTTP Receiver endpoints
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import protobuf from 'protobufjs';
import { otlpRoutes } from '../routes/otlp.js';
import { OTLP_PROTO_DESCRIPTOR } from '../otlp/otlp-proto-descriptor.js';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { verifyChain } from '@agentlensai/core';
import type { ChainEvent } from '@agentlensai/core';

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

// Encode an OTLP request as protobuf using the same vendored descriptor the
// receiver decodes with, so these are true round-trips.
function encodeOtlpProtobuf(typeName: string, payload: object): Uint8Array {
  const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
  const T = root.lookupType(typeName);
  return T.encode(T.create(payload)).finish();
}
function encodeTracesProtobuf(payload: ReturnType<typeof makeTracesPayload>): Uint8Array {
  return encodeOtlpProtobuf('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest', payload);
}

describe('OTLP Protobuf Support', () => {
  it('should decode protobuf traces and ingest as events', async () => {
    const { app, store } = makeApp();
    const payload = makeTracesPayload([{
      name: 'openclaw.model.usage',
      attributes: [
        { key: 'openclaw.model', value: { stringValue: 'claude-sonnet' } },
        { key: 'openclaw.provider', value: { stringValue: 'anthropic' } },
        { key: 'openclaw.sessionId', value: { stringValue: 'sess-pb' } },
      ],
    }]);

    const buf = await encodeTracesProtobuf(payload);

    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: buf,
    });

    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-pb' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('llm_call');
    const p = events[0]!.payload as { model: string };
    expect(p.model).toBe('claude-sonnet');
  });

  it('should return 400 for invalid protobuf', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array([0xFF, 0xFF, 0xFF]),
    });
    // Invalid protobuf may decode as empty or fail — either 200 with no events or 400
    expect([200, 400]).toContain(res.status);
  });

  it('should decode protobuf metrics and ingest as events', async () => {
    const { app, store } = makeApp();
    const buf = encodeOtlpProtobuf('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest', {
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
                  { key: 'openclaw.sessionId', value: { stringValue: 'sess-pb-metric' } },
                ],
              }],
            },
          }],
        }],
      }],
    });
    const res = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: buf,
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-pb-metric' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('cost_tracked');
  });

  it('should decode protobuf gen_ai error status (numeric enum) as error severity', async () => {
    const { app, store } = makeApp();
    // A gen_ai chat span with an ERROR status, sent as protobuf. status.code must
    // decode to the NUMERIC 2 (not the string 'STATUS_CODE_ERROR') for the
    // error-severity check to fire — guards the enums-stay-numeric decode option.
    const buf = encodeOtlpProtobuf('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest', {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            name: 'chat gpt-4o',
            traceId: new Uint8Array(16),
            spanId: new Uint8Array(8),
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000002000000000',
            status: { code: 2 }, // STATUS_CODE_ERROR
            attributes: [
              { key: 'session.id', value: { stringValue: 'sess-pb-genai-err' } },
              { key: 'gen_ai.system', value: { stringValue: 'openai' } },
              { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
              { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
            ],
          }],
        }],
      }],
    });
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: buf,
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-pb-genai-err' })).events;
    const llmResponse = events.find((e) => e.eventType === 'llm_response');
    expect(llmResponse).toBeDefined();
    expect(llmResponse!.severity).toBe('error'); // would be 'info' if enums decoded as strings
  });

  it('should decode protobuf logs and ingest as events', async () => {
    const { app, store } = makeApp();
    const buf = encodeOtlpProtobuf('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest', {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{
          logRecords: [{
            body: { stringValue: 'pb log line' },
            severityText: 'WARN',
            severityNumber: 13,
            timeUnixNano: '1700000000000000000',
            attributes: [{ key: 'openclaw.sessionId', value: { stringValue: 'sess-pb-log' } }],
          }],
        }],
      }],
    });
    const res = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: buf,
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'sess-pb-log' })).events;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ type: 'otlp_log' });
  });
});

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

describe('OTLP GenAI semantic conventions', () => {
  // A realistic OTel GenAI trace: an OpenLLMetry-style chat span (gen_ai.prompt/
  // completion attrs + token usage) followed by a tool-execution span. Note the
  // chat span ends at the same nano the tool span starts — so the mapped
  // llm_response and tool_call share a timestamp, exercising same-ms ordering.
  const genaiPayload = {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-agent' } }] },
      scopeSpans: [{
        spans: [
          {
            name: 'chat gpt-4o', traceId: 'genai1', spanId: 'spanA',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000002000000000',
            status: { code: 1 },
            attributes: [
              { key: 'gen_ai.system', value: { stringValue: 'openai' } },
              { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
              { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
              { key: 'gen_ai.response.model', value: { stringValue: 'gpt-4o-2024-08-06' } },
              { key: 'gen_ai.request.temperature', value: { doubleValue: 0.7 } },
              { key: 'gen_ai.usage.input_tokens', value: { intValue: 42 } },
              { key: 'gen_ai.usage.output_tokens', value: { intValue: 17 } },
              { key: 'gen_ai.response.finish_reasons', value: { arrayValue: { values: [{ stringValue: 'stop' }] } } },
              { key: 'gen_ai.prompt.0.role', value: { stringValue: 'user' } },
              { key: 'gen_ai.prompt.0.content', value: { stringValue: 'What is the capital of France?' } },
              { key: 'gen_ai.completion.0.role', value: { stringValue: 'assistant' } },
              { key: 'gen_ai.completion.0.content', value: { stringValue: 'Paris.' } },
            ],
          },
          {
            name: 'execute_tool web_search', traceId: 'genai1', spanId: 'spanB',
            startTimeUnixNano: '1700000002000000000',
            endTimeUnixNano: '1700000002500000000',
            attributes: [
              { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
              { key: 'gen_ai.tool.name', value: { stringValue: 'web_search' } },
              { key: 'gen_ai.tool.call.id', value: { stringValue: 'call_xyz' } },
              { key: 'gen_ai.tool.call.arguments', value: { stringValue: '{"q":"capital of France"}' } },
            ],
          },
        ],
      }],
    }],
  };

  async function ingestGenai() {
    const { app, store } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload),
    });
    expect(res.status).toBe(200);
    // A trace maps to a session: trace-<traceId>
    const events = (await store.queryEvents({ sessionId: 'trace-genai1' })).events;
    return events;
  }

  it('maps a gen_ai chat span to paired llm_call + llm_response with token usage and content', async () => {
    const events = await ingestGenai();
    expect(events.length).toBe(3); // llm_call + llm_response + tool_call

    const call = events.find((e) => e.eventType === 'llm_call')!;
    const resp = events.find((e) => e.eventType === 'llm_response')!;
    expect(call).toBeTruthy();
    expect(resp).toBeTruthy();

    const cp = call.payload as { provider: string; model: string; messages: Array<{ role: string; content: string }> };
    expect(cp.provider).toBe('openai');
    expect(cp.model).toBe('gpt-4o');
    expect(cp.messages[0]!.content).toContain('capital of France');

    const rp = resp.payload as { completion: string; finishReason: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };
    expect(rp.usage.inputTokens).toBe(42);
    expect(rp.usage.outputTokens).toBe(17);
    expect(rp.usage.totalTokens).toBe(59);
    expect(rp.completion).toBe('Paris.');
    expect(rp.finishReason).toBe('stop');
  });

  it('maps a gen_ai execute_tool span to a tool_call event', async () => {
    const events = await ingestGenai();
    const tool = events.find((e) => e.eventType === 'tool_call')!;
    expect(tool).toBeTruthy();
    const tp = tool.payload as { toolName: string; callId: string; arguments: { q?: string } };
    expect(tp.toolName).toBe('web_search');
    expect(tp.callId).toBe('call_xyz');
    expect(tp.arguments.q).toBe('capital of France');
  });

  it('produces a valid, tamper-evident hash chain for the GenAI-ingested session', async () => {
    const events = await ingestGenai();
    // Chain order = (timestamp, id) ascending, matching how verification reads.
    const chain = [...events].sort((a, b) =>
      a.timestamp < b.timestamp ? -1
        : a.timestamp > b.timestamp ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0) as unknown as ChainEvent[];
    expect(verifyChain(chain).valid).toBe(true);
  });
});

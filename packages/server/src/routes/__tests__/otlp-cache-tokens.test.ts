/**
 * OTLP gen_ai prompt-cache token extraction + cache-aware cost (#55 Thread 2, box 127).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { otlpRoutes } from '../otlp.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';

function genaiPayload(extraAttrs: Array<{ key: string; value: any }>) {
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-agent' } }] },
      scopeSpans: [{
        spans: [{
          name: 'chat claude', traceId: 'cache1', spanId: 'spanA',
          startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000',
          status: { code: 1 },
          attributes: [
            { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
            { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
            { key: 'gen_ai.usage.output_tokens', value: { intValue: 0 } },
            ...extraAttrs,
          ],
        }],
      }],
    }],
  };
}

describe('OTLP gen_ai cache tokens', () => {
  let store: SqliteEventStore;
  let app: any;
  beforeEach(() => {
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono();
    app.route('/v1', otlpRoutes(store));
  });

  it('maps cache_read/creation tokens into usage and prices them cache-aware', async () => {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload([
        { key: 'gen_ai.usage.cache_read_input_tokens', value: { intValue: 1_000_000 } },
        { key: 'gen_ai.usage.cache_creation_input_tokens', value: { intValue: 1_000_000 } },
      ])),
    });
    expect(res.status).toBe(200);

    const events = (await store.queryEvents({ sessionId: 'trace-cache1' })).events;
    const resp = events.find((e) => e.eventType === 'llm_response')!;
    const p = resp.payload as { usage: { cacheReadTokens?: number; cacheWriteTokens?: number }; costUsd: number };
    expect(p.usage.cacheReadTokens).toBe(1_000_000);
    expect(p.usage.cacheWriteTokens).toBe(1_000_000);
    // claude-haiku-4-5: input 0.8 (×100/1e6) + cacheRead 0.08 (×1M) + cacheWrite 1.0 (×1M)
    expect(p.costUsd).toBeCloseTo((100 * 0.8) / 1_000_000 + 0.08 + 1.0, 6);
  });

  it('falls back to the cached_input_tokens attribute name', async () => {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload([
        { key: 'gen_ai.usage.cached_input_tokens', value: { intValue: 500_000 } },
      ])),
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'trace-cache1' })).events;
    const resp = events.find((e) => e.eventType === 'llm_response')!;
    expect((resp.payload as { usage: { cacheReadTokens?: number } }).usage.cacheReadTokens).toBe(500_000);
  });

  it('omits cache fields when the span has no cache attributes', async () => {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload([])),
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'trace-cache1' })).events;
    const resp = events.find((e) => e.eventType === 'llm_response')!;
    const p = resp.payload as { usage: Record<string, unknown> };
    expect(p.usage.cacheReadTokens).toBeUndefined();
    expect(p.usage.cacheWriteTokens).toBeUndefined();
  });
});

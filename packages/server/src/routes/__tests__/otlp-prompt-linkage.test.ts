/**
 * OTLP gen_ai → prompt version/template linkage (#120): maps
 * gen_ai.prompt.version_id / template_id onto the llm_call payload so
 * per-version + per-agent analytics work for OTLP producers, not just the SDK.
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
          name: 'chat', traceId: 'link1', spanId: 'spanL',
          startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000001000000000',
          status: { code: 1 },
          attributes: [
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
            ...extraAttrs,
          ],
        }],
      }],
    }],
  };
}

describe('OTLP prompt linkage (#120)', () => {
  let store: SqliteEventStore;
  let app: any;
  beforeEach(() => {
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono();
    app.route('/v1', otlpRoutes(store));
  });

  async function ingest(attrs: Array<{ key: string; value: any }>) {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload(attrs)),
    });
    expect(res.status).toBe(200);
    const events = (await store.queryEvents({ sessionId: 'trace-link1' })).events;
    return events.find((e) => e.eventType === 'llm_call')!;
  }

  it('maps gen_ai.prompt.version_id / template_id onto the llm_call payload', async () => {
    const call = await ingest([
      { key: 'gen_ai.prompt.version_id', value: { stringValue: 'ver_123' } },
      { key: 'gen_ai.prompt.template_id', value: { stringValue: 'tpl_abc' } },
    ]);
    const p = call.payload as { promptVersionId?: string; promptTemplateId?: string };
    expect(p.promptVersionId).toBe('ver_123');
    expect(p.promptTemplateId).toBe('tpl_abc');
  });

  it('accepts the agentlens.prompt.* attribute aliases', async () => {
    const call = await ingest([{ key: 'agentlens.prompt.version_id', value: { stringValue: 'ver_alias' } }]);
    expect((call.payload as { promptVersionId?: string }).promptVersionId).toBe('ver_alias');
  });

  it('omits the linkage fields when no prompt attribute is present', async () => {
    const call = await ingest([]);
    const p = call.payload as { promptVersionId?: string; promptTemplateId?: string };
    expect(p.promptVersionId).toBeUndefined();
    expect(p.promptTemplateId).toBeUndefined();
  });
});

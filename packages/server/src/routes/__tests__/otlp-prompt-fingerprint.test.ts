/**
 * Prompt auto-discovery wiring on the OTLP traces path (#55 Thread 2, box 126):
 * a gen_ai chat span carrying a system message records a prompt fingerprint.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { otlpRoutes } from '../otlp.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { PromptStore, computePromptHash } from '../../db/prompt-store.js';

const SYS = 'You are a routing agent. Only use approved tools.';

const genaiPayload = {
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-agent' } }] },
    scopeSpans: [{
      spans: [{
        name: 'chat claude', traceId: 'fp1', spanId: 'spanA',
        startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000',
        status: { code: 1 },
        attributes: [
          { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
          { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
          { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
          { key: 'gen_ai.usage.input_tokens', value: { intValue: 30 } },
          { key: 'gen_ai.usage.output_tokens', value: { intValue: 10 } },
          { key: 'gen_ai.prompt.0.role', value: { stringValue: 'system' } },
          { key: 'gen_ai.prompt.0.content', value: { stringValue: SYS } },
          { key: 'gen_ai.prompt.1.role', value: { stringValue: 'user' } },
          { key: 'gen_ai.prompt.1.content', value: { stringValue: 'route this' } },
        ],
      }],
    }],
  }],
};

describe('OTLP /v1/traces → prompt fingerprint auto-discovery', async () => {
  let store: SqliteEventStore;
  let promptStore: PromptStore;
  let app: any;

  beforeEach(() => {
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    promptStore = new PromptStore(db);
    app = new Hono();
    app.route('/v1', otlpRoutes(store, undefined, promptStore));
  });

  it('fingerprints the system message from a gen_ai chat span', async () => {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(genaiPayload),
    });
    expect(res.status).toBe(200);

    const fps = await promptStore.getFingerprints('default');
    expect(fps).toHaveLength(1);
    expect(fps[0]!.contentHash).toBe(computePromptHash(SYS));
  });
});

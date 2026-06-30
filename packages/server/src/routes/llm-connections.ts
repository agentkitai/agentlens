/**
 * LLM connections API (#143) — bring-your-own provider keys.
 *
 * Mounted at /api/llm-connections (manage-guarded). Secrets are write-only:
 * create accepts `apiKey`, but it is encrypted at rest and NEVER returned — reads
 * expose only `keyLast4`. `POST /:id/test` executes a cheap model call to verify
 * the credential works (the "server can execute a model call" acceptance).
 */
import { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { LlmConnectionStore } from '../db/llm-connection-store.js';
import { secretsAvailable } from '../lib/secret-box.js';
import { testConnection } from '../lib/llm-invoke.js';

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'azure', 'bedrock', 'vertex', 'custom']);

export function llmConnectionsRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new LlmConnectionStore(db);

  // POST /api/llm-connections — create (encrypts the key)
  app.post('/', async (c) => {
    if (!secretsAvailable()) {
      return c.json({ error: 'Server encryption key not configured (set AGENTLENS_ENCRYPTION_KEY)' }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = String(body.provider ?? '');
    const name = String(body.name ?? '').trim();
    const apiKey = String(body.apiKey ?? '');
    if (!VALID_PROVIDERS.has(provider)) return c.json({ error: `provider must be one of ${[...VALID_PROVIDERS].join(', ')}` }, 400);
    if (!name || !apiKey) return c.json({ error: 'name and apiKey are required' }, 400);

    const connection = await store.create(getTenantId(c), {
      provider,
      name,
      apiKey,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      defaultModel: typeof body.defaultModel === 'string' ? body.defaultModel : undefined,
      createdBy: c.get('apiKey')?.id,
    });
    return c.json({ connection }, 201);
  });

  // GET /api/llm-connections — list (masked)
  app.get('/', async (c) => c.json({ connections: await store.list(getTenantId(c)) }));

  // GET /api/llm-connections/:id — single (masked)
  app.get('/:id', async (c) => {
    const connection = await store.get(getTenantId(c), c.req.param('id'));
    return connection ? c.json({ connection }) : c.json({ error: 'Connection not found' }, 404);
  });

  // DELETE /api/llm-connections/:id
  app.delete('/:id', async (c) => {
    const ok = await store.delete(getTenantId(c), c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Connection not found' }, 404);
  });

  // POST /api/llm-connections/:id/test — verify the credential with a cheap call
  app.post('/:id/test', async (c) => {
    const withKey = await store.getWithKey(getTenantId(c), c.req.param('id'));
    if (!withKey) return c.json({ error: 'Connection not found' }, 404);
    const result = await testConnection({
      provider: withKey.provider,
      apiKey: withKey.apiKey,
      baseUrl: withKey.baseUrl,
      defaultModel: withKey.defaultModel,
    });
    return c.json(result, result.ok ? 200 : 502);
  });

  return app;
}

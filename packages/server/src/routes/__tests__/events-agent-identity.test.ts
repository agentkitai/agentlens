/**
 * Agent-identity stamping on ingest (#12 Phase 2).
 *
 * A valid AgentGate agent token (X-Agent-Token) → every ingested event carries
 * a server-authoritative metadata.verifiedAgentId, and the hash chain still
 * verifies (the stamp lives in the already-hashed metadata field). Without a
 * valid token, the reserved keys are stripped so a client can't forge them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { signAccessToken, type AuthConfig } from 'agentkit-auth';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { verifyChain } from '@agentlensai/core';
import { __resetAgentJwksCache } from '../../lib/agent-identity.js';
import { eventsRoutes } from '../events.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

const SECRET = 'agentgate-shared-secret-at-least-32-chars!';

function agentCfg(secret = SECRET, ttl = 900): AuthConfig {
  return { oidc: null, jwt: { secret, accessTokenTtlSeconds: ttl, refreshTokenTtlSeconds: 604800 }, authDisabled: false };
}
const agentClaims = (sub: string) => ({ sub, tid: 'default', role: 'viewer', email: '', typ: 'agent' });

function createApp(db: any, store: SqliteEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, false));
  app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
  return app;
}

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys).values({
    id: 'key-1',
    keyHash: hashApiKey(rawKey),
    name: 'Test Key',
    scopes: JSON.stringify(['*']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default',
    role: 'editor',
  }).run();
  return rawKey;
}

const ev = (overrides?: Record<string, unknown>) => ({
  sessionId: 's1',
  agentId: 'agt_99',
  eventType: 'tool_call',
  payload: { toolName: 'search', callId: 'c1', arguments: {} },
  ...overrides,
});

describe('POST /api/events agent identity (#12 Phase 2)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);
    process.env['AGENTGATE_JWT_SECRET'] = SECRET;
  });
  afterEach(() => {
    delete process.env['AGENTGATE_JWT_SECRET'];
    delete process.env['AGENTGATE_JWKS_URL'];
    __resetAgentJwksCache();
    vi.unstubAllGlobals();
  });

  it('stamps verifiedAgentId into metadata for every event; chain still verifies', async () => {
    const token = await signAccessToken(agentClaims('agt_99'), agentCfg());
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { ...auth(), 'X-Agent-Token': token },
      body: JSON.stringify({
        events: [ev(), ev({ payload: { toolName: 'fetch', callId: 'c2', arguments: {} } })],
      }),
    });
    expect(res.status).toBe(201);

    const timeline = await store.getSessionTimeline('s1');
    expect(timeline).toHaveLength(2);
    for (const e of timeline) {
      expect(e.metadata['verifiedAgentId']).toBe('agt_99');
      expect(e.metadata['verifiedAgentMethod']).toBe('agentgate_token');
    }
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('stamps via the RS256/JWKS path with method agentgate_jwks (#97)', async () => {
    // AgentGate signs RS256; AgentLens verifies against the published JWKS — no shared secret.
    delete process.env['AGENTGATE_JWT_SECRET'];
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = (await exportJWK(publicKey)) as JWK;
    jwk.kid = 'k1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/jwk-set+json' },
        }),
      ),
    );
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';

    const token = await new SignJWT({ typ: 'agent' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('agt_99')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { ...auth(), 'X-Agent-Token': token },
      body: JSON.stringify({ events: [ev()] }),
    });
    expect(res.status).toBe(201);

    const t = await store.getSessionTimeline('s1');
    expect(t[0]!.metadata['verifiedAgentId']).toBe('agt_99');
    expect(t[0]!.metadata['verifiedAgentMethod']).toBe('agentgate_jwks');
    expect(verifyChain(t as any).valid).toBe(true);
  });

  it('does not stamp when no token is presented', async () => {
    const res = await app.request('/api/events', {
      method: 'POST', headers: auth(), body: JSON.stringify({ events: [ev()] }),
    });
    expect(res.status).toBe(201);
    const t = await store.getSessionTimeline('s1');
    expect(t[0]!.metadata['verifiedAgentId']).toBeUndefined();
  });

  it('strips a client-forged metadata.verifiedAgentId when there is no valid token', async () => {
    const res = await app.request('/api/events', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ events: [ev({ metadata: { verifiedAgentId: 'agt_forged', note: 'keep' } })] }),
    });
    expect(res.status).toBe(201);
    const t = await store.getSessionTimeline('s1');
    expect(t[0]!.metadata['verifiedAgentId']).toBeUndefined();
    expect(t[0]!.metadata['note']).toBe('keep');
  });

  it('ignores a forged user token (no typ:agent) — no stamp', async () => {
    const userTok = await signAccessToken({ sub: 'user_x', tid: 'default', role: 'admin', email: 'u@x.io' }, agentCfg());
    const res = await app.request('/api/events', {
      method: 'POST', headers: { ...auth(), 'X-Agent-Token': userTok },
      body: JSON.stringify({ events: [ev()] }),
    });
    expect(res.status).toBe(201);
    const t = await store.getSessionTimeline('s1');
    expect(t[0]!.metadata['verifiedAgentId']).toBeUndefined();
  });
});

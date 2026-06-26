/**
 * Cross-product evidence endpoints (#98, Phase 1).
 *
 * Seeds events via the real ingest path (X-Agent-Token → stamped
 * verified_agent_id), then exercises the timeline + signed evidence pack +
 * verify endpoints end-to-end on the same DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { signAccessToken, type AuthConfig } from 'agentkit-auth';
import { eventsRoutes } from '../events.js';
import { auditTimelineRoutes, auditEvidenceRoutes } from '../audit-evidence.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';
import type { SignedEvidencePack } from '../../lib/evidence.js';

const SECRET = 'agentgate-shared-secret-at-least-32-chars!';
const SIGNING_KEY = 'evidence-signing-key-at-least-32-chars-long!';
const AGENT = 'agt_evidence';

function agentCfg(): AuthConfig {
  return { oidc: null, jwt: { secret: SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 }, authDisabled: false };
}
const agentToken = (sub: string) =>
  signAccessToken({ sub, tid: 'default', role: 'viewer', email: '', typ: 'agent' }, agentCfg());

function seedKey(db: any, id: string, rawKey: string, role: string, tenantId = 'default') {
  db.insert(apiKeys).values({
    id, keyHash: hashApiKey(rawKey), name: id, scopes: JSON.stringify(['*']),
    createdAt: Math.floor(Date.now() / 1000), tenantId, role,
  }).run();
}

const ev = (o?: Record<string, unknown>) => ({
  sessionId: 's1', agentId: AGENT, eventType: 'tool_call',
  payload: { toolName: 'search', callId: 'c1', arguments: {} }, ...o,
});

describe('cross-product evidence endpoints (#98)', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  const adminKey = 'als_adminkey1234567890abcdef1234567890abcd';
  const tenant2Key = 'als_tenant2key34567890abcdef1234567890abcd';
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const admin = () => ({ Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono<{ Variables: AuthVariables }>();
    app.use('/*', authMiddleware(db, false));
    app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
    app.route('/api/audit/timeline', auditTimelineRoutes(db));
    app.route('/api/audit/evidence', auditEvidenceRoutes(db, SIGNING_KEY));
    seedKey(db, 'admin-1', adminKey, 'admin');
    seedKey(db, 'tenant2-1', tenant2Key, 'admin', 'tenant2');
    process.env['AGENTGATE_JWT_SECRET'] = SECRET;

    // Seed: 2 attributed events for AGENT, 1 for another agent, 1 unattributed.
    const tok = await agentToken(AGENT);
    const seed = await app.request('/api/events', {
      method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json', 'X-Agent-Token': tok },
      body: JSON.stringify({
        events: [
          ev(),
          ev({ eventType: 'approval_requested', payload: { requestId: 'req1', action: 'send_email', params: {}, urgency: 'normal' } }),
        ],
      }),
    });
    expect(seed.status).toBe(201);
    const otherTok = await agentToken('agt_other');
    await app.request('/api/events', {
      method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json', 'X-Agent-Token': otherTok },
      body: JSON.stringify({ events: [ev({ sessionId: 's2', agentId: 'agt_other' })] }),
    });
    await app.request('/api/events', {
      method: 'POST', headers: admin(),
      body: JSON.stringify({ events: [ev({ sessionId: 's3' })] }), // no token → unattributed
    });
  });
  afterEach(() => { delete process.env['AGENTGATE_JWT_SECRET']; });

  it('timeline returns only the agent\'s attributed events, tagged by product', async () => {
    const res = await app.request(`/api/audit/timeline?agentId=${AGENT}&from=${from}&to=${to}`, { headers: admin() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEvents).toBe(2); // excludes agt_other + unattributed
    const products = body.events.map((e: any) => e.product).sort();
    expect(products).toEqual(['agentgate', 'agentlens']);
    expect(body.events.every((e: any) => e.verifiedAgentMethod === 'agentgate_token')).toBe(true);
  });

  it('timeline can filter by event type', async () => {
    const res = await app.request(`/api/audit/timeline?agentId=${AGENT}&from=${from}&to=${to}&types=approval_requested`, { headers: admin() });
    const body = await res.json();
    expect(body.totalEvents).toBe(1);
    expect(body.events[0].eventType).toBe('approval_requested');
  });

  it('exports a signed pack that verifies, and detects tampering', async () => {
    const exp = await app.request('/api/audit/evidence/export', {
      method: 'POST', headers: admin(), body: JSON.stringify({ agentId: AGENT, from, to }),
    });
    expect(exp.status).toBe(200);
    const packResp = (await exp.json()) as SignedEvidencePack;
    expect(packResp.totalEvents).toBe(2);
    expect(packResp.signature?.type).toBe('hmac');
    expect(packResp.chains).toHaveLength(1);
    expect(packResp.chains[0].verified).toBe(true);

    const ok = await app.request('/api/audit/evidence/verify', {
      method: 'POST', headers: admin(), body: JSON.stringify(packResp),
    });
    expect((await ok.json()).valid).toBe(true);

    const tampered = { ...packResp, totalEvents: 99 };
    const bad = await app.request('/api/audit/evidence/verify', {
      method: 'POST', headers: admin(), body: JSON.stringify(tampered),
    });
    expect((await bad.json()).valid).toBe(false);
  });

  it('isolates tenants — another tenant cannot see the agent\'s events (decision d)', async () => {
    const res = await app.request(`/api/audit/timeline?agentId=${AGENT}&from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${tenant2Key}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).totalEvents).toBe(0); // AGENT's events live in tenant 'default'
  });

  it('validates params: missing agentId/range, from>to, and >1 year', async () => {
    expect((await app.request(`/api/audit/timeline?from=${from}&to=${to}`, { headers: admin() })).status).toBe(400);
    expect((await app.request('/api/audit/evidence/export', {
      method: 'POST', headers: admin(), body: JSON.stringify({ agentId: AGENT }),
    })).status).toBe(400);
    // from > to
    expect((await app.request(`/api/audit/timeline?agentId=${AGENT}&from=${to}&to=${from}`, { headers: admin() })).status).toBe(400);
    // > 1 year
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();
    expect((await app.request(`/api/audit/timeline?agentId=${AGENT}&from=${longAgo}&to=${to}`, { headers: admin() })).status).toBe(400);
  });

  it('returns 501 from /verify when no signing key is configured', async () => {
    const noKeyApp = new Hono<{ Variables: AuthVariables }>();
    noKeyApp.use('/*', authMiddleware(db, false));
    noKeyApp.route('/api/audit/evidence', auditEvidenceRoutes(db)); // no signing key
    const res = await noKeyApp.request('/api/audit/evidence/verify', {
      method: 'POST', headers: admin(),
      body: JSON.stringify({ kind: 'agentlens.evidence-pack/v1', verifiedAgentId: AGENT }),
    });
    expect(res.status).toBe(501);
  });
});

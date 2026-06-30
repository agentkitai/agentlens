/**
 * Project isolation via the real HTTP/auth path (#228 / #232).
 *
 * Two projects under ONE org, sharing members/billing, must be isolated:
 *  - per-project API keys (tenant_id = the project) never see each other's data;
 *  - a JWT user who is a member of project A can read A (via X-Project-Id) but is
 *    403 on project B in the same org.
 *
 * This is the leak-class gate: it proves project isolation end-to-end, not just at
 * the store layer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, createApiKey, authHeaders } from './test-helpers.js';
import { OrgProjectStore } from '../db/org-project-store.js';
import { signJwt } from '../cloud/auth/jwt.js';
import { events } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';

const JWT_SECRET = 'test-jwt-secret';

describe('Project isolation via HTTP (#228 / #232)', () => {
  let app: Hono;
  let db: SqliteDb;
  let orgId: string;
  let projA: string;
  let projB: string;
  let keyA: string;
  let keyB: string;
  let aliceJwt: string;
  let prevSecret: string | undefined;

  async function ingest(key: string, agentId: string, sessionId: string) {
    return app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({
        events: [{ sessionId, agentId, eventType: 'session_started', payload: { agentName: agentId } }],
      }),
    });
  }

  async function listEvents(headers: Record<string, string>) {
    const res = await app.request('/api/events', { headers });
    const body = res.status === 200 ? ((await res.json()) as { events: Array<{ agentId: string }> }) : null;
    return { status: res.status, agents: body ? body.events.map((e) => e.agentId).sort() : [] };
  }

  beforeAll(async () => {
    prevSecret = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = JWT_SECRET;
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    const store = new OrgProjectStore(db);
    orgId = (await store.createOrg({ name: 'Acme' })).id;
    projA = (await store.createProject(orgId, { name: 'support' })).id;
    projB = (await store.createProject(orgId, { name: 'sales' })).id;
    // Alice is a member of project A only (not an org member) — so she cannot reach B.
    await store.addProjectMember(projA, 'alice', 'member');

    // Per-project API keys: the key's tenant_id IS its project (ADR 0002).
    keyA = createApiKey(db, { tenantId: projA });
    keyB = createApiKey(db, { tenantId: projB });
    aliceJwt = signJwt(
      { sub: 'alice', email: 'alice@test.com', name: 'Alice', orgs: [{ org_id: orgId, role: 'member' }] },
      JWT_SECRET,
    );

    await ingest(keyA, 'agt-a', 'sA');
    await ingest(keyB, 'agt-b', 'sB');
  });

  afterAll(() => {
    process.env['JWT_SECRET'] = prevSecret;
  });

  it('two projects under one org are isolated by API key (no cross-project leak)', async () => {
    expect((await listEvents(authHeaders(keyA))).agents).toEqual(['agt-a']);
    expect((await listEvents(authHeaders(keyB))).agents).toEqual(['agt-b']);
  });

  it('stamps the real org_id (not "default") on ingested events (#242)', async () => {
    const rows = db.select({ orgId: events.orgId, projectId: events.projectId }).from(events).where(eq(events.agentId, 'agt-a')).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.orgId).toBe(orgId); // the real org (projA belongs to it), not 'default'
    expect(rows[0]!.projectId).toBe(projA);
  });

  it('a JWT member of project A reads A (via X-Project-Id) but is 403 on B', async () => {
    const okA = await listEvents({ Authorization: `Bearer ${aliceJwt}`, 'X-Project-Id': projA });
    expect(okA.status).toBe(200);
    expect(okA.agents).toEqual(['agt-a']);

    const denyB = await listEvents({ Authorization: `Bearer ${aliceJwt}`, 'X-Project-Id': projB });
    expect(denyB.status).toBe(403);
  });
});

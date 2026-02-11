import { describe, it, expect, beforeEach } from 'vitest';
import { createPoolApp } from '../app.js';
import { InMemoryPoolStore } from '../store.js';
import type { PoolStore } from '../store.js';

function makeApp(opts: { apiKey?: string; adminKey?: string; authDisabled?: boolean } = {}) {
  const store = new InMemoryPoolStore();
  return { app: createPoolApp({ store, ...opts }), store };
}

function req(app: ReturnType<typeof makeApp>['app'], method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

const API_KEY = 'test-api-key';
const ADMIN_KEY = 'test-admin-key';

describe('Auth middleware', () => {
  // ─── Public routes ───

  it('allows public routes without auth', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/health');
    expect(res.status).toBe(200);
  });

  it('allows POST /pool/search without auth (public)', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'POST', '/pool/search', { embedding: [0.1, 0.2] });
    expect(res.status).toBe(200);
  });

  it('allows GET /pool/reputation/:id without auth (public)', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/reputation/some-id');
    expect(res.status).toBe(200);
  });

  // ─── Contributor routes ───

  it('rejects contributor route without auth', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/count?contributorId=abc');
    expect(res.status).toBe(401);
  });

  it('accepts contributor route with API key', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/count?contributorId=abc', undefined, API_KEY);
    expect(res.status).toBe(200);
  });

  it('accepts contributor route with admin key', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/count?contributorId=abc', undefined, ADMIN_KEY);
    expect(res.status).toBe(200);
  });

  it('rejects contributor route with wrong token', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/count?contributorId=abc', undefined, 'wrong-key');
    expect(res.status).toBe(401);
  });

  // ─── Agent routes ───

  it('rejects agent route without auth', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'POST', '/pool/discover', { taskType: 'code_review' });
    expect(res.status).toBe(401);
  });

  it('accepts agent route with API key', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'POST', '/pool/discover', { taskType: 'code_review' }, API_KEY);
    expect(res.status).toBe(200);
  });

  // ─── Admin routes ───

  it('rejects admin route without auth', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/moderation/queue');
    expect(res.status).toBe(401);
  });

  it('rejects admin route with API key (not admin key)', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/moderation/queue', undefined, API_KEY);
    expect(res.status).toBe(401);
  });

  it('accepts admin route with admin key', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY });
    const res = await req(app, 'GET', '/pool/moderation/queue', undefined, ADMIN_KEY);
    expect(res.status).toBe(200);
  });

  // ─── Auth disabled mode ───

  it('allows all routes when authDisabled=true', async () => {
    const { app } = makeApp({ apiKey: API_KEY, adminKey: ADMIN_KEY, authDisabled: true });
    const res1 = await req(app, 'GET', '/pool/moderation/queue');
    expect(res1.status).toBe(200);
    const res2 = await req(app, 'GET', '/pool/count?contributorId=abc');
    expect(res2.status).toBe(200);
  });

  // ─── No keys configured (backward compat) ───

  it('allows all routes when no keys configured', async () => {
    const { app } = makeApp();
    const res = await req(app, 'GET', '/pool/moderation/queue');
    expect(res.status).toBe(200);
  });
});

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, type CreateAuthMiddlewareOptions } from '../middleware/hono.js';
import { signAccessToken, hashToken } from '../jwt.js';
import type { AuthConfig, AuthContext } from '../types.js';
import { ROLE_PERMISSIONS } from '../rbac.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const AUTH_CONFIG: AuthConfig = {
  oidc: null,
  jwt: { secret: 'test-secret-at-least-32-chars-long!!', accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 86400 },
  authDisabled: false,
};

const API_KEY = 'als_testkey123';

const apiKeyAuthCtx: AuthContext = {
  identity: { type: 'api_key', id: 'key-1', displayName: 'Test Key', email: undefined, role: 'editor' },
  tenantId: 't1',
  permissions: ROLE_PERMISSIONS.editor,
};

const testUser = {
  id: 'user-1',
  tenantId: 't1',
  displayName: 'Alice',
  email: 'alice@example.com',
  role: 'admin' as const,
  disabledAt: null as Date | null,
};

function makeApp(overrides?: Partial<CreateAuthMiddlewareOptions>) {
  const app = new Hono();

  const mw = createAuthMiddleware({
    resolveApiKey: async (hash) => hash === hashToken(API_KEY) ? apiKeyAuthCtx : null,
    resolveUser: async (sub) => sub === 'user-1' ? { ...testUser } : null,
    authConfig: AUTH_CONFIG,
    authMode: 'dual',
    ...overrides,
  });

  app.use('*', mw);
  app.get('/me', (c) => {
    const auth = c.get('auth') as AuthContext;
    const apiKey = c.get('apiKey') as string | undefined;
    return c.json({ auth, apiKey: apiKey ?? null });
  });

  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function makeJwt(sub = 'user-1') {
  return signAccessToken({ sub, tid: 't1', role: 'admin', email: 'alice@example.com' }, AUTH_CONFIG);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  describe('API key flow', () => {
    it('authenticates with valid API key', async () => {
      const app = makeApp();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${API_KEY}` } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.auth.identity.type).toBe('api_key');
      expect(body.auth.identity.id).toBe('key-1');
      expect(body.apiKey).toBe(API_KEY);
    });

    it('rejects invalid API key', async () => {
      const app = makeApp();
      const res = await app.request('/me', { headers: { Authorization: 'Bearer als_invalid' } });
      expect(res.status).toBe(401);
    });

    it('populates c.get("apiKey") for backward compat', async () => {
      const app = makeApp();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${API_KEY}` } });
      const body = await res.json();
      expect(body.apiKey).toBe(API_KEY);
    });
  });

  describe('JWT flow', () => {
    it('authenticates with valid JWT in Authorization header', async () => {
      const app = makeApp();
      const jwt = await makeJwt();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.auth.identity.type).toBe('user');
      expect(body.auth.identity.id).toBe('user-1');
      expect(body.apiKey).toBeNull();
    });

    it('authenticates with JWT in session cookie', async () => {
      const app = makeApp();
      const jwt = await makeJwt();
      const res = await app.request('/me', { headers: { Cookie: `session=${jwt}` } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.auth.identity.type).toBe('user');
    });

    it('rejects invalid JWT', async () => {
      const app = makeApp();
      const res = await app.request('/me', { headers: { Authorization: 'Bearer not.a.jwt' } });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid or expired/);
    });

    it('rejects expired JWT', async () => {
      const expiredConfig: AuthConfig = { ...AUTH_CONFIG, jwt: { ...AUTH_CONFIG.jwt, accessTokenTtlSeconds: -1 } };
      const jwt = await signAccessToken({ sub: 'user-1', tid: 't1', role: 'admin', email: 'a@b.com' }, expiredConfig);
      const app = makeApp();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(401);
    });

    it('rejects disabled user', async () => {
      const app = makeApp({
        resolveUser: async () => ({ ...testUser, disabledAt: new Date() }),
      });
      const jwt = await makeJwt();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/disabled/i);
    });

    it('rejects unknown user', async () => {
      const app = makeApp();
      const jwt = await makeJwt('unknown-user');
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(401);
    });
  });

  describe('AuthContext shape parity', () => {
    it('both flows produce identical AuthContext shape', async () => {
      const app = makeApp();

      // API key
      const apiRes = await app.request('/me', { headers: { Authorization: `Bearer ${API_KEY}` } });
      const apiBody = await apiRes.json();

      // JWT
      const jwt = await makeJwt();
      const jwtRes = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      const jwtBody = await jwtRes.json();

      // Same top-level keys
      const apiKeys = Object.keys(apiBody.auth).sort();
      const jwtKeys = Object.keys(jwtBody.auth).sort();
      expect(apiKeys).toEqual(jwtKeys);

      // Both have required identity fields
      for (const key of ['type', 'id', 'displayName', 'role']) {
        expect(apiBody.auth.identity).toHaveProperty(key);
        expect(jwtBody.auth.identity).toHaveProperty(key);
      }
    });
  });

  describe('AUTH_MODE enforcement', () => {
    it('api-key-only rejects JWT', async () => {
      const app = makeApp({ authMode: 'api-key-only' });
      const jwt = await makeJwt();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(401);
    });

    it('api-key-only allows API key', async () => {
      const app = makeApp({ authMode: 'api-key-only' });
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${API_KEY}` } });
      expect(res.status).toBe(200);
    });

    it('oidc-required rejects API key', async () => {
      const app = makeApp({ authMode: 'oidc-required' });
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${API_KEY}` } });
      expect(res.status).toBe(401);
    });

    it('oidc-required allows JWT', async () => {
      const app = makeApp({ authMode: 'oidc-required' });
      const jwt = await makeJwt();
      const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(200);
    });
  });

  describe('no credentials', () => {
    it('returns 401 with clear message', async () => {
      const app = makeApp();
      const res = await app.request('/me');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/Authentication required/);
    });
  });
});

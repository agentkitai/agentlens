/**
 * E1-S7: Auth route handler tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes, type AuthRoutesConfig } from '../auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { users, refreshTokens } from '../../db/schema.sqlite.js';
import { signAccessToken, hashToken, OidcClient, type AuthConfig } from '@agentkit/auth';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

class MockOidcClient extends OidcClient {
  constructor() { super({ issuerUrl: 'https://idp.example.com', clientId: 'test', clientSecret: 'secret', redirectUri: 'http://localhost/auth/callback', tenantClaim: 'tenant_id', roleClaim: 'role' }); }
  static override generateState() { return 'test-state-123'; }
  static override generateCodeVerifier() { return 'test-verifier-456'; }
  override async getAuthorizationUrl(state: string, _verifier: string) {
    return `https://idp.example.com/authorize?state=${state}&code_challenge=xxx`;
  }
  override async exchangeCode(code: string, _verifier: string) {
    if (code === 'bad-code') throw new Error('invalid_grant');
    return {
      accessToken: 'idp-access-token',
      idToken: 'idp-id-token',
      claims: { sub: 'oidc-subject-1', email: 'user@example.com', name: 'Test User', tenantId: 'tenant-1', role: 'editor' as const },
    };
  }
}

const authConfig: AuthConfig = {
  oidc: null,
  jwt: {
    secret: 'test-secret-at-least-32-characters-long',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
  },
  authDisabled: false,
};

const routeConfig: AuthRoutesConfig = {
  oidcConfig: {
    issuerUrl: 'https://idp.example.com',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3000/auth/callback',
    tenantClaim: 'tenant_id',
    roleClaim: 'role',
  },
  authConfig,
};

function createApp(db: any) {
  const app = new Hono();
  app.route('/auth', authRoutes(db, { ...routeConfig, oidcClient: new MockOidcClient() as any }));
  return app;
}

function parseCookies(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const headers = res.headers.getSetCookie?.() ?? [];
  for (const h of headers) {
    const match = h.match(/^([^=]+)=([^;]*)/);
    if (match) cookies[match[1]] = match[2];
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

describe('Auth Routes', () => {
  let db: any;
  let app: any;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    app = createApp(db);
  });

  describe('GET /auth/login', () => {
    it('redirects to IdP with state and PKCE cookies', async () => {
      const res = await app.request('/auth/login');
      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toContain('idp.example.com/authorize');
      
      const cookies = parseCookies(res);
      expect(cookies['pkce_verifier']).toBeDefined();
      expect(cookies['oauth_state']).toBeDefined();
    });
  });

  describe('GET /auth/callback', () => {
    it('returns 400 for invalid state', async () => {
      const res = await app.request('/auth/callback?code=test&state=wrong', {
        headers: { Cookie: 'oauth_state=correct; pkce_verifier=verifier' },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('state');
    });

    it('returns 400 when no state cookie', async () => {
      const res = await app.request('/auth/callback?code=test&state=test');
      expect(res.status).toBe(400);
    });

    it('returns 401 for invalid code', async () => {
      const res = await app.request('/auth/callback?code=bad-code&state=matching', {
        headers: { Cookie: 'oauth_state=matching; pkce_verifier=verifier' },
      });
      expect(res.status).toBe(401);
    });

    it('creates user and issues cookies on success', async () => {
      const res = await app.request('/auth/callback?code=good-code&state=matching', {
        headers: { Cookie: 'oauth_state=matching; pkce_verifier=verifier' },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/dashboard');

      const cookies = parseCookies(res);
      expect(cookies['session']).toBeDefined();
      expect(cookies['refresh_token']).toBeDefined();

      // User should exist in DB
      const userRows = await db.select().from(users).all();
      expect(userRows.length).toBe(1);
      expect(userRows[0].email).toBe('user@example.com');
      expect(userRows[0].oidcSubject).toBe('oidc-subject-1');
    });

    it('upserts existing user on repeat login', async () => {
      // First login
      await app.request('/auth/callback?code=good-code&state=s1', {
        headers: { Cookie: 'oauth_state=s1; pkce_verifier=v1' },
      });
      // Second login
      await app.request('/auth/callback?code=good-code&state=s2', {
        headers: { Cookie: 'oauth_state=s2; pkce_verifier=v2' },
      });

      const userRows = await db.select().from(users).all();
      expect(userRows.length).toBe(1); // Same user, not duplicated
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 401 without refresh cookie', async () => {
      const res = await app.request('/auth/refresh', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('rotates refresh token and issues new JWT', async () => {
      // Set up a user and refresh token
      const userId = 'user-1';
      const now = Math.floor(Date.now() / 1000);
      await db.insert(users).values({
        id: userId, tenantId: 'default', email: 'test@test.com',
        role: 'editor', createdAt: now, updatedAt: now,
      });
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(rawToken);
      await db.insert(refreshTokens).values({
        id: 'rt-1', userId, tenantId: 'default', tokenHash,
        expiresAt: now + 86400, createdAt: now,
      });

      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { Cookie: `refresh_token=${rawToken}` },
      });
      expect(res.status).toBe(200);

      const cookies = parseCookies(res);
      expect(cookies['session']).toBeDefined();
      expect(cookies['refresh_token']).toBeDefined();
      expect(cookies['refresh_token']).not.toBe(rawToken);

      // Old token should be revoked
      const oldRow = await db.select().from(refreshTokens).where(eq(refreshTokens.id, 'rt-1'));
      expect(oldRow[0].revokedAt).not.toBeNull();
    });

    it('returns 401 for expired refresh token', async () => {
      const userId = 'user-2';
      const now = Math.floor(Date.now() / 1000);
      await db.insert(users).values({
        id: userId, tenantId: 'default', email: 'expired@test.com',
        role: 'viewer', createdAt: now, updatedAt: now,
      });
      const rawToken = randomBytes(32).toString('base64url');
      await db.insert(refreshTokens).values({
        id: 'rt-expired', userId, tenantId: 'default',
        tokenHash: hashToken(rawToken),
        expiresAt: now - 1000, createdAt: now - 2000,
      });

      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { Cookie: `refresh_token=${rawToken}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes refresh token and clears cookies', async () => {
      const userId = 'user-3';
      const now = Math.floor(Date.now() / 1000);
      await db.insert(users).values({
        id: userId, tenantId: 'default', email: 'logout@test.com',
        role: 'viewer', createdAt: now, updatedAt: now,
      });
      const rawToken = randomBytes(32).toString('base64url');
      await db.insert(refreshTokens).values({
        id: 'rt-logout', userId, tenantId: 'default',
        tokenHash: hashToken(rawToken),
        expiresAt: now + 86400, createdAt: now,
      });

      const res = await app.request('/auth/logout', {
        method: 'POST',
        headers: { Cookie: `refresh_token=${rawToken}; session=something` },
      });
      expect(res.status).toBe(200);

      // Refresh token should be revoked
      const row = await db.select().from(refreshTokens).where(eq(refreshTokens.id, 'rt-logout'));
      expect(row[0].revokedAt).not.toBeNull();
    });

    it('returns 200 even without refresh cookie', async () => {
      const res = await app.request('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without token', async () => {
      const res = await app.request('/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns user info from JWT cookie', async () => {
      const token = await signAccessToken(
        { sub: 'user-me', tid: 'tenant-1', role: 'admin', email: 'me@test.com' },
        authConfig,
      );

      const res = await app.request('/auth/me', {
        headers: { Cookie: `session=${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('user-me');
      expect(body.email).toBe('me@test.com');
      expect(body.role).toBe('admin');
      expect(body.tenantId).toBe('tenant-1');
    });

    it('returns user info from Authorization header', async () => {
      const token = await signAccessToken(
        { sub: 'user-me-2', tid: 'default', role: 'viewer', email: 'me2@test.com' },
        authConfig,
      );

      const res = await app.request('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('user-me-2');
    });
  });
});

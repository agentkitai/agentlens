/**
 * E1-S7: Auth Route Handlers
 *
 * GET  /auth/login    — PKCE + state cookie, redirect to IdP
 * GET  /auth/callback — exchange code, upsert user, issue cookies, redirect
 * POST /auth/refresh  — rotate refresh token, issue new JWT
 * POST /auth/logout   — revoke refresh token, clear cookies
 * GET  /auth/me       — return user info from JWT claims
 */

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { users, refreshTokens } from '../db/schema.sqlite.js';
import {
  OidcClient,
  signAccessToken,
  verifyAccessToken,
  hashToken,
  type AuthConfig,
  type Role,
} from 'agentkit-auth';
import type { OidcConfig } from 'agentkit-auth';

// Cookie names
const SESSION_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh_token';
const PKCE_COOKIE = 'pkce_verifier';
const STATE_COOKIE = 'oauth_state';

// Cookie options
const secureCookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
};

export interface AuthRoutesConfig {
  oidcConfig: OidcConfig;
  authConfig: AuthConfig;
  /** Injectable for testing */
  oidcClient?: OidcClient;
}

export function authRoutes(db: SqliteDb, config: AuthRoutesConfig) {
  const app = new Hono();
  const oidcClient = config.oidcClient ?? new OidcClient(config.oidcConfig);

  // ── GET /login ─────────────────────────────────────────
  app.get('/login', async (c) => {
    try {
      const state = OidcClient.generateState();
      const codeVerifier = OidcClient.generateCodeVerifier();

      // Store PKCE verifier + state in short-lived cookies (5 min)
      setCookie(c, PKCE_COOKIE, codeVerifier, { ...secureCookieOpts, maxAge: 300 });
      setCookie(c, STATE_COOKIE, state, { ...secureCookieOpts, maxAge: 300 });

      const authUrl = await oidcClient.getAuthorizationUrl(state, codeVerifier);
      return c.redirect(authUrl);
    } catch (err) {
      // IdP unreachable during discovery
      return c.json({ error: 'Identity provider unreachable' }, 502);
    }
  });

  // ── GET /callback ──────────────────────────────────────
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const returnedState = c.req.query('state');
    const savedState = getCookie(c, STATE_COOKIE);
    const codeVerifier = getCookie(c, PKCE_COOKIE);

    // Clear PKCE cookies immediately
    deleteCookie(c, STATE_COOKIE, { path: '/' });
    deleteCookie(c, PKCE_COOKIE, { path: '/' });

    // Validate state
    if (!returnedState || !savedState || returnedState !== savedState) {
      return c.json({ error: 'Invalid state parameter' }, 400);
    }

    if (!code || !codeVerifier) {
      return c.json({ error: 'Missing code or PKCE verifier' }, 400);
    }

    // Exchange code for tokens
    let tokenSet;
    try {
      tokenSet = await oidcClient.exchangeCode(code, codeVerifier);
    } catch (err: any) {
      // Distinguish IdP unreachable from invalid code
      if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || err?.cause?.code === 'ECONNREFUSED') {
        return c.json({ error: 'Identity provider unreachable' }, 502);
      }
      return c.json({ error: 'Invalid authorization code' }, 401);
    }

    const claims = tokenSet.claims;
    const now = Math.floor(Date.now() / 1000);
    const tenantId = claims.tenantId ?? 'default';
    const validRoles: Role[] = ['viewer', 'editor', 'admin', 'owner'];
    const claimedRole = claims.role as string | undefined;
    const role: Role = (claimedRole && validRoles.includes(claimedRole as Role))
      ? (claimedRole as Role)
      : 'viewer';

    // Upsert user (JIT provisioning)
    const userId = await upsertUser(db, {
      email: claims.email ?? claims.sub,
      displayName: claims.name ?? claims.email ?? claims.sub,
      oidcSubject: claims.sub,
      oidcIssuer: config.oidcConfig.issuerUrl,
      tenantId,
      role,
      now,
    });

    // Issue JWT access token
    const accessToken = await signAccessToken(
      { sub: userId, tid: tenantId, role, email: claims.email ?? claims.sub },
      config.authConfig,
    );

    // Issue refresh token
    const refreshRaw = randomBytes(32).toString('base64url');
    const refreshHash = hashToken(refreshRaw);
    const refreshId = randomBytes(16).toString('hex');
    const refreshTtl = config.authConfig.jwt.refreshTokenTtlSeconds ?? 7 * 86400;

    await db.insert(refreshTokens).values({
      id: refreshId,
      userId,
      tenantId,
      tokenHash: refreshHash,
      expiresAt: now + refreshTtl,
      createdAt: now,
    });

    // Set cookies
    const accessTtl = config.authConfig.jwt.accessTokenTtlSeconds ?? 900;
    setCookie(c, SESSION_COOKIE, accessToken, { ...secureCookieOpts, maxAge: accessTtl });
    setCookie(c, REFRESH_COOKIE, refreshRaw, { ...secureCookieOpts, maxAge: refreshTtl });

    return c.redirect('/dashboard');
  });

  // ── POST /refresh ──────────────────────────────────────
  app.post('/refresh', async (c) => {
    const refreshRaw = getCookie(c, REFRESH_COOKIE);
    if (!refreshRaw) {
      return c.json({ error: 'No refresh token' }, 401);
    }

    const hash = hashToken(refreshRaw);
    const now = Math.floor(Date.now() / 1000);

    // Find valid refresh token
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
      .limit(1);

    const row = rows[0];
    if (!row || row.expiresAt < now) {
      deleteCookie(c, REFRESH_COOKIE, { path: '/' });
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    // Revoke old token
    await db.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));

    // Look up user
    const userRows = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    const user = userRows[0];
    if (!user || user.disabledAt) {
      return c.json({ error: 'User not found or disabled' }, 401);
    }

    // Issue new refresh token
    const newRefreshRaw = randomBytes(32).toString('base64url');
    const newRefreshHash = hashToken(newRefreshRaw);
    const newRefreshId = randomBytes(16).toString('hex');
    const refreshTtl = config.authConfig.jwt.refreshTokenTtlSeconds ?? 7 * 86400;

    await db.insert(refreshTokens).values({
      id: newRefreshId,
      userId: user.id,
      tenantId: row.tenantId,
      tokenHash: newRefreshHash,
      expiresAt: now + refreshTtl,
      createdAt: now,
    });

    // Issue new access token
    const accessToken = await signAccessToken(
      { sub: user.id, tid: row.tenantId, role: user.role as Role, email: user.email },
      config.authConfig,
    );

    const accessTtl = config.authConfig.jwt.accessTokenTtlSeconds ?? 900;
    setCookie(c, SESSION_COOKIE, accessToken, { ...secureCookieOpts, maxAge: accessTtl });
    setCookie(c, REFRESH_COOKIE, newRefreshRaw, { ...secureCookieOpts, maxAge: refreshTtl });

    return c.json({ ok: true });
  });

  // ── POST /logout ───────────────────────────────────────
  app.post('/logout', async (c) => {
    const refreshRaw = getCookie(c, REFRESH_COOKIE);
    if (refreshRaw) {
      const hash = hashToken(refreshRaw);
      const now = Math.floor(Date.now() / 1000);
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)));
    }

    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    deleteCookie(c, REFRESH_COOKIE, { path: '/' });

    return c.json({ ok: true });
  });

  // ── GET /me ────────────────────────────────────────────
  app.get('/me', async (c) => {
    // Check session cookie or Authorization header
    const authHeader = c.req.header('Authorization');
    let token: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
    token = token ?? getCookie(c, SESSION_COOKIE);

    if (!token) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    const claims = await verifyAccessToken(token, config.authConfig);
    if (!claims) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    return c.json({
      id: claims.sub,
      tenantId: claims.tid,
      role: claims.role,
      email: claims.email,
    });
  });

  return app;
}

// ── User Upsert (JIT Provisioning) ──────────────────────────
async function upsertUser(
  db: SqliteDb,
  params: {
    email: string;
    displayName: string;
    oidcSubject: string;
    oidcIssuer: string;
    tenantId: string;
    role: Role;
    now: number;
  },
): Promise<string> {
  const { email, displayName, oidcSubject, oidcIssuer, tenantId, role, now } = params;

  // Try to find existing user by OIDC subject
  const existing = await db
    .select()
    .from(users)
    .where(and(eq(users.oidcIssuer, oidcIssuer), eq(users.oidcSubject, oidcSubject)))
    .limit(1);

  if (existing[0]) {
    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now, displayName })
      .where(eq(users.id, existing[0].id));
    return existing[0].id;
  }

  // Create new user
  const id = randomBytes(16).toString('hex');
  await db.insert(users).values({
    id,
    tenantId,
    email,
    displayName,
    oidcSubject,
    oidcIssuer,
    role,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });

  return id;
}

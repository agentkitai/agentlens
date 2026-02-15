// @agentkit/auth — Hono middleware

import type { Context, Next } from 'hono';
import type { AuthContext, AuthConfig, Permission, Role } from '../types.js';
import { hasPermission, ROLE_PERMISSIONS } from '../rbac.js';
import { verifyAccessToken, hashToken } from '../jwt.js';
import { getAuthMode, type AuthMode } from '../config.js';

// ── Types for the dual-auth middleware factory ───────────────────────

export interface ResolvedUser {
  id: string;
  tenantId: string;
  displayName: string;
  email: string;
  role: Role;
  disabledAt?: Date | null;
}

export interface CreateAuthMiddlewareOptions {
  /** Look up API key by its SHA-256 hash. Return AuthContext or null. */
  resolveApiKey: (hash: string) => Promise<AuthContext | null>;
  /** Look up a user by subject ID (from JWT `sub`). Return user or null. */
  resolveUser: (sub: string) => Promise<ResolvedUser | null>;
  /** JWT / auth configuration */
  authConfig: AuthConfig;
  /** Override AUTH_MODE (otherwise read from env) */
  authMode?: AuthMode;
}

const API_KEY_PREFIX = 'als_';

/**
 * Factory that creates a Hono middleware accepting EITHER API key OR JWT.
 *
 * - API key: `Authorization: Bearer als_...` → hash → resolveApiKey callback
 * - JWT: `Authorization: Bearer <jwt>` or `session` cookie → verify → resolveUser callback
 */
export function createAuthMiddleware(opts: CreateAuthMiddlewareOptions) {
  const { resolveApiKey, resolveUser, authConfig } = opts;

  return async (c: Context, next: Next) => {
    const mode = opts.authMode ?? getAuthMode(c.env as Record<string, string | undefined>);

    // Extract token from Authorization header or session cookie
    const authHeader = c.req.header('Authorization');
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    const sessionCookie = getCookie(c, 'session');

    // ── API key flow ───────────────────────────────────────────────
    if (token?.startsWith(API_KEY_PREFIX)) {
      if (mode === 'oidc-required') {
        return c.json({ error: 'API key authentication is not allowed in oidc-required mode' }, 401);
      }

      const hash = hashToken(token);
      const authCtx = await resolveApiKey(hash);

      if (!authCtx) {
        return c.json({ error: 'Invalid API key' }, 401);
      }

      c.set('auth', authCtx);
      c.set('apiKey', token); // backward compat
      return next();
    }

    // ── JWT flow ───────────────────────────────────────────────────
    const jwtToken = token ?? sessionCookie;

    if (jwtToken) {
      if (mode === 'api-key-only') {
        return c.json({ error: 'JWT authentication is not allowed in api-key-only mode' }, 401);
      }

      const claims = await verifyAccessToken(jwtToken, authConfig);
      if (!claims) {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }

      const user = await resolveUser(claims.sub);
      if (!user) {
        return c.json({ error: 'User not found' }, 401);
      }

      if (user.disabledAt) {
        return c.json({ error: 'User account is disabled' }, 401);
      }

      const authCtx: AuthContext = {
        identity: {
          type: 'user',
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        },
        tenantId: user.tenantId,
        permissions: ROLE_PERMISSIONS[user.role] ?? [],
      };

      c.set('auth', authCtx);
      return next();
    }

    // ── No credentials ─────────────────────────────────────────────
    return c.json({ error: 'Authentication required. Provide a Bearer token (API key or JWT) or session cookie.' }, 401);
  };
}

/** Minimal cookie parser — avoids importing hono/cookie */
function getCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('Cookie');
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

/**
 * Hono middleware factory that requires a specific permission.
 * Expects `auth` to be set on the context variable (e.g. by an upstream auth middleware).
 */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined;

    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!hasPermission(auth.permissions, permission)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}

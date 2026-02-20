/**
 * Unified Auth Middleware [F2-S1]
 *
 * Single Hono middleware accepting three credential types:
 *   1. als_* API keys — SHA-256 hash lookup (existing OSS flow)
 *   2. al_live_* / al_test_* cloud keys — cloud key verification
 *   3. JWT Bearer / Cookie session — JWT verification via verifyJwt()
 *
 * Produces a normalized AuthContext on c.var.auth and sets the legacy
 * c.var.apiKey for backward compatibility with all existing route handlers.
 */

import { createMiddleware } from 'hono/factory';
import type { IApiKeyLookup } from '../db/api-key-lookup.js';
import type { SqliteDb } from '../db/index.js';
import { hashApiKey, type ApiKeyInfo } from './auth.js';
import {
  missingCredentials,
  invalidApiKey,
  expiredApiKey,
  expiredJwt,
  invalidJwt,
  invalidCloudKey,
} from './auth-errors.js';

// ── Types ──────────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'auditor' | 'member' | 'viewer';

export interface AuthContext {
  type: 'api-key' | 'jwt';
  userId: string | null;
  orgId: string;
  role: Role;
  scopes: string[];
  keyId: string | null;
}

export type UnifiedAuthVariables = {
  auth: AuthContext;
  apiKey: ApiKeyInfo;
};

export interface UnifiedAuthConfig {
  authDisabled: boolean;
  jwtSecret?: string;
  /** Optional cloud API key middleware instance */
  cloudKeyAuth?: {
    authenticate(authHeader: string | undefined): Promise<{
      orgId: string;
      keyId: string;
      scopes: string[];
    }>;
  };
}

// ── Helpers ────────────────────────────────────────────────

function deriveRoleFromScopes(scopes: string[]): Role {
  if (scopes.includes('*')) return 'admin';
  if (scopes.includes('manage')) return 'admin';
  if (scopes.includes('audit')) return 'auditor';
  if (scopes.includes('write')) return 'member';
  return 'viewer';
}

function parseScopes(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Check if a JWT token is expired without full verification.
 * Used to distinguish expired vs. invalid tokens for better error messages.
 */
function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return true;
    return false;
  } catch {
    return false;
  }
}

// ── Factory ────────────────────────────────────────────────

/**
 * Create the unified auth middleware.
 *
 * @param dbOrLookup - Drizzle SQLite DB or IApiKeyLookup for als_* key verification
 * @param config - Auth configuration
 */
export function unifiedAuthMiddleware(
  dbOrLookup: SqliteDb | IApiKeyLookup | null,
  config: UnifiedAuthConfig,
) {
  // Lazy-load verifyJwt to avoid import issues when JWT_SECRET isn't set
  let _verifyJwt: ((token: string, secret: string) => import('../cloud/auth/jwt.js').JwtPayload | null) | undefined;

  async function getVerifyJwt() {
    if (!_verifyJwt) {
      const mod = await import('../cloud/auth/jwt.js');
      _verifyJwt = mod.verifyJwt;
    }
    return _verifyJwt;
  }

  return createMiddleware<{ Variables: UnifiedAuthVariables }>(async (c, next) => {
    // ── 1. AUTH_DISABLED bypass ──────────────────────────
    if (config.authDisabled) {
      const devAuth: AuthContext = {
        type: 'api-key',
        userId: null,
        orgId: 'default',
        role: 'owner',
        scopes: ['*'],
        keyId: 'dev',
      };
      c.set('auth', devAuth);
      c.set('apiKey', { id: 'dev', name: 'dev-mode', scopes: ['*'], tenantId: 'default' });
      return next();
    }

    // ── 2. Extract credentials ───────────────────────────
    const authHeader = c.req.header('Authorization');
    let token: string | null = null;
    let fromCookie = false;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fall back to session cookie (JWT only, for dashboard)
    if (!token) {
      const cookieHeader = c.req.header('Cookie');
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)session=([^\s;]+)/);
        if (match) {
          token = match[1]!;
          fromCookie = true;
        }
      }
    }

    if (!token) {
      return missingCredentials(c);
    }

    // ── 3. als_* key (OSS SHA-256 lookup) ────────────────
    if (token.startsWith('als_')) {
      if (!dbOrLookup) {
        return invalidApiKey(c);
      }

      const keyHash = hashApiKey(token);

      if ('findByHash' in dbOrLookup) {
        const lookup = dbOrLookup as IApiKeyLookup;
        const row = await lookup.findByHash(keyHash);

        if (!row) {
          return invalidApiKey(c);
        }

        if (row.expiresAt) {
          const now = Math.floor(Date.now() / 1000);
          if (now > row.expiresAt) {
            return expiredApiKey(c);
          }
        }

        // Fire-and-forget lastUsedAt update
        void lookup.updateLastUsed(row.id);

        const scopes = parseScopes(row.scopes);
        const role = deriveRoleFromScopes(scopes);

        const authCtx: AuthContext = {
          type: 'api-key',
          userId: null,
          orgId: row.tenantId,
          role,
          scopes,
          keyId: row.id,
        };
        c.set('auth', authCtx);
        c.set('apiKey', { id: row.id, name: row.name, scopes, tenantId: row.tenantId });
        return next();
      }

      // Legacy SQLite db path
      const { apiKeys: apiKeysTable } = await import('../db/schema.sqlite.js');
      const { eq, and, isNull } = await import('drizzle-orm');
      const db = dbOrLookup as SqliteDb;
      const row = db
        .select()
        .from(apiKeysTable)
        .where(and(eq(apiKeysTable.keyHash, keyHash), isNull(apiKeysTable.revokedAt)))
        .get();

      if (!row) {
        return invalidApiKey(c);
      }

      if (row.expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        if (now > row.expiresAt) {
          return expiredApiKey(c);
        }
      }

      // Fire-and-forget lastUsedAt
      const now = Math.floor(Date.now() / 1000);
      try {
        db.update(apiKeysTable).set({ lastUsedAt: now }).where(eq(apiKeysTable.id, row.id)).run();
      } catch { /* non-critical */ }

      const scopes = parseScopes(row.scopes);
      const role = deriveRoleFromScopes(scopes);

      const authCtx: AuthContext = {
        type: 'api-key',
        userId: null,
        orgId: row.tenantId,
        role,
        scopes,
        keyId: row.id,
      };
      c.set('auth', authCtx);
      c.set('apiKey', { id: row.id, name: row.name, scopes, tenantId: row.tenantId });
      return next();
    }

    // ── 4. al_live_* / al_test_* (cloud key) ────────────
    if (token.startsWith('al_live_') || token.startsWith('al_test_')) {
      if (!config.cloudKeyAuth) {
        return invalidCloudKey(c);
      }

      try {
        const result = await config.cloudKeyAuth.authenticate(`Bearer ${token}`);
        const scopes = result.scopes ?? [];
        const role = deriveRoleFromScopes(scopes);

        const authCtx: AuthContext = {
          type: 'api-key',
          userId: null,
          orgId: result.orgId,
          role,
          scopes,
          keyId: result.keyId,
        };
        c.set('auth', authCtx);
        c.set('apiKey', {
          id: result.keyId,
          name: 'cloud-key',
          scopes,
          tenantId: result.orgId,
        });
        return next();
      } catch {
        return invalidCloudKey(c);
      }
    }

    // ── 5. JWT (Bearer or cookie) ────────────────────────
    const jwtSecret = config.jwtSecret ?? process.env['JWT_SECRET'];
    if (!jwtSecret) {
      // No JWT_SECRET configured — can't verify JWTs
      return invalidJwt(c);
    }

    const verifyJwt = await getVerifyJwt();
    const payload = verifyJwt(token, jwtSecret);

    if (!payload) {
      // Check if expired for better error message
      if (isJwtExpired(token)) {
        return expiredJwt(c);
      }
      return invalidJwt(c);
    }

    const orgInfo = payload.orgs?.[0];
    const role: Role = (orgInfo?.role as Role) ?? 'viewer';
    const orgId = orgInfo?.org_id ?? 'default';

    const authCtx: AuthContext = {
      type: 'jwt',
      userId: payload.sub,
      orgId,
      role,
      scopes: ['*'],
      keyId: null,
    };
    c.set('auth', authCtx);
    c.set('apiKey', {
      id: payload.sub ?? 'jwt',
      name: 'jwt-session',
      scopes: ['*'],
      tenantId: orgId,
    });
    return next();
  });
}

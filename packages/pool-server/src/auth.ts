// Pool server authentication middleware

import { timingSafeEqual, createHash } from 'node:crypto';
import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';

/** H-5 FIX: Timing-safe string comparison for API keys */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    const hashA = createHash('sha256').update(bufA).digest();
    const hashB = createHash('sha256').update(bufB).digest();
    return timingSafeEqual(hashA, hashB);
  }
  return timingSafeEqual(bufA, bufB);
}

export type AuthScope = 'admin' | 'agent' | 'contributor' | 'public';

export interface AuthOptions {
  apiKey?: string;
  adminKey?: string;
  authDisabled?: boolean;
}

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(c: Context): string | undefined {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7);
}

/**
 * Create a Hono middleware that enforces the given scope.
 * - `public` — no auth required
 * - `contributor` / `agent` — requires POOL_API_KEY or POOL_ADMIN_KEY
 * - `admin` — requires POOL_ADMIN_KEY only
 *
 * When `authDisabled` is true, all requests pass through.
 */
export function requireAuth(scope: AuthScope, options: AuthOptions) {
  return createMiddleware(async (c: Context, next: Next) => {
    // Auth disabled explicitly or no keys configured — pass through
    if (options.authDisabled || (!options.apiKey && !options.adminKey)) {
      return next();
    }

    if (scope === 'public') {
      return next();
    }

    const token = extractBearerToken(c);
    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    if (scope === 'admin') {
      if (options.adminKey && safeCompare(token, options.adminKey)) {
        return next();
      }
      return c.json({ error: 'Invalid or insufficient credentials' }, 401);
    }

    // agent or contributor — accept either apiKey or adminKey
    if ((options.apiKey && safeCompare(token, options.apiKey)) || (options.adminKey && safeCompare(token, options.adminKey))) {
      return next();
    }

    return c.json({ error: 'Invalid or insufficient credentials' }, 401);
  });
}

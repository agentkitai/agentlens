// Pool server authentication middleware

import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';

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
      if (options.adminKey && token === options.adminKey) {
        return next();
      }
      return c.json({ error: 'Invalid or insufficient credentials' }, 401);
    }

    // agent or contributor — accept either apiKey or adminKey
    if ((options.apiKey && token === options.apiKey) || (options.adminKey && token === options.adminKey)) {
      return next();
    }

    return c.json({ error: 'Invalid or insufficient credentials' }, 401);
  });
}

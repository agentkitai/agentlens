/**
 * SH-4: CORS Hardening — explicit origin callback for hono/cors.
 *
 * Reads CORS_ORIGINS (comma-separated) and builds an origin callback that:
 * - Rejects unlisted origins (returns empty string → no CORS headers)
 * - Blocks wildcard '*' in production
 * - Auto-allows http://localhost:* in dev mode
 * - Supports credentials, explicit allowed/exposed headers, and maxAge
 */

/** Local mirror of hono/cors CORSOptions (not exported by the package). */
type CorsOptions = {
  origin: string | string[] | ((origin: string) => string);
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
  exposeHeaders?: string[];
};

export interface CorsConfig {
  /** Comma-separated allowed origins, or a single origin */
  corsOrigins?: string;
  /** NODE_ENV value */
  nodeEnv?: string;
}

/**
 * Parse CORS_ORIGINS env var into a Set of allowed origins.
 */
function parseOrigins(raw?: string): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw.split(',')
      .map(o => o.trim())
      .filter(Boolean),
  );
}

/**
 * Build hono/cors options with an explicit origin callback.
 */
export function buildCorsOptions(config: CorsConfig): CorsOptions {
  const isDev = config.nodeEnv !== 'production';
  const origins = parseOrigins(config.corsOrigins);

  // Block wildcard in production
  if (!isDev && origins.has('*')) {
    throw new Error(
      'CORS wildcard (*) is not allowed in production. ' +
      'Set CORS_ORIGINS to specific origins.',
    );
  }

  return {
    origin: (requestOrigin: string) => {
      // No origin header (e.g. same-origin, server-to-server) — allow
      if (!requestOrigin) return requestOrigin;

      // Exact match
      if (origins.has(requestOrigin)) return requestOrigin;

      // Wildcard in dev
      if (isDev && origins.has('*')) return requestOrigin;

      // Dev mode: auto-allow localhost on any port
      if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)) {
        return requestOrigin;
      }

      // Reject — return empty string so hono/cors omits CORS headers
      return '';
    },
    credentials: true,
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
  };
}

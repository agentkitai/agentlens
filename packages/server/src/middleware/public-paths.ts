/**
 * Public route allowlist [F2-S7]
 *
 * The unified auth catch-all (`app.use('/api/*', ...)`) and the RBAC guards run
 * before any route handler. A small set of routes are intentionally reachable
 * without the standard Bearer/JWT credential because they either (a) must be
 * callable before login or (b) implement their own authentication scheme.
 *
 * This allowlist is deliberately narrow — see route-coverage-auth.test.ts which
 * asserts that every other /api/* route fails closed with 401.
 *
 *   - GET /api/config/features  — feature flags the dashboard reads before login
 *     (public; returns only non-sensitive flags). Exact match only: all other
 *     /api/config/* routes remain protected.
 *   - /api/stream               — SSE endpoint; EventSource cannot send headers,
 *     so it authenticates via a ?token= query param inside its own handler.
 *   - /api/events/ingest        — webhook ingest; authenticates via HMAC signature
 *     verification in its own handler, not via API key.
 *   - /api/internal             — internal service-to-service endpoints (e.g.
 *     AgentGate spend reads); authenticate via the AGENTGATE_SERVICE_TOKEN
 *     bearer in their own handler, not via a user API key / JWT.
 *
 * Health (`/api/health`) is registered before the auth middleware, so it does not
 * need an entry here.
 */

/** Routes matched exactly (path only, query string ignored). */
const EXACT_PUBLIC_PATHS = new Set<string>([
  '/api/config/features',
]);

/** Routes whose own handler performs authentication; matched by prefix. */
const SELF_AUTH_PREFIXES = [
  '/api/stream',
  '/api/events/ingest',
  '/api/internal',
];

/**
 * Whether the given request path should bypass the standard auth + RBAC chain.
 *
 * @param path - The request pathname (no query string).
 */
export function isPublicPath(path: string): boolean {
  if (EXACT_PUBLIC_PATHS.has(path)) return true;
  for (const prefix of SELF_AUTH_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

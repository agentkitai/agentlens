/**
 * API Version Middleware (Feature 9 — API Contract Governance)
 *
 * Reads `X-API-Version` header from requests, validates it against
 * supported versions, and sets the response header.
 *
 * Current: v1. Future: v2 path reserved.
 */

import { createMiddleware } from 'hono/factory';

/** All API versions this server understands */
export const SUPPORTED_API_VERSIONS = ['v1'] as const;

/** The current (default) API version */
export const CURRENT_API_VERSION = 'v1';

export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

/**
 * Middleware that:
 * 1. Reads `X-API-Version` from the request (defaults to CURRENT_API_VERSION)
 * 2. Sets `X-API-Version` on the response
 * 3. Stores the resolved version on the Hono context as `apiVersion`
 */
export const apiVersionMiddleware = createMiddleware(async (c, next) => {
  const requested = c.req.header('X-API-Version') ?? CURRENT_API_VERSION;

  // Normalize: strip leading 'v' for comparison if needed
  const normalized = requested.startsWith('v') ? requested : `v${requested}`;

  // If the requested version is not supported, still proceed with current
  // but warn via a response header
  const resolved = (SUPPORTED_API_VERSIONS as readonly string[]).includes(normalized)
    ? (normalized as ApiVersion)
    : CURRENT_API_VERSION;

  if (!(SUPPORTED_API_VERSIONS as readonly string[]).includes(normalized)) {
    c.header('X-API-Version-Warning', `Unsupported version '${requested}', falling back to ${CURRENT_API_VERSION}`);
  }

  c.set('apiVersion' as never, resolved as never);
  c.header('X-API-Version', resolved);

  await next();
});

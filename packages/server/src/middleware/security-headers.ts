/**
 * SH-5: CSP & Security Headers middleware.
 *
 * Applies security headers to ALL responses. Must be registered as the
 * first middleware in the stack.
 *
 * CSP policy is overridable via the `CSP_POLICY` environment variable.
 * When set, the raw string replaces the built-in CSP object.
 */

import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

const DEFAULT_CSP_STRING =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'";

export function securityHeadersMiddleware(): MiddlewareHandler {
  const cspOverride = process.env['CSP_POLICY'];

  if (cspOverride) {
    // When CSP_POLICY env var is set, use raw middleware to set the string directly
    // because hono/secure-headers only accepts CSP as an object.
    const base = secureHeaders({
      contentSecurityPolicy: false as unknown as undefined,
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
      },
    });

    return async (c, next) => {
      await base(c, next);
      c.res.headers.set('Content-Security-Policy', cspOverride);
    };
  }

  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
  });
}

/**
 * Standardized auth error response builders (Story 6 / PRD §R5).
 *
 * All 401/403 responses share a consistent JSON structure with
 * actionable `hint` fields. No stack traces or internals leaked.
 */

import type { Context } from 'hono';

// ── 401 Responses ──────────────────────────────────────────

export function missingCredentials(c: Context) {
  return c.json({
    error: 'Authentication required',
    hint: "Provide an API key via 'Authorization: Bearer als_...' header, or log in via /auth/login",
    docs: '/docs/authentication',
    status: 401,
  }, 401);
}

export function invalidApiKey(c: Context) {
  return c.json({
    error: 'Invalid or revoked API key',
    hint: 'This API key is no longer valid. Generate a new key at /api/keys.',
    status: 401,
  }, 401);
}

export function expiredApiKey(c: Context) {
  return c.json({
    error: 'API key expired',
    hint: 'This API key has been rotated and is no longer valid. Please use the new key.',
    status: 401,
  }, 401);
}

export function expiredJwt(c: Context) {
  return c.json({
    error: 'Token expired',
    hint: 'Your session has expired. Refresh via POST /auth/refresh or log in again.',
    status: 401,
  }, 401);
}

export function invalidJwt(c: Context) {
  return c.json({
    error: 'Invalid token',
    hint: 'The provided token is invalid. Log in again via /auth/login.',
    docs: '/docs/authentication',
    status: 401,
  }, 401);
}

export function invalidCloudKey(c: Context) {
  return c.json({
    error: 'Invalid or revoked API key',
    hint: 'This cloud API key is no longer valid. Generate a new key in the dashboard.',
    status: 401,
  }, 401);
}

export function authRequired(c: Context) {
  return c.json({
    error: 'Authentication required',
    hint: 'No auth context found. This is likely a middleware ordering issue.',
    status: 401,
  }, 401);
}

export function otlpAuthRequired(c: Context) {
  return c.json({
    error: 'Authentication required',
    hint: "OTLP authentication is enabled. Provide a token via 'Authorization: Bearer <token>' header.",
    docs: '/docs/otlp-auth',
    status: 401,
  }, 401);
}

export function otlpInvalidToken(c: Context) {
  return c.json({
    error: 'Invalid OTLP token',
    hint: 'The provided OTLP auth token does not match. Check your OTLP_AUTH_TOKEN configuration.',
    status: 401,
  }, 401);
}

// ── 403 Responses ──────────────────────────────────────────

export function insufficientPermissions(c: Context, opts: {
  required: string;
  current: string;
  hint?: string;
}) {
  return c.json({
    error: 'Insufficient permissions',
    hint: opts.hint ?? `This action requires '${opts.required}' role or higher. Your current role is '${opts.current}'.`,
    required: opts.required,
    current: opts.current,
    status: 403,
  }, 403);
}

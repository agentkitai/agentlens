/**
 * Rate-limiting middleware for auth and API endpoints.
 * Uses hono-rate-limiter with in-memory store.
 *
 * @module middleware/rate-limit
 */

import { rateLimiter } from 'hono-rate-limiter';
import type { Context } from 'hono';
import { createLogger } from '../lib/logger.js';

const log = createLogger('RateLimit');

// ─── Helpers ─────────────────────────────────────────────

/**
 * Extract client IP using x-forwarded-for → cf-connecting-ip → 'unknown'.
 */
function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('cf-connecting-ip') ||
    'unknown'
  );
}

// ─── Auth rate limiter ───────────────────────────────────

const AUTH_MAX = Number(process.env['RATE_LIMIT_AUTH_MAX'] ?? 20);
const AUTH_WINDOW_MS = Number(process.env['RATE_LIMIT_AUTH_WINDOW_MS'] ?? 15 * 60 * 1000);

export const authRateLimit = rateLimiter({
  windowMs: AUTH_WINDOW_MS,
  limit: AUTH_MAX,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => `auth:${getClientIp(c)}`,
  handler: (c) => {
    const ip = getClientIp(c);
    const route = new URL(c.req.url).pathname;
    log.warn('Auth rate limit exceeded', { ip, route });
    return c.json({ error: 'Too Many Requests' }, 429);
  },
});

// ─── API rate limiter ────────────────────────────────────

const API_MAX = Number(process.env['RATE_LIMIT_API_MAX'] ?? 200);
const API_WINDOW_MS = Number(process.env['RATE_LIMIT_API_WINDOW_MS'] ?? 60 * 1000);

export const apiRateLimit = rateLimiter({
  windowMs: API_WINDOW_MS,
  limit: API_MAX,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => {
    // Prefer API key from Authorization header, fall back to IP
    const authHeader = c.req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return `api:${authHeader.slice(7)}`;
    }
    return `api:${getClientIp(c)}`;
  },
  handler: (c) => {
    const ip = getClientIp(c);
    const route = new URL(c.req.url).pathname;
    log.warn('API rate limit exceeded', { ip, route });
    return c.json({ error: 'Too Many Requests' }, 429);
  },
});

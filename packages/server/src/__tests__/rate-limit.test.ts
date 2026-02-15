/**
 * Integration tests for SH-1: Rate Limiting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';

describe('Rate Limiting (SH-1)', () => {
  let app: Hono;
  let apiKey: string;

  // Use very low limits for testing
  beforeEach(async () => {
    process.env['RATE_LIMIT_AUTH_MAX'] = '3';
    process.env['RATE_LIMIT_AUTH_WINDOW_MS'] = '60000';
    process.env['RATE_LIMIT_API_MAX'] = '5';
    process.env['RATE_LIMIT_API_WINDOW_MS'] = '60000';

    // Need to re-import to pick up env changes
    // hono-rate-limiter reads config at creation time, so we need fresh modules
    vi.resetModules();

    const helpers = await import('./test-helpers.js');
    const ctx = await helpers.createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
  });

  afterEach(() => {
    delete process.env['RATE_LIMIT_AUTH_MAX'];
    delete process.env['RATE_LIMIT_AUTH_WINDOW_MS'];
    delete process.env['RATE_LIMIT_API_MAX'];
    delete process.env['RATE_LIMIT_API_WINDOW_MS'];
    vi.restoreAllMocks();
  });

  describe('Auth endpoints', () => {
    it('returns 429 after exceeding auth rate limit', async () => {
      const limit = 3;

      // Send N requests (should all succeed or return auth errors, not 429)
      for (let i = 0; i < limit; i++) {
        const res = await app.request('/auth/login', { method: 'GET' });
        expect(res.status).not.toBe(429);
      }

      // N+1 should be 429
      const res = await app.request('/auth/login', { method: 'GET' });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Too Many Requests');
    });
  });

  describe('API endpoints', () => {
    it('returns 429 after exceeding API rate limit', async () => {
      const limit = 5;

      // Send N requests
      for (let i = 0; i < limit; i++) {
        const res = await app.request('/api/health', { method: 'GET' });
        expect(res.status).not.toBe(429);
      }

      // N+1 should be 429
      const res = await app.request('/api/health', { method: 'GET' });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Too Many Requests');
    });
  });
});

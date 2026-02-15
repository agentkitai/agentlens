/**
 * SH-4: CORS Hardening integration tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCorsOptions } from '../middleware/cors-config.js';
import { createApp } from '../index.js';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

// ─── Unit tests for buildCorsOptions ─────────────────────

describe('buildCorsOptions', () => {
  it('allows listed origin', () => {
    const opts = buildCorsOptions({
      corsOrigins: 'https://dashboard.example.com,https://admin.example.com',
      nodeEnv: 'production',
    });
    const origin = opts.origin as (o: string) => string;
    expect(origin('https://dashboard.example.com')).toBe('https://dashboard.example.com');
    expect(origin('https://admin.example.com')).toBe('https://admin.example.com');
  });

  it('rejects unlisted origin', () => {
    const opts = buildCorsOptions({
      corsOrigins: 'https://dashboard.example.com',
      nodeEnv: 'production',
    });
    const origin = opts.origin as (o: string) => string;
    expect(origin('https://evil.com')).toBe('');
  });

  it('throws on wildcard in production', () => {
    expect(() =>
      buildCorsOptions({ corsOrigins: '*', nodeEnv: 'production' }),
    ).toThrow('wildcard');
  });

  it('allows wildcard in dev', () => {
    const opts = buildCorsOptions({ corsOrigins: '*', nodeEnv: 'development' });
    const origin = opts.origin as (o: string) => string;
    expect(origin('https://anything.com')).toBe('https://anything.com');
  });

  it('auto-allows localhost in dev mode', () => {
    const opts = buildCorsOptions({
      corsOrigins: 'https://prod.example.com',
      nodeEnv: 'development',
    });
    const origin = opts.origin as (o: string) => string;
    expect(origin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(origin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(origin('http://localhost')).toBe('http://localhost');
  });

  it('does NOT auto-allow localhost in production', () => {
    const opts = buildCorsOptions({
      corsOrigins: 'https://prod.example.com',
      nodeEnv: 'production',
    });
    const origin = opts.origin as (o: string) => string;
    expect(origin('http://localhost:3000')).toBe('');
  });

  it('sets credentials, allowHeaders, exposeHeaders, maxAge', () => {
    const opts = buildCorsOptions({ corsOrigins: 'https://x.com', nodeEnv: 'production' });
    expect(opts.credentials).toBe(true);
    expect(opts.allowHeaders).toEqual(['Authorization', 'Content-Type', 'X-Request-ID']);
    expect(opts.exposeHeaders).toEqual(['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']);
    expect(opts.maxAge).toBe(86400);
  });
});

// ─── Integration tests with actual Hono app ─────────────

describe('CORS integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);
    // Set env for test
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    app = await createApp(store, {
      authDisabled: true,
      db,
      corsOrigins: 'https://dashboard.example.com,https://admin.example.com',
    });
    process.env['NODE_ENV'] = origEnv;
  });

  it('listed origin gets CORS headers', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://dashboard.example.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://dashboard.example.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('unlisted origin gets no CORS headers', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.status).toBe(200);
    // hono/cors omits Access-Control-Allow-Origin when origin callback returns empty string
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(!acao || acao === '').toBeTruthy();
  });

  it('preflight returns correct exposed headers and max-age', async () => {
    const res = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-RateLimit-Limit');
  });
});

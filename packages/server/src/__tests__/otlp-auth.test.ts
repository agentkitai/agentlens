/**
 * Tests for OTLP route authentication, rate limiting, and size limits
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { otlpRoutes, resetRateLimiter } from '../routes/otlp.js';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

function makeApp(config?: { otlpAuthToken?: string; otlpRateLimit?: number }) {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);
  const app = new Hono();
  app.route('/v1', otlpRoutes(store, config));
  return { app, store };
}

const validTracesPayload = JSON.stringify({
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
    scopeSpans: [{
      spans: [{
        name: 'test-span',
        traceId: 'abc123',
        spanId: 'def456',
        startTimeUnixNano: '1000000000000000',
        endTimeUnixNano: '2000000000000000',
        attributes: [],
      }],
    }],
  }],
});

describe('OTLP Auth Middleware', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('allows requests when no auth token configured', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: validTracesPayload,
    });
    expect(res.status).toBe(200);
  });

  it('rejects requests without token when auth is configured', async () => {
    const { app } = makeApp({ otlpAuthToken: 'secret-token' });
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: validTracesPayload,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with wrong token', async () => {
    const { app } = makeApp({ otlpAuthToken: 'secret-token' });
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer wrong-token',
      },
      body: validTracesPayload,
    });
    expect(res.status).toBe(401);
  });

  it('allows requests with correct token', async () => {
    const { app } = makeApp({ otlpAuthToken: 'secret-token' });
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer secret-token',
      },
      body: validTracesPayload,
    });
    expect(res.status).toBe(200);
  });
});

describe('OTLP Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('allows requests within rate limit', async () => {
    const { app } = makeApp({ otlpRateLimit: 5 });
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/v1/traces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: validTracesPayload,
      });
      expect(res.status).toBe(200);
    }
  });

  it('rejects requests exceeding rate limit', async () => {
    const { app } = makeApp({ otlpRateLimit: 2 });
    // First 2 should pass
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/v1/traces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: validTracesPayload,
      });
      expect(res.status).toBe(200);
    }
    // Third should be rate limited
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: validTracesPayload,
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('Rate limit exceeded');
  });
});

describe('OTLP Size Limit', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('rejects requests exceeding 10MB', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(11 * 1024 * 1024),
      },
      body: '{}',
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('Payload too large');
  });

  it('allows requests under 10MB', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(validTracesPayload.length),
      },
      body: validTracesPayload,
    });
    expect(res.status).toBe(200);
  });
});

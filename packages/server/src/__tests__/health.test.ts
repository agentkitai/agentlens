/**
 * Tests for Story 4.1: Bootstrap Hono Server with Middleware
 */

import { describe, it, expect } from 'vitest';
import { createTestApp } from './test-helpers.js';

describe('Health & Server Bootstrap (Story 4.1)', () => {
  it('GET /api/health returns { status: "ok", version: "0.1.0" }', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('GET /api/health does not require auth', async () => {
    const { app } = await createTestApp({ authDisabled: false });
    // No auth header
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('unknown routes return 404 JSON', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/nonexistent');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
    expect(body.status).toBe(404);
  });

  it('CORS headers are set on /api/* routes', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://example.com' },
    });

    expect(res.status).toBe(200);
    // CORS header should be present
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});

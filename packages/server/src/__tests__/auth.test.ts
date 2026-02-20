/**
 * Tests for Story 4.2: API Key Auth Middleware
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import { hashApiKey } from '../middleware/auth.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';

describe('API Key Auth Middleware (Story 4.2)', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/events');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Authentication required');
  });

  it('returns 401 for invalid header format', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/events', {
      headers: { Authorization: 'Basic abc123' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Authentication required');
  });

  it('returns 401 for non-als_ prefixed key', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/events', {
      headers: { Authorization: 'Bearer sk_badprefix123' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown API key', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/events', {
      headers: { Authorization: 'Bearer als_unknownkey1234567890abcdef1234567890abcdef1234567890abcdef12' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Invalid or revoked');
  });

  it('returns 401 for revoked API key', async () => {
    const { app, db } = await createTestApp();

    // Revoke the test key
    db.update(apiKeys)
      .set({ revokedAt: Math.floor(Date.now() / 1000) })
      .where(eq(apiKeys.id, 'test-key-id'))
      .run();

    const res = await app.request('/api/events', {
      headers: { Authorization: 'Bearer als_testkey123456789abcdef0123456789abcdef0123456789abcdef012345' },
    });

    expect(res.status).toBe(401);
  });

  it('allows requests with a valid API key', async () => {
    const { app, apiKey } = await createTestApp();
    const res = await app.request('/api/events', {
      headers: authHeaders(apiKey),
    });

    // Should be 200 (empty events list), not 401
    expect(res.status).toBe(200);
  });

  it('skips auth when AUTH_DISABLED=true', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    // No auth header
    const res = await app.request('/api/events');

    expect(res.status).toBe(200);
  });

  it('updates lastUsedAt on successful auth', async () => {
    const { app, db, apiKey } = await createTestApp();
    
    // Check lastUsedAt before
    const before = db.select().from(apiKeys).where(eq(apiKeys.id, 'test-key-id')).get();
    expect(before?.lastUsedAt).toBeNull();

    await app.request('/api/events', {
      headers: authHeaders(apiKey),
    });

    const after = db.select().from(apiKeys).where(eq(apiKeys.id, 'test-key-id')).get();
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it('hashApiKey produces consistent SHA-256 hex', () => {
    const hash1 = hashApiKey('als_test');
    const hash2 = hashApiKey('als_test');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });
});

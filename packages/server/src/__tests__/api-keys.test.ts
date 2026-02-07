/**
 * Tests for Story 4.3: API Key Management Endpoints
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';

describe('API Key Management (Story 4.3)', () => {
  describe('POST /api/keys', () => {
    it('creates a new API key and returns the raw key once', async () => {
      const { app, apiKey } = createTestApp();
      const res = await app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ name: 'My New Key', scopes: ['read', 'write'] }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toMatch(/^als_[a-f0-9]{64}$/);
      expect(body.name).toBe('My New Key');
      expect(body.scopes).toEqual(['read', 'write']);
      expect(body.id).toBeTruthy();
      expect(body.createdAt).toBeTruthy();
    });

    it('creates a key with defaults when no name/scopes provided', async () => {
      const { app, apiKey } = createTestApp();
      const res = await app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('Unnamed Key');
      expect(body.scopes).toEqual(['*']);
    });
  });

  describe('GET /api/keys', () => {
    it('lists all keys without raw key in response', async () => {
      const { app, apiKey } = createTestApp();

      // Create an additional key
      await app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ name: 'Extra Key' }),
      });

      const res = await app.request('/api/keys', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toBeInstanceOf(Array);
      // At least the pre-seeded key + the one we just created
      expect(body.keys.length).toBeGreaterThanOrEqual(2);

      // No raw key in response
      for (const key of body.keys) {
        expect(key).not.toHaveProperty('key');
        expect(key).not.toHaveProperty('keyHash');
        expect(key.id).toBeTruthy();
        expect(key.name).toBeTruthy();
      }
    });
  });

  describe('DELETE /api/keys/:id', () => {
    it('revokes (soft deletes) an API key', async () => {
      const { app, apiKey } = createTestApp();

      // Create a key to revoke
      const createRes = await app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ name: 'To Revoke' }),
      });
      const { id: newKeyId } = await createRes.json();

      // Revoke it
      const delRes = await app.request(`/api/keys/${newKeyId}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey),
      });

      expect(delRes.status).toBe(200);
      const body = await delRes.json();
      expect(body.revoked).toBe(true);

      // Verify it shows as revoked in the list
      const listRes = await app.request('/api/keys', {
        headers: authHeaders(apiKey),
      });
      const listBody = await listRes.json();
      const revokedKey = listBody.keys.find((k: { id: string }) => k.id === newKeyId);
      expect(revokedKey?.revokedAt).toBeTruthy();
    });

    it('returns 404 for non-existent key', async () => {
      const { app, apiKey } = createTestApp();
      const res = await app.request('/api/keys/nonexistent-id', {
        method: 'DELETE',
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(404);
    });

    it('returns 409 for already revoked key', async () => {
      const { app, apiKey } = createTestApp();

      // Create and revoke
      const createRes = await app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ name: 'Double Revoke' }),
      });
      const { id: keyId } = await createRes.json();

      await app.request(`/api/keys/${keyId}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey),
      });

      // Try to revoke again
      const res = await app.request(`/api/keys/${keyId}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(409);
    });
  });
});

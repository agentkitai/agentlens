/**
 * #99 — RFC 3161 trusted timestamping: request DER shape + route round-trip
 * against a canned TSA response (no network).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { auditRoutes } from '../audit.js';
import { buildTimeStampRequest, parseGenTime, verifyTimestampToken } from '../../lib/rfc3161.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { apiKeys } from '../../db/schema.sqlite.js';

const HASH = 'ab'.repeat(32); // 64 hex

// Canned TimeStampResp: PKIStatusInfo{granted} + a SHA-256 messageImprint (binding
// to HASH) + a GeneralizedTime.
const GEN = Buffer.from('20260701000000Z', 'ascii');
const SHA256_ALGID = [0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00];
const CANNED = Uint8Array.from([
  0x30, 0x47, 0x30, 0x03, 0x02, 0x01, 0x00, ...SHA256_ALGID, 0x04, 0x20, ...Buffer.from(HASH, 'hex'), 0x18, 0x0f, ...GEN,
]);

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys)
    .values({ id: 'key-1', keyHash: hashApiKey(rawKey), name: 'k', scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000), tenantId: 'default', role: 'owner' })
    .run();
  return rawKey;
}

describe('#99 RFC 3161 timestamping', () => {
  describe('buildTimeStampRequest', () => {
    it('encodes a valid DER TimeStampReq for a SHA-256 imprint', () => {
      const req = buildTimeStampRequest(HASH);
      expect(req.length).toBe(59);
      expect([req[0], req[1]]).toEqual([0x30, 0x39]); // SEQUENCE, 57 bytes
      expect([req[2], req[3], req[4]]).toEqual([0x02, 0x01, 0x01]); // version 1
      expect(Array.from(req.subarray(11, 20))).toEqual([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]); // sha256 OID
      expect(Buffer.from(req.subarray(24, 56)).toString('hex')).toBe(HASH); // the imprint
      expect(Array.from(req.subarray(56))).toEqual([0x01, 0x01, 0xff]); // certReq TRUE
    });
    it('rejects a non-SHA-256 hash', () => {
      expect(() => buildTimeStampRequest('abc')).toThrow();
    });
    it('parses the TSA GeneralizedTime', () => {
      expect(parseGenTime(CANNED)).toBe('2026-07-01T00:00:00Z');
    });

    it('verifies a token binds to its subject hash (and rejects a mismatch)', () => {
      const tokenB64 = Buffer.from(CANNED).toString('base64');
      const ok = verifyTimestampToken(tokenB64, HASH);
      expect(ok).toMatchObject({ granted: true, matchesHash: true, genTime: '2026-07-01T00:00:00Z', valid: true });

      const bad = verifyTimestampToken(tokenB64, 'cd'.repeat(32));
      expect(bad.matchesHash).toBe(false);
      expect(bad.valid).toBe(false);
    });
  });

  describe('POST/GET /api/audit/timestamp', () => {
    let db: any;
    let app: any;
    let apiKey: string;
    const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

    beforeEach(() => {
      db = createTestDb();
      runMigrations(db);
      app = new Hono<{ Variables: AuthVariables }>();
      app.use('/*', authMiddleware(db, false));
      app.route('/api/audit', auditRoutes(db));
      apiKey = seedApiKey(db);
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(CANNED.buffer) })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('anchors a digest and stores + returns the token', async () => {
      const res = await app.request('/api/audit/timestamp', { method: 'POST', headers: auth(), body: JSON.stringify({ hash: HASH, tsaUrl: 'https://tsa.example/tsr' }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.granted).toBe(true);
      expect(body.genTime).toBe('2026-07-01T00:00:00Z');

      const got = await app.request(`/api/audit/timestamp/${body.id}`, { headers: auth() });
      expect(got.status).toBe(200);
      const stored = await got.json();
      expect(stored.subjectHash).toBe(HASH);
      expect(stored.granted).toBe(true);
      expect(Buffer.from(stored.token, 'base64')).toEqual(Buffer.from(CANNED));

      // Offline-verify the stored token binds to its hash.
      const ver = await (await app.request(`/api/audit/timestamp/${body.id}/verify`, { headers: auth() })).json();
      expect(ver).toMatchObject({ valid: true, matchesHash: true, granted: true, signatureVerified: false });
    });

    it('rejects a bad hash', async () => {
      const res = await app.request('/api/audit/timestamp', { method: 'POST', headers: auth(), body: JSON.stringify({ hash: 'nope' }) });
      expect(res.status).toBe(400);
    });
  });
});

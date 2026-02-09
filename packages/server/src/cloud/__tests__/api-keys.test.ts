/**
 * API Key Tests (S-2.3: CRUD, S-2.4: Auth Middleware)
 *
 * Unit tests run without Postgres.
 * Integration tests run when DATABASE_URL is set.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ApiKeyService,
  ApiKeyError,
  generateApiKey,
} from '../auth/api-keys.js';
import {
  ApiKeyAuthMiddleware,
  ApiKeyAuthError,
  InMemoryApiKeyCache,
} from '../auth/api-key-middleware.js';
import { runMigrations, type MigrationClient } from '../migrate.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');

// ═══════════════════════════════════════════
// S-2.3: Key Generation (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.3: API key generation', () => {
  it('generates live key for production/staging', () => {
    const { fullKey, prefix } = generateApiKey('production');
    expect(fullKey).toMatch(/^al_live_[A-Za-z0-9_-]{32}$/);
    expect(prefix).toBe(fullKey.slice(0, 16));
    expect(prefix.startsWith('al_live_')).toBe(true);
  });

  it('generates live key for staging', () => {
    const { fullKey } = generateApiKey('staging');
    expect(fullKey).toMatch(/^al_live_/);
  });

  it('generates test key for test/development environments', () => {
    const { fullKey: testKey } = generateApiKey('test');
    expect(testKey).toMatch(/^al_test_/);
    const { fullKey: devKey } = generateApiKey('development');
    expect(devKey).toMatch(/^al_test_/);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey('production').fullKey));
    expect(keys.size).toBe(20);
  });

  it('prefix is 16 chars', () => {
    const { prefix } = generateApiKey('production');
    expect(prefix.length).toBe(16);
  });
});

// ═══════════════════════════════════════════
// S-2.4: In-Memory Cache (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.4: InMemoryApiKeyCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new InMemoryApiKeyCache(60_000);
    const entry = {
      orgId: 'org-1', keyId: 'key-1', keyHash: 'hash',
      scopes: ['ingest'], rateLimitOverride: null,
      environment: 'production', revoked: false, cachedAt: Date.now(),
    };
    cache.set('al_live_abcdef', entry);
    expect(cache.get('al_live_abcdef')).toEqual(entry);
  });

  it('returns undefined for missing key', () => {
    const cache = new InMemoryApiKeyCache(60_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    const cache = new InMemoryApiKeyCache(10); // 10ms TTL
    cache.set('key', {
      orgId: 'org', keyId: 'k', keyHash: 'h',
      scopes: [], rateLimitOverride: null,
      environment: 'production', revoked: false, cachedAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('key')).toBeUndefined();
  });

  it('deletes entries', () => {
    const cache = new InMemoryApiKeyCache(60_000);
    cache.set('key', {
      orgId: 'org', keyId: 'k', keyHash: 'h',
      scopes: [], rateLimitOverride: null,
      environment: 'production', revoked: false, cachedAt: Date.now(),
    });
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// S-2.4: Auth Middleware - header parsing (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.4: ApiKeyAuthMiddleware (unit)', () => {
  // We need a mock ApiKeyService for unit tests
  const mockDb: MigrationClient = {
    query: async () => ({ rows: [] }),
  };
  const keyService = new ApiKeyService(mockDb);

  it('rejects missing Authorization header', async () => {
    const mw = new ApiKeyAuthMiddleware(keyService);
    await expect(mw.authenticate(undefined)).rejects.toThrow(ApiKeyAuthError);
    await expect(mw.authenticate(undefined)).rejects.toThrow('Missing');
  });

  it('rejects non-Bearer auth', async () => {
    const mw = new ApiKeyAuthMiddleware(keyService);
    await expect(mw.authenticate('Basic abc')).rejects.toThrow('Missing');
  });

  it('rejects invalid key format', async () => {
    const mw = new ApiKeyAuthMiddleware(keyService);
    await expect(mw.authenticate('Bearer invalid_key_format')).rejects.toThrow('Invalid API key format');
  });

  it('rejects key not found in DB (cache miss)', async () => {
    const mw = new ApiKeyAuthMiddleware(keyService);
    // al_live_ + 32 random chars
    const fakeKey = 'al_live_' + 'a'.repeat(32);
    await expect(mw.authenticate(`Bearer ${fakeKey}`)).rejects.toThrow('Invalid API key');
  });
});

// ═══════════════════════════════════════════
// Integration Tests (require DATABASE_URL)
// ═══════════════════════════════════════════

let pg: typeof import('pg') | null = null;
let pool: InstanceType<typeof import('pg').Pool> | null = null;
let pgAvailable = false;

async function tryConnectPg() {
  try {
    pg = await import('pg');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return false;
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
    const res = await pool.query('SELECT 1 as ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

async function resetDatabase() {
  if (!pool) return;
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

describe('Integration: ApiKeyService (S-2.3)', () => {
  let keyService: ApiKeyService;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    pgAvailable = await tryConnectPg();
    if (pgAvailable && pool) {
      await resetDatabase();
      await runMigrations(pool, MIGRATIONS_DIR);
      keyService = new ApiKeyService(pool);

      // Create test org and user
      const orgRes = await pool.query(
        `INSERT INTO orgs (name, slug, plan) VALUES ('Test Org', 'test-org', 'pro') RETURNING id`,
      );
      orgId = (orgRes.rows as any[])[0].id;

      const userRes = await pool.query(
        `INSERT INTO users (email, email_verified, display_name) VALUES ('admin@test.com', true, 'Admin') RETURNING id`,
      );
      userId = (userRes.rows as any[])[0].id;

      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [orgId, userId],
      );
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it.skipIf(!pgAvailable)('creates an API key and returns full key once', async () => {
    const result = await keyService.create({
      orgId, name: 'Production Key', environment: 'production', createdBy: userId,
    });
    expect(result.fullKey).toMatch(/^al_live_/);
    expect(result.record.name).toBe('Production Key');
    expect(result.record.environment).toBe('production');
    expect(result.record.key_prefix).toBe(result.fullKey.slice(0, 16));
    expect(result.record.revoked_at).toBeNull();
    // key_hash is NOT in the record (not selected)
    expect((result.record as any).key_hash).toBeUndefined();
  });

  it.skipIf(!pgAvailable)('creates test key for test environment', async () => {
    const result = await keyService.create({
      orgId, name: 'Test Key', environment: 'test', createdBy: userId,
    });
    expect(result.fullKey).toMatch(/^al_test_/);
  });

  it.skipIf(!pgAvailable)('lists keys with prefix and metadata only', async () => {
    const keys = await keyService.list(orgId);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) {
      expect(key.key_prefix).toBeDefined();
      expect(key.name).toBeDefined();
      expect((key as any).key_hash).toBeUndefined();
    }
  });

  it.skipIf(!pgAvailable)('lists only active keys', async () => {
    const active = await keyService.listActive(orgId);
    for (const key of active) {
      expect(key.revoked_at).toBeNull();
    }
  });

  it.skipIf(!pgAvailable)('revokes an API key', async () => {
    const created = await keyService.create({
      orgId, name: 'To Revoke', environment: 'production', createdBy: userId,
    });
    const revoked = await keyService.revoke(orgId, created.record.id);
    expect(revoked).toBe(true);

    // Should not appear in active list
    const active = await keyService.listActive(orgId);
    expect(active.find((k) => k.id === created.record.id)).toBeUndefined();
  });

  it.skipIf(!pgAvailable)('revoke returns false for non-existent key', async () => {
    const result = await keyService.revoke(orgId, '00000000-0000-0000-0000-000000000000');
    expect(result).toBe(false);
  });

  it.skipIf(!pgAvailable)('finds key by prefix and verifies', async () => {
    const created = await keyService.create({
      orgId, name: 'Lookup Key', environment: 'production', createdBy: userId,
    });
    const prefix = created.fullKey.slice(0, 16);
    const found = await keyService.findByPrefix(prefix);
    expect(found).not.toBeNull();
    expect(found!.org_id).toBe(orgId);

    // Verify hash
    const valid = await keyService.verifyKey(created.fullKey, found!.key_hash);
    expect(valid).toBe(true);

    // Wrong key fails
    const invalid = await keyService.verifyKey('al_live_wrong' + 'x'.repeat(19), found!.key_hash);
    expect(invalid).toBe(false);
  });

  it.skipIf(!pgAvailable)('tracks last_used_at', async () => {
    const created = await keyService.create({
      orgId, name: 'Usage Key', environment: 'production', createdBy: userId,
    });
    expect(created.record.last_used_at).toBeNull();

    // Update last used
    keyService.updateLastUsed(created.record.id);
    // Wait a bit for async update
    await new Promise((r) => setTimeout(r, 100));

    const found = await keyService.findByPrefix(created.record.key_prefix);
    expect(found!.last_used_at).not.toBeNull();
  });

  it.skipIf(!pgAvailable)('enforces tier key limits', async () => {
    // Create a free-tier org
    const freeOrgRes = await pool!.query(
      `INSERT INTO orgs (name, slug, plan) VALUES ('Free Org', 'free-org-${Date.now()}', 'free') RETURNING id`,
    );
    const freeOrgId = (freeOrgRes.rows as any[])[0].id;

    // Create 2 keys (free limit)
    await keyService.create({ orgId: freeOrgId, name: 'K1', environment: 'production', createdBy: userId });
    await keyService.create({ orgId: freeOrgId, name: 'K2', environment: 'production', createdBy: userId });

    // 3rd should fail
    await expect(
      keyService.create({ orgId: freeOrgId, name: 'K3', environment: 'production', createdBy: userId }),
    ).rejects.toThrow(ApiKeyError);
  });

  it.skipIf(!pgAvailable)('counts active keys correctly', async () => {
    const countOrgRes = await pool!.query(
      `INSERT INTO orgs (name, slug, plan) VALUES ('Count Org', 'count-org-${Date.now()}', 'pro') RETURNING id`,
    );
    const countOrgId = (countOrgRes.rows as any[])[0].id;

    expect(await keyService.countActive(countOrgId)).toBe(0);
    const k1 = await keyService.create({ orgId: countOrgId, name: 'A', environment: 'production', createdBy: userId });
    expect(await keyService.countActive(countOrgId)).toBe(1);
    await keyService.revoke(countOrgId, k1.record.id);
    expect(await keyService.countActive(countOrgId)).toBe(0);
  });
});

// ═══════════════════════════════════════════
// Integration: Auth Middleware (S-2.4)
// ═══════════════════════════════════════════

describe('Integration: ApiKeyAuthMiddleware (S-2.4)', () => {
  let keyService: ApiKeyService;
  let middleware: ApiKeyAuthMiddleware;
  let orgId: string;
  let userId: string;
  let pool2: InstanceType<typeof import('pg').Pool> | null = null;
  let pg2Available = false;

  beforeAll(async () => {
    try {
      const pgMod = await import('pg');
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) return;
      pool2 = new pgMod.Pool({ connectionString: dbUrl, max: 5 });
      const res = await pool2.query('SELECT 1 as ok');
      pg2Available = res.rows[0]?.ok === 1;
    } catch {
      return;
    }

    if (pg2Available && pool2) {
      await pool2.query(`
        DO $$ DECLARE r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `);
      await runMigrations(pool2, MIGRATIONS_DIR);
      keyService = new ApiKeyService(pool2);
      middleware = new ApiKeyAuthMiddleware(keyService);

      const orgRes = await pool2.query(
        `INSERT INTO orgs (name, slug, plan) VALUES ('MW Org', 'mw-org', 'pro') RETURNING id`,
      );
      orgId = (orgRes.rows as any[])[0].id;

      const userRes = await pool2.query(
        `INSERT INTO users (email, email_verified) VALUES ('mw@test.com', true) RETURNING id`,
      );
      userId = (userRes.rows as any[])[0].id;
    }
  });

  afterAll(async () => {
    if (pool2) await pool2.end();
  });

  it.skipIf(!pg2Available)('authenticates valid API key', async () => {
    const created = await keyService.create({
      orgId, name: 'Auth Key', environment: 'production', createdBy: userId,
    });

    const ctx = await middleware.authenticate(`Bearer ${created.fullKey}`);
    expect(ctx.orgId).toBe(orgId);
    expect(ctx.keyId).toBe(created.record.id);
    expect(ctx.scopes).toContain('ingest');
  });

  it.skipIf(!pg2Available)('uses cache on second call', async () => {
    const created = await keyService.create({
      orgId, name: 'Cache Key', environment: 'production', createdBy: userId,
    });

    // First call populates cache
    await middleware.authenticate(`Bearer ${created.fullKey}`);
    // Second call should use cache (still works)
    const ctx = await middleware.authenticate(`Bearer ${created.fullKey}`);
    expect(ctx.orgId).toBe(orgId);
  });

  it.skipIf(!pg2Available)('rejects revoked key', async () => {
    const created = await keyService.create({
      orgId, name: 'Revoke MW Key', environment: 'production', createdBy: userId,
    });

    // Verify it works first
    await middleware.authenticate(`Bearer ${created.fullKey}`);

    // Revoke + invalidate cache
    await keyService.revoke(orgId, created.record.id);
    middleware.invalidateCache(created.record.key_prefix);

    // Should fail
    await expect(middleware.authenticate(`Bearer ${created.fullKey}`)).rejects.toThrow('revoked');
  });

  it.skipIf(!pg2Available)('returns 401 for unknown key', async () => {
    const fakeKey = 'al_live_' + 'z'.repeat(32);
    await expect(middleware.authenticate(`Bearer ${fakeKey}`)).rejects.toThrow(ApiKeyAuthError);
  });

  it.skipIf(!pg2Available)('never logs full key in error messages', async () => {
    const fakeKey = 'al_live_' + 'x'.repeat(32);
    try {
      await middleware.authenticate(`Bearer ${fakeKey}`);
    } catch (err: any) {
      // Error message should contain prefix only, not full key
      expect(err.message).not.toContain(fakeKey);
      expect(err.message).toContain('al_live_xxxxxxxx'); // prefix only
    }
  });

  it.skipIf(!pg2Available)('updates last_used_at non-blocking', async () => {
    const created = await keyService.create({
      orgId, name: 'LastUsed Key', environment: 'production', createdBy: userId,
    });

    await middleware.authenticate(`Bearer ${created.fullKey}`);
    await new Promise((r) => setTimeout(r, 150));

    const found = await keyService.findByPrefix(created.record.key_prefix);
    expect(found!.last_used_at).not.toBeNull();
  });
});

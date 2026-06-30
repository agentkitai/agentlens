/**
 * Tests for ServiceTokenStore (#59) — per-tenant service tokens + rotation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { ServiceTokenStore } from '../service-token-store.js';

describe('ServiceTokenStore (#59)', () => {
  let db: SqliteDb;
  let store: ServiceTokenStore;
  const NOW = 1_780_000_000; // fixed epoch seconds

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new ServiceTokenStore(db);
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  it('finds an active token by hash', async () => {
    await store.create({ id: 't1', tokenHash: 'h1', tenantId: 'A', name: 'gate', createdAt: NOW });
    expect((await store.findActiveByHash('h1', NOW))?.tenantId).toBe('A');
    expect(await store.findActiveByHash('nope', NOW)).toBeNull();
  });

  it('treats revoked and expired tokens as inactive', async () => {
    await store.create({ id: 't2', tokenHash: 'h2', tenantId: 'A', name: 'x', createdAt: NOW });
    await store.revoke('A', 't2', NOW + 10);
    expect(await store.findActiveByHash('h2', NOW + 20)).toBeNull();

    await store.create({ id: 't3', tokenHash: 'h3', tenantId: 'A', name: 'x', createdAt: NOW, expiresAt: NOW + 100 });
    expect(await store.findActiveByHash('h3', NOW + 50)).not.toBeNull();
    expect(await store.findActiveByHash('h3', NOW + 200)).toBeNull();
  });

  it('revoke and markRotated are tenant-scoped', async () => {
    await store.create({ id: 't4', tokenHash: 'h4', tenantId: 'A', name: 'x', createdAt: NOW });
    expect(await store.revoke('B', 't4', NOW)).toBe(false);
    expect(await store.markRotated('B', 't4', NOW, NOW + 1)).toBe(false);
    expect(await store.revoke('A', 't4', NOW)).toBe(true);
  });

  it('rotation overlap: old token stays valid until grace closes, then cleanup prunes it', async () => {
    await store.create({ id: 'old', tokenHash: 'hold', tenantId: 'A', name: 'x', createdAt: NOW });
    await store.create({ id: 'new', tokenHash: 'hnew', tenantId: 'A', name: 'x', createdAt: NOW });
    await store.markRotated('A', 'old', NOW, NOW + 100); // 100s grace

    expect(await store.findActiveByHash('hold', NOW + 50)).not.toBeNull();
    expect(await store.findActiveByHash('hnew', NOW + 50)).not.toBeNull();
    expect(await store.findActiveByHash('hold', NOW + 150)).toBeNull();

    await store.cleanupExpired(NOW + 150);
    expect((await store.listByTenant('A')).map((t) => t.id)).toEqual(['new']);
  });

  it('listByTenant isolates tenants and touchLastUsed updates', async () => {
    await store.create({ id: 'a1', tokenHash: 'ha', tenantId: 'A', name: 'x', createdAt: NOW });
    await store.create({ id: 'b1', tokenHash: 'hb', tenantId: 'B', name: 'x', createdAt: NOW });
    expect((await store.listByTenant('A')).map((t) => t.id)).toEqual(['a1']);
    await store.touchLastUsed('a1', NOW + 5);
    expect((await store.get('A', 'a1'))?.lastUsedAt).toBe(NOW + 5);
  });
});

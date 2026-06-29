/**
 * LLM connection store (#143): encryption-at-rest, masked reads, tenant isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { LlmConnectionStore } from '../llm-connection-store.js';

let db: SqliteDb;
let store: LlmConnectionStore;

beforeEach(() => {
  process.env.AGENTLENS_ENCRYPTION_KEY = 'store-test-key';
  db = createTestDb();
  runMigrations(db);
  store = new LlmConnectionStore(db);
});

afterEach(() => {
  delete process.env.AGENTLENS_ENCRYPTION_KEY;
});

describe('LlmConnectionStore', () => {
  it('creates without exposing the key; list/get are masked', () => {
    const conn = store.create('t', { provider: 'openai', name: 'Prod', apiKey: 'sk-secret-9999' });
    expect((conn as Record<string, unknown>).apiKey).toBeUndefined();
    expect((conn as Record<string, unknown>).encryptedKey).toBeUndefined();
    expect(conn.keyLast4).toBe('9999');

    const listed = store.list('t');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('sk-secret');
    expect(store.get('t', conn.id)?.keyLast4).toBe('9999');
  });

  it('persists the key encrypted (no plaintext in the table)', () => {
    store.create('t', { provider: 'openai', name: 'P', apiKey: 'sk-plaintext-1234' });
    const raw = JSON.stringify(db.all(sql`SELECT * FROM llm_connections`));
    expect(raw).not.toContain('sk-plaintext');
    expect(raw).toContain('v1:'); // the encrypted blob is present
  });

  it('getWithKey decrypts for internal use', () => {
    const conn = store.create('t', { provider: 'openai', name: 'P', apiKey: 'sk-zzz-1234' });
    expect(store.getWithKey('t', conn.id)?.apiKey).toBe('sk-zzz-1234');
  });

  it('isolates by tenant and deletes', () => {
    const conn = store.create('t1', { provider: 'openai', name: 'P', apiKey: 'sk-aaa-1234' });
    expect(store.list('t2')).toHaveLength(0);
    expect(store.get('t2', conn.id)).toBeUndefined();
    expect(store.delete('t1', conn.id)).toBe(true);
    expect(store.delete('t1', conn.id)).toBe(false);
    expect(store.list('t1')).toHaveLength(0);
  });
});

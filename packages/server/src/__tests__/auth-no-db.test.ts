/**
 * Tests for createApp() without db when auth is enabled (Issue 4)
 */
import { describe, it, expect } from 'vitest';
import { createApp } from '../index.js';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

describe('createApp() auth without db (Issue 4)', () => {
  it('throws when no db provided and auth is not disabled', () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);

    expect(() => {
      createApp(store, { authDisabled: false });
    }).toThrow('createApp() requires a `db` option when auth is enabled');
  });

  it('throws when no db provided and authDisabled is undefined (defaults to false)', () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);

    expect(() => {
      createApp(store);
    }).toThrow('createApp() requires a `db` option when auth is enabled');
  });

  it('does not throw when db is not provided but auth is disabled', () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);

    expect(() => {
      createApp(store, { authDisabled: true });
    }).not.toThrow();
  });

  it('does not throw when db is provided and auth is enabled', () => {
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);

    expect(() => {
      createApp(store, { authDisabled: false, db });
    }).not.toThrow();
  });
});

/**
 * Config: storageBackend normalization tests (Story 1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../config.js';

describe('storageBackend config', () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv.STORAGE_BACKEND = process.env['STORAGE_BACKEND'];
    origEnv.DB_DIALECT = process.env['DB_DIALECT'];
    delete process.env['STORAGE_BACKEND'];
    delete process.env['DB_DIALECT'];
  });

  afterEach(() => {
    if (origEnv.STORAGE_BACKEND !== undefined) process.env['STORAGE_BACKEND'] = origEnv.STORAGE_BACKEND;
    else delete process.env['STORAGE_BACKEND'];
    if (origEnv.DB_DIALECT !== undefined) process.env['DB_DIALECT'] = origEnv.DB_DIALECT;
    else delete process.env['DB_DIALECT'];
  });

  it('defaults to sqlite when neither env var is set', () => {
    const config = getConfig();
    expect(config.storageBackend).toBe('sqlite');
  });

  it('reads STORAGE_BACKEND=postgres', () => {
    process.env['STORAGE_BACKEND'] = 'postgres';
    const config = getConfig();
    expect(config.storageBackend).toBe('postgres');
  });

  it('reads STORAGE_BACKEND=sqlite', () => {
    process.env['STORAGE_BACKEND'] = 'sqlite';
    const config = getConfig();
    expect(config.storageBackend).toBe('sqlite');
  });

  it('normalizes DB_DIALECT=postgresql to postgres', () => {
    process.env['DB_DIALECT'] = 'postgresql';
    const config = getConfig();
    expect(config.storageBackend).toBe('postgres');
  });

  it('STORAGE_BACKEND takes precedence over DB_DIALECT', () => {
    process.env['STORAGE_BACKEND'] = 'sqlite';
    process.env['DB_DIALECT'] = 'postgresql';
    const config = getConfig();
    expect(config.storageBackend).toBe('sqlite');
  });

  it('throws on invalid value', () => {
    process.env['STORAGE_BACKEND'] = 'mysql';
    expect(() => getConfig()).toThrow(/Invalid STORAGE_BACKEND.*mysql/);
  });
});

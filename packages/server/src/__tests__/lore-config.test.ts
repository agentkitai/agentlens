/**
 * Tests for Batch 1: Lore Feature Flag + Config
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, validateConfig } from '../config.js';
import { createTestApp } from './test-helpers.js';

// ─── Config Parsing ──────────────────────────────────────

describe('Lore config parsing', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const loreEnvVars = ['LORE_ENABLED', 'LORE_MODE', 'LORE_API_URL', 'LORE_API_KEY', 'LORE_DB_PATH'];

  beforeEach(() => {
    for (const key of loreEnvVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of loreEnvVars) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('defaults loreEnabled to false', () => {
    const config = getConfig();
    expect(config.loreEnabled).toBe(false);
  });

  it('defaults loreMode to remote', () => {
    const config = getConfig();
    expect(config.loreMode).toBe('remote');
  });

  it('parses LORE_ENABLED=true', () => {
    process.env['LORE_ENABLED'] = 'true';
    const config = getConfig();
    expect(config.loreEnabled).toBe(true);
  });

  it('parses LORE_MODE=local', () => {
    process.env['LORE_MODE'] = 'local';
    const config = getConfig();
    expect(config.loreMode).toBe('local');
  });

  it('parses all lore env vars', () => {
    process.env['LORE_ENABLED'] = 'true';
    process.env['LORE_MODE'] = 'remote';
    process.env['LORE_API_URL'] = 'https://lore.example.com';
    process.env['LORE_API_KEY'] = 'sk-test-key';
    process.env['LORE_DB_PATH'] = '/tmp/lore.db';
    const config = getConfig();
    expect(config.loreApiUrl).toBe('https://lore.example.com');
    expect(config.loreApiKey).toBe('sk-test-key');
    expect(config.loreDbPath).toBe('/tmp/lore.db');
  });

  it('treats invalid LORE_MODE as remote', () => {
    process.env['LORE_MODE'] = 'banana';
    const config = getConfig();
    expect(config.loreMode).toBe('remote');
  });
});

// ─── Config Validation ───────────────────────────────────

describe('Lore config validation', () => {
  function baseConfig() {
    return {
      port: 3400,
      corsOrigin: 'http://localhost:3400',
      authDisabled: true,
      dbPath: './test.db',
      retentionDays: 90,
      otlpRateLimit: 1000,
      loreEnabled: false,
      loreMode: 'remote' as const,
    };
  }

  it('passes when lore is disabled', () => {
    expect(() => validateConfig(baseConfig())).not.toThrow();
  });

  it('passes when lore is enabled + local mode (no extra config needed)', () => {
    expect(() => validateConfig({ ...baseConfig(), loreEnabled: true, loreMode: 'local' })).not.toThrow();
  });

  it('passes when lore is enabled + remote mode with url and key', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreMode: 'remote',
      loreApiUrl: 'https://lore.example.com',
      loreApiKey: 'sk-key',
    })).not.toThrow();
  });

  it('throws when lore remote enabled but missing LORE_API_URL', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreMode: 'remote',
      loreApiKey: 'sk-key',
    })).toThrow(/LORE_API_URL/);
  });

  it('throws when lore remote enabled but missing LORE_API_KEY', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreMode: 'remote',
      loreApiUrl: 'https://lore.example.com',
    })).toThrow(/LORE_API_KEY/);
  });

  it('throws when lore remote enabled but missing both URL and key (first error: URL)', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreMode: 'remote',
    })).toThrow(/LORE_API_URL/);
  });
});

// ─── Features Endpoint ───────────────────────────────────

describe('GET /api/config/features', () => {
  it('returns { lore: false } by default', async () => {
    const { app } = createTestApp({ authDisabled: true });
    const res = await app.request('/api/config/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ lore: false });
  });

  it('returns { lore: true } when loreEnabled', async () => {
    const { app } = createTestApp({ authDisabled: true });
    // We need to create an app with loreEnabled — use createApp directly
    const { createApp } = await import('../index.js');
    const { createTestDb } = await import('../db/index.js');
    const { runMigrations } = await import('../db/migrate.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);
    const loreApp = createApp(store, { authDisabled: true, db, loreEnabled: true, loreMode: 'local' });
    const res = await loreApp.request('/api/config/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ lore: true });
  });

  it('is accessible without authentication', async () => {
    const { app } = createTestApp(); // auth enabled
    const res = await app.request('/api/config/features');
    // Should NOT be 401 — this endpoint is before auth middleware
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ lore: false });
  });
});

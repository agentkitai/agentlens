/**
 * Tests for Lore Feature Flag + Config (v0.5.0 integration)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, validateConfig } from '../config.js';
import { createTestApp } from './test-helpers.js';

// ─── Config Parsing ──────────────────────────────────────

describe('Lore config parsing', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const loreEnvVars = ['LORE_ENABLED', 'LORE_API_URL', 'LORE_API_KEY'];

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

  it('parses LORE_ENABLED=true', () => {
    process.env['LORE_ENABLED'] = 'true';
    const config = getConfig();
    expect(config.loreEnabled).toBe(true);
  });

  it('parses all lore env vars', () => {
    process.env['LORE_ENABLED'] = 'true';
    process.env['LORE_API_URL'] = 'https://lore.example.com';
    process.env['LORE_API_KEY'] = 'sk-test-key';
    const config = getConfig();
    expect(config.loreApiUrl).toBe('https://lore.example.com');
    expect(config.loreApiKey).toBe('sk-test-key');
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
    };
  }

  it('passes when lore is disabled', () => {
    expect(() => validateConfig(baseConfig())).not.toThrow();
  });

  it('passes when lore is enabled with url and key', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreApiUrl: 'https://lore.example.com',
      loreApiKey: 'sk-key',
    })).not.toThrow();
  });

  it('throws when lore enabled but missing LORE_API_URL', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreApiKey: 'sk-key',
    })).toThrow(/LORE_API_URL/);
  });

  it('throws when lore enabled but missing LORE_API_KEY', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
      loreApiUrl: 'https://lore.example.com',
    })).toThrow(/LORE_API_KEY/);
  });

  it('throws when lore enabled but missing both URL and key (first error: URL)', () => {
    expect(() => validateConfig({
      ...baseConfig(),
      loreEnabled: true,
    })).toThrow(/LORE_API_URL/);
  });
});

// ─── Features Endpoint ───────────────────────────────────

describe('GET /api/config/features', () => {
  it('returns { lore: false } by default', async () => {
    const { app } = await createTestApp({ authDisabled: true });
    const res = await app.request('/api/config/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ lore: false });
    expect(body.loreUrl).toBeUndefined();
  });

  it('returns { lore: true, loreUrl } when loreEnabled', async () => {
    const { createApp } = await import('../index.js');
    const { createTestDb } = await import('../db/index.js');
    const { runMigrations } = await import('../db/migrate.js');
    const { SqliteEventStore } = await import('../db/sqlite-store.js');
    const db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);
    const loreApp = await createApp(store, {
      authDisabled: true,
      db,
      loreEnabled: true,
      loreApiUrl: 'http://localhost:8765',
      loreApiKey: 'test-key',
    });
    const res = await loreApp.request('/api/config/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ lore: true, loreUrl: 'http://localhost:8765' });
  });

  it('is accessible without authentication', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/config/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ lore: false });
  });
});

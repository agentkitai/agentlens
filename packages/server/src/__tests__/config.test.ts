import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfig, validateConfig } from '../config.js';

describe('getConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env['CORS_ORIGIN'];
    delete process.env['AUTH_DISABLED'];
    delete process.env['PORT'];
    delete process.env['DB_PATH'];
    delete process.env['DATABASE_PATH'];
    delete process.env['RETENTION_DAYS'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults corsOrigin to http://localhost:3400', () => {
    const config = getConfig();
    expect(config.corsOrigin).toBe('http://localhost:3400');
  });

  it('defaults port to 3400', () => {
    const config = getConfig();
    expect(config.port).toBe(3400);
  });

  it('respects explicit CORS_ORIGIN env var', () => {
    process.env['CORS_ORIGIN'] = 'https://app.example.com';
    const config = getConfig();
    expect(config.corsOrigin).toBe('https://app.example.com');
  });

  it('respects explicit PORT env var', () => {
    process.env['PORT'] = '8080';
    const config = getConfig();
    expect(config.port).toBe(8080);
  });
});

describe('validateConfig', () => {
  it('logs warning when authDisabled is true', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateConfig({
      port: 3400,
      corsOrigin: 'http://localhost:3400',
      authDisabled: true,
      dbPath: './test.db',
      retentionDays: 90,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('WARNING: Authentication is DISABLED'),
    );
    warnSpy.mockRestore();
  });

  it('throws when CORS_ORIGIN=* and auth is enabled', () => {
    expect(() =>
      validateConfig({
        port: 3400,
        corsOrigin: '*',
        authDisabled: false,
        dbPath: './test.db',
        retentionDays: 90,
      }),
    ).toThrow(/CORS_ORIGIN=\* with authentication enabled/);
  });

  it('allows CORS_ORIGIN=* when auth is disabled (dev mode)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      validateConfig({
        port: 3400,
        corsOrigin: '*',
        authDisabled: true,
        dbPath: './test.db',
        retentionDays: 90,
      }),
    ).not.toThrow();
    warnSpy.mockRestore();
  });

  it('passes with secure defaults (specific origin + auth enabled)', () => {
    expect(() =>
      validateConfig({
        port: 3400,
        corsOrigin: 'http://localhost:3400',
        authDisabled: false,
        dbPath: './test.db',
        retentionDays: 90,
      }),
    ).not.toThrow();
  });
});

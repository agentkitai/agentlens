import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveSecret, resolveAllSecrets, MANAGED_SECRETS } from '../secrets.js';
import * as fs from 'node:fs';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe('resolveSecret', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    // Clean managed secret env vars
    for (const s of MANAGED_SECRETS) {
      delete process.env[s.name];
      delete process.env[`${s.name}_FILE`];
      delete process.env[`${s.name}_ARN`];
    }
    delete process.env['TEST_SECRET'];
    delete process.env['TEST_SECRET_FILE'];
    delete process.env['TEST_SECRET_ARN'];
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('Tier 1: returns plain env var', async () => {
    process.env['TEST_SECRET'] = 'plain-value';
    expect(await resolveSecret('TEST_SECRET')).toBe('plain-value');
  });

  it('Tier 2: reads from file path', async () => {
    process.env['TEST_SECRET_FILE'] = '/tmp/test-secret-sh7';
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    mockReadFileSync.mockImplementation((p: any, _opts: any) => {
      if (String(p) === '/tmp/test-secret-sh7') return '  file-secret-value\n';
      throw new Error('not found');
    });

    expect(await resolveSecret('TEST_SECRET')).toBe('file-secret-value');
  });

  it('Tier 2: throws on file read error', async () => {
    process.env['TEST_SECRET_FILE'] = '/nonexistent/path';
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    await expect(resolveSecret('TEST_SECRET')).rejects.toThrow('failed to read file');
  });

  it('Tier 1 takes precedence over Tier 2', async () => {
    process.env['TEST_SECRET'] = 'env-wins';
    process.env['TEST_SECRET_FILE'] = '/some/file';
    expect(await resolveSecret('TEST_SECRET')).toBe('env-wins');
  });

  it('returns undefined when no tier matches', async () => {
    expect(await resolveSecret('TEST_SECRET')).toBeUndefined();
  });
});

describe('resolveAllSecrets', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const s of MANAGED_SECRETS) {
      delete process.env[s.name];
      delete process.env[`${s.name}_FILE`];
      delete process.env[`${s.name}_ARN`];
    }
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('fails fast in production if JWT_SECRET is missing', async () => {
    process.env['NODE_ENV'] = 'production';
    await expect(resolveAllSecrets()).rejects.toThrow('Required secret "JWT_SECRET"');
  });

  it('does not fail in development if JWT_SECRET is missing', async () => {
    process.env['NODE_ENV'] = 'development';
    const result = await resolveAllSecrets();
    expect(result['JWT_SECRET']).toBeUndefined();
  });

  it('injects resolved secrets into process.env', async () => {
    process.env['JWT_SECRET'] = 'my-jwt';
    process.env['DATABASE_URL'] = 'sqlite://test';
    const result = await resolveAllSecrets();
    expect(result['JWT_SECRET']).toBe('my-jwt');
    expect(process.env['JWT_SECRET']).toBe('my-jwt');
  });
});

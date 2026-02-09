/**
 * Auth Tests (S-2.1: OAuth, S-2.2: Email/Password)
 *
 * Unit tests run without Postgres.
 * Integration tests run when DATABASE_URL is set.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordComplexity,
} from '../auth/passwords.js';
import { signJwt, verifyJwt, JWT_COOKIE_OPTIONS } from '../auth/jwt.js';
import { generateToken, hashToken, verifyToken } from '../auth/tokens.js';
import { BruteForceProtection } from '../auth/brute-force.js';
import { AuthService, AuthError } from '../auth/auth-service.js';
import {
  getGoogleAuthUrl,
  getGithubAuthUrl,
  type OAuthProviderConfig,
} from '../auth/oauth.js';
import { runMigrations, type MigrationClient } from '../migrate.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');

// ═══════════════════════════════════════════
// S-2.2: Password Utilities (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.2: Password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('MyPassword1');
    expect(hash).toContain(':');
    expect(await verifyPassword('MyPassword1', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('MyPassword1');
    expect(await verifyPassword('WrongPassword1', hash)).toBe(false);
  });

  it('produces different hashes for same password (salt)', async () => {
    const h1 = await hashPassword('MyPassword1');
    const h2 = await hashPassword('MyPassword1');
    expect(h1).not.toBe(h2);
  });
});

describe('S-2.2: Password complexity validation', () => {
  it('accepts valid password', () => {
    expect(validatePasswordComplexity('MyPass123').valid).toBe(true);
  });

  it('rejects short password', () => {
    const result = validatePasswordComplexity('Mp1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('8 characters');
  });

  it('rejects password without uppercase', () => {
    const result = validatePasswordComplexity('mypass123');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('uppercase');
  });

  it('rejects password without lowercase', () => {
    const result = validatePasswordComplexity('MYPASS123');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('lowercase');
  });

  it('rejects password without digit', () => {
    const result = validatePasswordComplexity('MyPassword');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('digit');
  });

  it('returns multiple errors for very weak password', () => {
    const result = validatePasswordComplexity('abc');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════
// S-2.1: JWT Tests (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.1: JWT', () => {
  const secret = 'test-secret-key-for-jwt-testing';
  const payload = {
    sub: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    orgs: [{ org_id: 'org-1', role: 'owner' }],
  };

  it('signs and verifies a JWT', () => {
    const token = signJwt(payload, secret);
    const decoded = verifyJwt(token, secret);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('user-123');
    expect(decoded!.email).toBe('test@example.com');
    expect(decoded!.name).toBe('Test User');
    expect(decoded!.orgs).toEqual([{ org_id: 'org-1', role: 'owner' }]);
  });

  it('includes iat and exp in payload', () => {
    const token = signJwt(payload, secret, 3600);
    const decoded = verifyJwt(token, secret);
    expect(decoded!.iat).toBeDefined();
    expect(decoded!.exp).toBeDefined();
    expect(decoded!.exp - decoded!.iat).toBe(3600);
  });

  it('rejects tampered token', () => {
    const token = signJwt(payload, secret);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(verifyJwt(tampered, secret)).toBeNull();
  });

  it('rejects token with wrong secret', () => {
    const token = signJwt(payload, secret);
    expect(verifyJwt(token, 'wrong-secret')).toBeNull();
  });

  it('rejects expired token', () => {
    const token = signJwt(payload, secret, -10); // already expired
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('cookie options are secure', () => {
    expect(JWT_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(JWT_COOKIE_OPTIONS.secure).toBe(true);
    expect(JWT_COOKIE_OPTIONS.sameSite).toBe('Strict');
    expect(JWT_COOKIE_OPTIONS.maxAge).toBe(7 * 24 * 3600);
  });
});

// ═══════════════════════════════════════════
// S-2.2: Token Utilities (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.2: Token utilities', () => {
  it('generates unique tokens', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThan(20);
  });

  it('hashes and verifies a token', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken('wrong-token', hash)).toBe(false);
  });
});

// ═══════════════════════════════════════════
// S-2.2: Brute-Force Protection (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.2: Brute-force protection', () => {
  it('allows attempts below threshold', () => {
    const bf = new BruteForceProtection({ maxAttempts: 3, windowMs: 60000, lockDurationMs: 60000 });
    bf.recordFailure('test@example.com');
    bf.recordFailure('test@example.com');
    expect(bf.isLocked('test@example.com')).toBe(false);
  });

  it('locks after max attempts', () => {
    const bf = new BruteForceProtection({ maxAttempts: 3, windowMs: 60000, lockDurationMs: 60000 });
    bf.recordFailure('test@example.com');
    bf.recordFailure('test@example.com');
    const locked = bf.recordFailure('test@example.com');
    expect(locked).toBe(true);
    expect(bf.isLocked('test@example.com')).toBe(true);
  });

  it('clears on success', () => {
    const bf = new BruteForceProtection({ maxAttempts: 3, windowMs: 60000, lockDurationMs: 60000 });
    bf.recordFailure('test@example.com');
    bf.recordFailure('test@example.com');
    bf.recordSuccess('test@example.com');
    expect(bf.isLocked('test@example.com')).toBe(false);
    // Can fail again without immediate lock
    bf.recordFailure('test@example.com');
    expect(bf.isLocked('test@example.com')).toBe(false);
  });

  it('unlocks after lock duration expires', () => {
    const bf = new BruteForceProtection({ maxAttempts: 2, windowMs: 60000, lockDurationMs: 1 }); // 1ms lock
    bf.recordFailure('test@example.com');
    bf.recordFailure('test@example.com');
    // Wait for lock to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(bf.isLocked('test@example.com')).toBe(false);
        resolve();
      }, 10);
    });
  });

  it('isolates different keys', () => {
    const bf = new BruteForceProtection({ maxAttempts: 2, windowMs: 60000, lockDurationMs: 60000 });
    bf.recordFailure('a@example.com');
    bf.recordFailure('a@example.com');
    expect(bf.isLocked('a@example.com')).toBe(true);
    expect(bf.isLocked('b@example.com')).toBe(false);
  });
});

// ═══════════════════════════════════════════
// S-2.1: OAuth URL Generation (Unit Tests)
// ═══════════════════════════════════════════

describe('S-2.1: OAuth URL generation', () => {
  const googleConfig: OAuthProviderConfig = {
    clientId: 'google-client-id',
    clientSecret: 'google-secret',
    redirectUri: 'http://localhost:3000/auth/google/callback',
  };

  const githubConfig: OAuthProviderConfig = {
    clientId: 'github-client-id',
    clientSecret: 'github-secret',
    redirectUri: 'http://localhost:3000/auth/github/callback',
  };

  it('generates Google auth URL with correct params', () => {
    const url = getGoogleAuthUrl(googleConfig, 'state123');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=google-client-id');
    expect(url).toContain('state=state123');
    expect(url).toContain('scope=openid+email+profile');
  });

  it('generates GitHub auth URL with correct params', () => {
    const url = getGithubAuthUrl(githubConfig, 'state456');
    expect(url).toContain('github.com/login/oauth');
    expect(url).toContain('client_id=github-client-id');
    expect(url).toContain('state=state456');
    expect(url).toContain('scope=user');
  });
});

// ═══════════════════════════════════════════
// S-2.1 + S-2.2: Auth Service Integration Tests
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

describe('Integration: AuthService', () => {
  let authService: AuthService;

  beforeAll(async () => {
    pgAvailable = await tryConnectPg();
    if (pgAvailable && pool) {
      await resetDatabase();
      await runMigrations(pool, MIGRATIONS_DIR);
      authService = new AuthService(pool, { jwtSecret: 'test-secret-for-auth' });
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // S-2.1: OAuth
  it.skipIf(!pgAvailable)('OAuth login creates user and returns JWT', async () => {
    const result = await authService.oauthLogin({
      provider: 'google',
      providerId: 'google-123',
      email: 'oauth@example.com',
      name: 'OAuth User',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(result.token).toBeDefined();
    expect(result.user.email).toBe('oauth@example.com');

    // Verify JWT contains orgs
    const decoded = verifyJwt(result.token, 'test-secret-for-auth');
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe(result.user.id);
    expect(decoded!.orgs.length).toBeGreaterThanOrEqual(1);
    expect(decoded!.orgs[0].role).toBe('owner');
  });

  it.skipIf(!pgAvailable)('duplicate OAuth login links to existing user', async () => {
    const r1 = await authService.oauthLogin({
      provider: 'google',
      providerId: 'google-dup',
      email: 'dup@example.com',
      name: 'Dup User',
      avatarUrl: null,
    });
    const r2 = await authService.oauthLogin({
      provider: 'google',
      providerId: 'google-dup',
      email: 'dup@example.com',
      name: 'Dup User',
      avatarUrl: null,
    });
    expect(r1.user.id).toBe(r2.user.id);
  });

  it.skipIf(!pgAvailable)('GitHub OAuth creates user', async () => {
    const result = await authService.oauthLogin({
      provider: 'github',
      providerId: 'gh-456',
      email: 'ghuser@example.com',
      name: 'GH User',
      avatarUrl: null,
    });
    expect(result.user.email).toBe('ghuser@example.com');
    const decoded = verifyJwt(result.token, 'test-secret-for-auth');
    expect(decoded!.orgs.length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!pgAvailable)('OAuth links to existing email user', async () => {
    // Create email user first
    const reg = await authService.register('link@example.com', 'Password1', 'Link User');
    // Verify email
    await authService.verifyEmail(reg.verificationToken);

    // OAuth login with same email
    const oauthResult = await authService.oauthLogin({
      provider: 'github',
      providerId: 'gh-link',
      email: 'link@example.com',
      name: 'Link User',
      avatarUrl: null,
    });
    expect(oauthResult.user.id).toBe(reg.user.id);
  });

  // S-2.2: Email/Password Registration
  it.skipIf(!pgAvailable)('registers user with email/password', async () => {
    const result = await authService.register('newuser@example.com', 'MyPass123', 'New User');
    expect(result.user.email).toBe('newuser@example.com');
    expect(result.verificationToken).toBeDefined();
    expect(result.user.email_verified).toBe(false);
  });

  it.skipIf(!pgAvailable)('rejects duplicate email registration', async () => {
    await authService.register('unique@example.com', 'MyPass123');
    await expect(authService.register('unique@example.com', 'MyPass456')).rejects.toThrow(AuthError);
  });

  it.skipIf(!pgAvailable)('rejects weak password on registration', async () => {
    await expect(authService.register('weak@example.com', 'weak')).rejects.toThrow(AuthError);
  });

  it.skipIf(!pgAvailable)('verifies email with token', async () => {
    const reg = await authService.register('verify@example.com', 'MyPass123');
    const verified = await authService.verifyEmail(reg.verificationToken);
    expect(verified).toBe(true);
  });

  it.skipIf(!pgAvailable)('rejects invalid verification token', async () => {
    const verified = await authService.verifyEmail('invalid-token');
    expect(verified).toBe(false);
  });

  it.skipIf(!pgAvailable)('login fails before email verification', async () => {
    await authService.register('unverified@example.com', 'MyPass123');
    await expect(authService.login('unverified@example.com', 'MyPass123')).rejects.toThrow('verify your email');
  });

  it.skipIf(!pgAvailable)('login succeeds after email verification', async () => {
    const reg = await authService.register('verified@example.com', 'MyPass123');
    await authService.verifyEmail(reg.verificationToken);
    const result = await authService.login('verified@example.com', 'MyPass123');
    expect(result.token).toBeDefined();
    const decoded = verifyJwt(result.token, 'test-secret-for-auth');
    expect(decoded!.email).toBe('verified@example.com');
  });

  it.skipIf(!pgAvailable)('login fails with wrong password', async () => {
    const reg = await authService.register('wrongpw@example.com', 'MyPass123');
    await authService.verifyEmail(reg.verificationToken);
    await expect(authService.login('wrongpw@example.com', 'WrongPass1')).rejects.toThrow('Invalid email or password');
  });

  // S-2.2: Password Reset
  it.skipIf(!pgAvailable)('password reset flow works', async () => {
    const reg = await authService.register('reset@example.com', 'OldPass123');
    await authService.verifyEmail(reg.verificationToken);

    const resetToken = await authService.requestPasswordReset('reset@example.com');
    expect(resetToken).not.toBeNull();

    const reset = await authService.resetPassword(resetToken!, 'NewPass456');
    expect(reset).toBe(true);

    // Old password should fail
    await expect(authService.login('reset@example.com', 'OldPass123')).rejects.toThrow();
    // New password should work
    const result = await authService.login('reset@example.com', 'NewPass456');
    expect(result.token).toBeDefined();
  });

  it.skipIf(!pgAvailable)('password reset with invalid token fails', async () => {
    const result = await authService.resetPassword('bad-token', 'NewPass456');
    expect(result).toBe(false);
  });

  it.skipIf(!pgAvailable)('password reset rejects weak new password', async () => {
    const reg = await authService.register('resetweak@example.com', 'OldPass123');
    await authService.verifyEmail(reg.verificationToken);
    const resetToken = await authService.requestPasswordReset('resetweak@example.com');
    await expect(authService.resetPassword(resetToken!, 'weak')).rejects.toThrow(AuthError);
  });

  // S-2.2: Brute-force (integration — uses AuthService's built-in BruteForceProtection)
  it.skipIf(!pgAvailable)('locks account after too many failed attempts', async () => {
    const bf = new BruteForceProtection({ maxAttempts: 3, windowMs: 60000, lockDurationMs: 60000 });
    const svc = new AuthService(pool!, { jwtSecret: 'test-secret' }, bf);

    const reg = await svc.register('bruteforce@example.com', 'MyPass123');
    await svc.verifyEmail(reg.verificationToken);

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try { await svc.login('bruteforce@example.com', 'Wrong1234'); } catch {}
    }

    // 4th attempt should be locked
    await expect(svc.login('bruteforce@example.com', 'MyPass123')).rejects.toThrow('locked');
  });
});

// ═══════════════════════════════════════════
// Migration file test for 004_auth_tokens.sql
// ═══════════════════════════════════════════

describe('S-2.2: Auth tokens migration', () => {
  it('004_auth_tokens.sql exists and is valid', async () => {
    const { readMigration } = await import('../migrate.js');
    const sql = readMigration('004_auth_tokens.sql', MIGRATIONS_DIR);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS _email_tokens');
    expect(sql).toContain('token_hash');
    expect(sql).toContain("type IN ('verification', 'reset')");
    expect(sql).toContain('expires_at TIMESTAMPTZ');
  });
});

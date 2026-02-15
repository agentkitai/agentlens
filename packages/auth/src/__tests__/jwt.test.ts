import { describe, it, expect, beforeEach } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  hashToken,
  type RefreshTokenStore,
  type RefreshTokenRow,
  type AccessTokenClaims,
} from '../jwt.js';
import type { AuthConfig } from '../types.js';

// ── Test config ──────────────────────────────────────────────────────
const config: AuthConfig = {
  oidc: null,
  jwt: {
    secret: 'test-secret-at-least-32-chars-long!!',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 7 * 86400,
  },
  authDisabled: false,
};

// ── In-memory refresh token store ────────────────────────────────────
function memStore(): RefreshTokenStore & { rows: RefreshTokenRow[] } {
  const rows: RefreshTokenRow[] = [];
  return {
    rows,
    async insert(row) {
      rows.push({ ...row, revokedAt: null });
    },
    async findByHash(hash) {
      return rows.find((r) => r.tokenHash === hash) ?? null;
    },
    async revoke(id) {
      const r = rows.find((r) => r.id === id);
      if (r) r.revokedAt = new Date();
    },
  };
}

// ── Access token tests ───────────────────────────────────────────────
describe('Access tokens', () => {
  it('sign/verify round-trip', async () => {
    const payload: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
      sub: 'u1',
      tid: 't1',
      role: 'admin',
      email: 'a@b.com',
    };
    const token = await signAccessToken(payload, config);
    const claims = await verifyAccessToken(token, config);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('u1');
    expect(claims!.tid).toBe('t1');
    expect(claims!.role).toBe('admin');
    expect(claims!.email).toBe('a@b.com');
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects expired token', async () => {
    const shortConfig: AuthConfig = {
      ...config,
      jwt: { ...config.jwt, accessTokenTtlSeconds: 1 },
    };
    const token = await signAccessToken(
      { sub: 'u1', tid: 't1', role: 'viewer', email: 'a@b.com' },
      shortConfig,
    );
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1500));
    const claims = await verifyAccessToken(token, shortConfig);
    expect(claims).toBeNull();
  });

  it('rejects token with wrong secret', async () => {
    const token = await signAccessToken(
      { sub: 'u1', tid: 't1', role: 'viewer', email: 'a@b.com' },
      config,
    );
    const badConfig: AuthConfig = {
      ...config,
      jwt: { ...config.jwt, secret: 'wrong-secret-wrong-secret-wrong!!' },
    };
    expect(await verifyAccessToken(token, badConfig)).toBeNull();
  });
});

// ── Refresh token tests ──────────────────────────────────────────────
describe('Refresh tokens', () => {
  let store: ReturnType<typeof memStore>;
  beforeEach(() => {
    store = memStore();
  });

  it('creates and stores a hashed token', async () => {
    const raw = await createRefreshToken('u1', 't1', config, store);
    expect(raw).toBeTruthy();
    expect(store.rows).toHaveLength(1);
    // stored hash matches
    expect(store.rows[0].tokenHash).toBe(hashToken(raw));
    expect(store.rows[0].revokedAt).toBeNull();
  });

  it('rotation invalidates old token and issues new', async () => {
    const raw = await createRefreshToken('u1', 't1', config, store);
    const newRaw = await rotateRefreshToken(raw, config, store);
    expect(newRaw).toBeTruthy();
    expect(newRaw).not.toBe(raw);
    // old is revoked
    expect(store.rows[0].revokedAt).not.toBeNull();
    // new exists
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1].revokedAt).toBeNull();
  });

  it('rejects revoked refresh token', async () => {
    const raw = await createRefreshToken('u1', 't1', config, store);
    // revoke it
    await store.revoke(store.rows[0].id);
    const result = await rotateRefreshToken(raw, config, store);
    expect(result).toBeNull();
  });

  it('rejects expired refresh token', async () => {
    const shortConfig: AuthConfig = {
      ...config,
      jwt: { ...config.jwt, refreshTokenTtlSeconds: -1 },
    };
    const raw = await createRefreshToken('u1', 't1', shortConfig, store);
    const result = await rotateRefreshToken(raw, shortConfig, store);
    expect(result).toBeNull();
  });
});

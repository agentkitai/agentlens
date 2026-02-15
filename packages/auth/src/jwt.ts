// @agentkit/auth — JWT session management
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import type { AuthConfig, Role } from './types.js';

// ── Access-token claims ──────────────────────────────────────────────
export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  tid: string;
  role: Role;
  email: string;
}

// ── Refresh-token DB row (what the store must persist / return) ──────
export interface RefreshTokenRow {
  id: string;
  userId: string;
  tenantId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

// ── DB adapter — caller injects these ────────────────────────────────
export interface RefreshTokenStore {
  insert(row: Omit<RefreshTokenRow, 'revokedAt'>): Promise<void>;
  findByHash(hash: string): Promise<RefreshTokenRow | null>;
  revoke(id: string): Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────
function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ── Access tokens ────────────────────────────────────────────────────
export async function signAccessToken(
  payload: Omit<AccessTokenClaims, 'iat' | 'exp'>,
  config: AuthConfig,
): Promise<string> {
  const ttl = config.jwt.accessTokenTtlSeconds ?? 900; // 15 min default
  return new SignJWT({ ...payload } as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub as string)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey(config.jwt.secret));
}

export async function verifyAccessToken(
  token: string,
  config: AuthConfig,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config.jwt.secret), {
      algorithms: ['HS256'],
    });
    return payload as unknown as AccessTokenClaims;
  } catch {
    return null;
  }
}

// ── Refresh tokens ───────────────────────────────────────────────────
export async function createRefreshToken(
  userId: string,
  tenantId: string,
  config: AuthConfig,
  store: RefreshTokenStore,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const hash = hashToken(raw);
  const ttl = config.jwt.refreshTokenTtlSeconds ?? 7 * 86400;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const id = randomBytes(16).toString('hex');

  await store.insert({ id, userId, tenantId, tokenHash: hash, expiresAt });
  return raw;
}

export async function rotateRefreshToken(
  oldRaw: string,
  config: AuthConfig,
  store: RefreshTokenStore,
): Promise<string | null> {
  const hash = hashToken(oldRaw);
  const row = await store.findByHash(hash);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  // Revoke old
  await store.revoke(row.id);

  // Issue new
  const newRaw = await createRefreshToken(row.userId, row.tenantId, config, store);
  return newRaw;
}

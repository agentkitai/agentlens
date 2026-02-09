/**
 * JWT utilities using Node.js built-in crypto (HMAC-SHA256).
 * No external dependencies.
 */

import { createHmac } from 'node:crypto';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  name: string | null;
  orgs: Array<{ org_id: string; role: string }>;
  iat: number;
  exp: number;
}

const ALG = 'HS256';

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

/**
 * Sign a JWT payload. Returns a compact JWT string.
 */
export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds = 7 * 24 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = base64url(JSON.stringify({ alg: ALG, typ: 'JWT' }));
  const body = base64url(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT. Returns null if invalid or expired.
 */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const payload: JwtPayload = JSON.parse(base64urlDecode(body));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Cookie options for JWT storage.
 */
export const JWT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict' as const,
  path: '/',
  maxAge: 7 * 24 * 3600, // 7 days in seconds
};

/**
 * Token utilities for email verification and password reset.
 * Uses crypto.randomBytes for secure token generation.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Generate a secure random token (URL-safe).
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage (SHA-256).
 * We store the hash, not the raw token — same pattern as API keys.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a raw token against its stored hash.
 */
export function verifyToken(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

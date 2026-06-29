/**
 * Reversible secret encryption for stored provider credentials (#143).
 *
 * Unlike API keys (one-way scrypt hash), LLM-connection keys must be decryptable
 * so the server can call the provider. AES-256-GCM (authenticated) with a master
 * key from `AGENTLENS_ENCRYPTION_KEY`. If unset, `secretsAvailable()` is false and
 * callers must refuse to store secrets (no plaintext-at-rest fallback).
 *
 * Blob format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>`.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const VERSION = 'v1';

/** 32-byte key from env: 64-hex, 32-byte base64, or any passphrase (sha256-derived). */
function masterKey(): Buffer | null {
  const raw = process.env.AGENTLENS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  // Convenience: derive a stable 32-byte key from an arbitrary passphrase.
  return createHash('sha256').update(raw).digest();
}

export function secretsAvailable(): boolean {
  return masterKey() !== null;
}

export function encryptSecret(plaintext: string): string {
  const key = masterKey();
  if (!key) throw new Error('AGENTLENS_ENCRYPTION_KEY is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string): string {
  const key = masterKey();
  if (!key) throw new Error('AGENTLENS_ENCRYPTION_KEY is not configured');
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('malformed or unsupported secret blob');
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64!, 'base64')), decipher.final()]).toString('utf8');
}

/** Last 4 chars of a secret for masked display (never the full value). */
export function lastFour(secret: string): string {
  return secret.length <= 4 ? '••••' : secret.slice(-4);
}

/**
 * Reversible secret encryption (#143).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, secretsAvailable, lastFour } from '../secret-box.js';

afterEach(() => {
  delete process.env.AGENTLENS_ENCRYPTION_KEY;
});

describe('secret-box', () => {
  it('reports availability from the env key', () => {
    delete process.env.AGENTLENS_ENCRYPTION_KEY;
    expect(secretsAvailable()).toBe(false);
    process.env.AGENTLENS_ENCRYPTION_KEY = 'some-passphrase';
    expect(secretsAvailable()).toBe(true);
  });

  it('round-trips a secret and never embeds the plaintext', () => {
    process.env.AGENTLENS_ENCRYPTION_KEY = 'a'.repeat(64); // 64-hex → 32 bytes
    const blob = encryptSecret('sk-supersecret-123');
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain('supersecret');
    expect(decryptSecret(blob)).toBe('sk-supersecret-123');
  });

  it('detects tampering (GCM auth tag)', () => {
    process.env.AGENTLENS_ENCRYPTION_KEY = 'k'.repeat(64);
    const blob = encryptSecret('sk-abc-1234');
    const parts = blob.split(':');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 0xff; // flip a ciphertext byte
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('cannot decrypt under a different key', () => {
    process.env.AGENTLENS_ENCRYPTION_KEY = 'key-one';
    const blob = encryptSecret('sk-xyz');
    process.env.AGENTLENS_ENCRYPTION_KEY = 'key-two';
    expect(() => decryptSecret(blob)).toThrow();
  });

  it('masks via lastFour and throws without a key', () => {
    expect(lastFour('sk-1234abcd')).toBe('abcd');
    expect(lastFour('xy')).toBe('••••');
    delete process.env.AGENTLENS_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow();
  });
});

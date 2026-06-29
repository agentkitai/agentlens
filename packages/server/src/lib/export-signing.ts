/**
 * Asymmetric export signing (#125) — Ed25519, third-party-verifiable.
 *
 * Exports/evidence packs are signed with a private key and verified with the
 * PUBLIC key only (published at the JWKS endpoint), so an auditor can confirm an
 * export's integrity without trusting our server or sharing a secret. No new
 * deps: Node's native Ed25519 + JWK export.
 *
 * Key source: `AGENTLENS_EXPORT_PRIVATE_KEY` (PEM, PKCS#8) for a stable JWKS in
 * production; otherwise an ephemeral keypair is generated per process (fine for
 * local/OSS — the JWKS still verifies that process's exports).
 */
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHash,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalJson } from './evidence.js';

export interface ExportSignature {
  type: 'ed25519';
  alg: 'EdDSA';
  kid: string;
  value: string; // base64url(signature)
}

interface KeyMaterial {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
  jwk: Record<string, string>;
}

let cached: KeyMaterial | null = null;

/** RFC-7638 JWK thumbprint (base64url SHA-256 over the canonical OKP members). */
function thumbprint(jwk: Record<string, unknown>): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

function load(): KeyMaterial {
  if (cached) return cached;
  const pem = process.env.AGENTLENS_EXPORT_PRIVATE_KEY?.trim();
  let privateKey: KeyObject;
  let publicKey: KeyObject;
  if (pem) {
    privateKey = createPrivateKey(pem);
    publicKey = createPublicKey(privateKey);
  } else {
    // ponytail: ephemeral keypair for local/OSS; set AGENTLENS_EXPORT_PRIVATE_KEY (PEM) for a stable JWKS.
    ({ privateKey, publicKey } = generateKeyPairSync('ed25519'));
  }
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const kid = thumbprint(jwk);
  jwk.kid = kid;
  jwk.use = 'sig';
  jwk.alg = 'EdDSA';
  cached = { privateKey, publicKey, kid, jwk };
  return cached;
}

/** Reset the cached keypair (tests). */
export function resetExportKeyCache(): void {
  cached = null;
}

/** The signing key id (JWK thumbprint). */
export function exportKeyId(): string {
  return load().kid;
}

/** Public JWK for the JWKS endpoint (safe to publish). */
export function getPublicJwk(): Record<string, string> {
  return { ...load().jwk };
}

export function getJwks(): { keys: Record<string, string>[] } {
  return { keys: [getPublicJwk()] };
}

/** Sign a value over its canonical JSON serialization. */
export function signExport(body: unknown): ExportSignature {
  const { privateKey, kid } = load();
  const value = edSign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64url');
  return { type: 'ed25519', alg: 'EdDSA', kid, value };
}

/**
 * Verify a signature over `body`. With `jwk` supplied (e.g. fetched from the
 * JWKS endpoint), verification uses ONLY that public key — no server secret.
 */
export function verifyExport(body: unknown, signature: ExportSignature | null, jwk?: Record<string, string>): boolean {
  if (!signature || signature.type !== 'ed25519') return false;
  let pub: KeyObject;
  try {
    pub = jwk ? createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' }) : load().publicKey;
  } catch {
    return false;
  }
  try {
    return edVerify(null, Buffer.from(canonicalJson(body)), pub, Buffer.from(signature.value, 'base64url'));
  } catch {
    return false;
  }
}

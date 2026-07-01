/**
 * #272 — RFC 3161 CMS signature verification. Generates a self-signed TSA cert +
 * a CMS-signed timestamp token in-test, then verifies (and rejects a tampered one).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { verifyTimestampSignature } from '../rfc3161-verify.js';

// A real token from freetsa.org (ECDSA cert, SHA-512, id-ct-TSTInfo content) —
// the shape node-forge's pkcs7 rejected (#277). Captured via /api/audit/timestamp.
const REAL_TOKEN = readFileSync(new URL('./fixtures/freetsa-token.b64', import.meta.url), 'utf8').trim();

function makeSignedToken(): { token: string; rootPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 3_600_000);
  const attrs = [{ name: 'commonName', value: 'Test TSA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed root
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer('TSTInfo-bytes', 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign();

  const A = forge.asn1;
  const pkiStatus = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
    A.create(A.Class.UNIVERSAL, A.Type.INTEGER, false, String.fromCharCode(0)), // status: granted
  ]);
  const resp = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [pkiStatus, p7.toAsn1()]);
  const der = A.toDer(resp).getBytes();
  return { token: Buffer.from(der, 'binary').toString('base64'), rootPem: forge.pki.certificateToPem(cert) };
}

describe('#272 RFC 3161 signature verification', () => {
  it('verifies a well-formed signed token and chains to the trusted root', () => {
    const { token, rootPem } = makeSignedToken();
    const v = verifyTimestampSignature(token, [rootPem]);
    expect(v.signatureVerified).toBe(true);
    expect(v.chainTrusted).toBe(true);
    expect(v.signer?.subject).toContain('Test TSA');
  });

  it('verifies the signature without trusted roots (chainTrusted undefined)', () => {
    const { token } = makeSignedToken();
    const v = verifyTimestampSignature(token);
    expect(v.signatureVerified).toBe(true);
    expect(v.chainTrusted).toBeUndefined();
  });

  it('rejects a token whose signature bytes were tampered', () => {
    const { token } = makeSignedToken();
    const bytes = Buffer.from(token, 'base64');
    bytes[bytes.length - 12] = bytes[bytes.length - 12]! ^ 0xff;
    const v = verifyTimestampSignature(bytes.toString('base64'));
    expect(v.signatureVerified).toBe(false);
  });

  it('reports malformed input', () => {
    expect(verifyTimestampSignature('bm90LWEtdG9rZW4=').signatureVerified).toBe(false);
  });

  // #277: real-world tokens use ECDSA + SHA-512 + id-ct-TSTInfo, which node-forge
  // can't parse/verify. The hybrid (forge parse + Node crypto verify) handles them.
  it('verifies a REAL freetsa token (ECDSA / SHA-512 / TSTInfo)', () => {
    const v = verifyTimestampSignature(REAL_TOKEN);
    expect(v.signatureVerified).toBe(true);
    expect(v.signer?.subject).toContain('freetsa.org');
  });

  it('rejects a real token whose signature bytes were tampered', () => {
    const bytes = Buffer.from(REAL_TOKEN, 'base64');
    bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff;
    expect(verifyTimestampSignature(bytes.toString('base64')).signatureVerified).toBe(false);
  });
});

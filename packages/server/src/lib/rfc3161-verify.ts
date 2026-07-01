/**
 * RFC 3161 cryptographic verification (#272) — verify the TSA's CMS signature on a
 * stored timestamp token using the embedded signing certificate.
 *
 * The token is a TimeStampResp = SEQUENCE { PKIStatusInfo, timeStampToken }, where
 * timeStampToken is a CMS SignedData (ContentInfo). We verify the SignerInfo
 * signature over its signed attributes with the signer cert's public key. Optional
 * trusted-root chaining is layered on top (bundled/config roots).
 */
import forge from 'node-forge';

export interface SignatureVerification {
  signatureVerified: boolean;
  signer?: { subject: string; issuer: string; notAfter: string };
  /** cert chains to a supplied trusted root (undefined when no roots given). */
  chainTrusted?: boolean;
  reason?: string;
}

function name(attrs: forge.pki.CertificateField[]): string {
  const cn = attrs.find((a) => a.shortName === 'CN' || a.name === 'commonName');
  return (cn?.value as string) ?? attrs.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(',');
}

/**
 * Verify the CMS signature on a base64 TimeStampResp. `trustedRootsPem` (optional)
 * are PEM certs the signer must chain to; when omitted, only the signature itself
 * is checked (chainTrusted is left undefined).
 */
export function verifyTimestampSignature(tokenBase64: string, trustedRootsPem: string[] = []): SignatureVerification {
  let resp: forge.asn1.Asn1;
  try {
    resp = forge.asn1.fromDer(Buffer.from(tokenBase64, 'base64').toString('binary'));
  } catch (e) {
    return { signatureVerified: false, reason: `malformed token: ${(e as Error).message}` };
  }
  const children = (resp.value as forge.asn1.Asn1[]) ?? [];
  const contentInfo = children[1]; // [0] = PKIStatusInfo, [1] = timeStampToken (ContentInfo)
  if (!contentInfo) return { signatureVerified: false, reason: 'no timeStampToken (not granted?)' };

  let p7: forge.pkcs7.PkcsSignedData;
  try {
    p7 = forge.pkcs7.messageFromAsn1(contentInfo) as forge.pkcs7.PkcsSignedData;
  } catch (e) {
    return { signatureVerified: false, reason: `not a CMS SignedData: ${(e as Error).message}` };
  }

  const cert = p7.certificates?.[0];
  const raw = (p7 as unknown as { rawCapture: Record<string, unknown> }).rawCapture;
  const sig = raw?.signature as string | undefined;
  const authAttrs = raw?.authenticatedAttributes as forge.asn1.Asn1[] | undefined;
  if (!cert || !sig || !authAttrs) return { signatureVerified: false, reason: 'missing signer certificate or signature' };

  // The signature is over the DER of the signed attributes re-encoded as a SET OF.
  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, authAttrs);
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(set).getBytes());

  let signatureVerified = false;
  try {
    signatureVerified = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().bytes(), sig);
  } catch (e) {
    return { signatureVerified: false, reason: `signature check failed: ${(e as Error).message}` };
  }

  const signer = {
    subject: name(cert.subject.attributes),
    issuer: name(cert.issuer.attributes),
    notAfter: cert.validity.notAfter.toISOString(),
  };

  let chainTrusted: boolean | undefined;
  if (trustedRootsPem.length > 0) {
    try {
      const store = forge.pki.createCaStore(trustedRootsPem);
      chainTrusted = forge.pki.verifyCertificateChain(store, [cert]);
    } catch {
      chainTrusted = false;
    }
  }

  return {
    signatureVerified,
    signer,
    ...(chainTrusted !== undefined ? { chainTrusted } : {}),
    ...(signatureVerified ? {} : { reason: 'signature does not verify against the embedded certificate' }),
  };
}

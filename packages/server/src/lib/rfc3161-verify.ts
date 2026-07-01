/**
 * RFC 3161 cryptographic verification (#272 / #277) — verify the TSA's CMS
 * signature on a stored timestamp token using the embedded signing certificate.
 *
 * The token is a TimeStampResp = SEQUENCE { PKIStatusInfo, timeStampToken }, where
 * timeStampToken is a CMS SignedData. We parse the ASN.1 with node-forge (which
 * parses any DER) and verify the SignerInfo signature over the re-encoded signed
 * attributes with Node's own crypto — crucially, `crypto.verify` + `X509Certificate`
 * handle ECDSA / RSA and any digest, whereas forge's pkcs7/pki are RSA + id-data
 * only and reject real tokens (which use ECDSA keys and id-ct-TSTInfo content).
 */
import forge from 'node-forge';
import crypto from 'node:crypto';

export interface SignatureVerification {
  signatureVerified: boolean;
  signer?: { subject: string; issuer: string; notAfter: string };
  /** cert chains to a supplied trusted root (undefined when no roots given). */
  chainTrusted?: boolean;
  reason?: string;
}

const OID_TO_HASH: Record<string, string> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '1.3.14.3.2.26': 'sha1',
};

/**
 * Verify the CMS signature on a base64 TimeStampResp. `trustedRootsPem` (optional)
 * are PEM certs the signer must chain to; when omitted only the signature itself is
 * checked (chainTrusted is left undefined).
 */
export function verifyTimestampSignature(tokenBase64: string, trustedRootsPem: string[] = []): SignatureVerification {
  const A = forge.asn1;
  let resp: forge.asn1.Asn1;
  try {
    resp = A.fromDer(Buffer.from(tokenBase64, 'base64').toString('binary'));
  } catch (e) {
    return { signatureVerified: false, reason: `malformed token: ${(e as Error).message}` };
  }

  try {
    const children = (resp.value as forge.asn1.Asn1[]) ?? [];
    const contentInfo = children[1]; // [0] = PKIStatusInfo, [1] = timeStampToken
    if (!contentInfo) return { signatureVerified: false, reason: 'no timeStampToken (not granted?)' };
    // ContentInfo { contentType OID, [0] EXPLICIT content } → SignedData SEQUENCE.
    const signedData = ((contentInfo.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];

    let certs: forge.asn1.Asn1 | null = null;
    let signerInfos: forge.asn1.Asn1 | null = null;
    for (const el of signedData) {
      if (el.tagClass === A.Class.CONTEXT_SPECIFIC && el.type === 0) certs = el; // [0] certificates
      if (el.tagClass === A.Class.UNIVERSAL && el.type === A.Type.SET) signerInfos = el; // last SET = signerInfos
    }
    if (!certs || !signerInfos) return { signatureVerified: false, reason: 'no signer certificate or signerInfos' };

    // SignerInfo ::= SEQUENCE { version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature }
    const si = (signerInfos.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
    const digestAlg = si[2];
    let signedAttrs: forge.asn1.Asn1 | null = null;
    let sigNode: forge.asn1.Asn1 | null = null;
    for (const el of si) {
      if (el.tagClass === A.Class.CONTEXT_SPECIFIC && el.type === 0) signedAttrs = el;
      else if (el.tagClass === A.Class.UNIVERSAL && el.type === A.Type.OCTETSTRING) sigNode = el;
    }
    if (!signedAttrs || !sigNode) return { signatureVerified: false, reason: 'unsupported signer (no signed attributes)' };

    const hashName = OID_TO_HASH[A.derToOid((digestAlg.value as forge.asn1.Asn1[])[0].value as string)] ?? 'sha256';
    // The signature covers the DER of the signed attributes re-encoded as a SET OF.
    const set = A.create(A.Class.UNIVERSAL, A.Type.SET, true, signedAttrs.value as forge.asn1.Asn1[]);
    const signedAttrsDer = Buffer.from(A.toDer(set).getBytes(), 'binary');
    const signature = Buffer.from(sigNode.value as string, 'binary');
    const certDer = Buffer.from(A.toDer((certs.value as forge.asn1.Asn1[])[0]).getBytes(), 'binary');

    const x509 = new crypto.X509Certificate(certDer);
    let signatureVerified = false;
    try {
      signatureVerified = crypto.verify(hashName, signedAttrsDer, x509.publicKey, signature);
    } catch (e) {
      return { signatureVerified: false, reason: `signature check failed: ${(e as Error).message}` };
    }

    const signer = { subject: x509.subject.replace(/\n/g, ', '), issuer: x509.issuer.replace(/\n/g, ', '), notAfter: new Date(x509.validTo).toISOString() };

    let chainTrusted: boolean | undefined;
    if (trustedRootsPem.length > 0) {
      chainTrusted = trustedRootsPem.some((pem) => {
        try {
          const root = new crypto.X509Certificate(pem);
          return x509.checkIssued(root) && x509.verify(root.publicKey);
        } catch {
          return false;
        }
      });
    }

    return {
      signatureVerified,
      signer,
      ...(chainTrusted !== undefined ? { chainTrusted } : {}),
      ...(signatureVerified ? {} : { reason: 'signature does not verify against the embedded certificate' }),
    };
  } catch (e) {
    return { signatureVerified: false, reason: `parse error: ${(e as Error).message}` };
  }
}

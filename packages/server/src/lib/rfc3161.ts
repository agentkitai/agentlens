/**
 * RFC 3161 trusted timestamping (#99) — third-party non-repudiable anchoring.
 *
 * Requests a signed timestamp token for a SHA-256 hash (e.g. an audit-export
 * digest) from a Time-Stamping Authority. The token is the TSA's cryptographic
 * proof that the hash existed at a given time; we store it as evidence. The
 * TimeStampReq for a SHA-256 imprint is a fixed DER template, so no ASN.1 library
 * is needed to build it, and `fetch` is injectable for testing.
 *
 * Scope: request + store the signed token, and read back the TSA's status +
 * genTime. Full offline CMS/cert-chain verification of the token signature is a
 * follow-up (it needs a trusted-cert store + CMS parsing).
 */

export type FetchFn = typeof fetch;

// DER prefix for TimeStampReq { version 1, messageImprint { sha256, <hash> }, certReq TRUE }
// up to the 32-byte hash, then the certReq suffix. See the RFC 3161 ASN.1 module.
const REQ_PREFIX = Uint8Array.from([
  0x30, 0x39, 0x02, 0x01, 0x01, 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65,
  0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
]);
const REQ_SUFFIX = Uint8Array.from([0x01, 0x01, 0xff]); // certReq TRUE

/** Build a DER-encoded RFC 3161 TimeStampReq for a SHA-256 hash (64 hex chars). */
export function buildTimeStampRequest(sha256Hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256Hex)) throw new Error('sha256Hex must be 64 hex characters');
  const hash = Uint8Array.from(Buffer.from(sha256Hex, 'hex'));
  const out = new Uint8Array(REQ_PREFIX.length + 32 + REQ_SUFFIX.length);
  out.set(REQ_PREFIX, 0);
  out.set(hash, REQ_PREFIX.length);
  out.set(REQ_SUFFIX, REQ_PREFIX.length + 32);
  return out;
}

/** Parse the TSA's GeneralizedTime (18 0f YYYYMMDDHHMMSSZ) → ISO string, if present. */
export function parseGenTime(resp: Uint8Array): string | null {
  for (let i = 0; i + 17 <= resp.length; i++) {
    if (resp[i] === 0x18 && resp[i + 1] === 0x0f) {
      const s = Buffer.from(resp.subarray(i + 2, i + 17)).toString('ascii');
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
    }
  }
  return null;
}

export interface TimestampResult {
  /** The DER TimeStampResp, base64 (the storable evidence). */
  token: string;
  /** TSA PKIStatus was granted / grantedWithMods. */
  granted: boolean;
  /** The TSA's asserted time, if parseable. */
  genTime: string | null;
}

/** Request a trusted timestamp for a SHA-256 hash from an RFC 3161 TSA. */
export async function requestTimestamp(tsaUrl: string, sha256Hex: string, fetchFn: FetchFn = fetch): Promise<TimestampResult> {
  const body = buildTimeStampRequest(sha256Hex);
  const res = await fetchFn(tsaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/timestamp-query' },
    body: body as BodyInit,
  });
  if (!res.ok) throw new Error(`TSA request failed: ${res.status}`);
  const resp = new Uint8Array(await res.arrayBuffer());
  // PKIStatusInfo.status is the first INTEGER: 0 granted, 1 grantedWithMods.
  const granted = statusGranted(resp);
  return { token: Buffer.from(resp).toString('base64'), granted, genTime: parseGenTime(resp) };
}

/** Read the leading PKIStatus (TimeStampResp → PKIStatusInfo → status INTEGER). */
function statusGranted(resp: Uint8Array): boolean {
  // 30 <l> 30 <l> 02 01 <status> ...
  if (resp[0] !== 0x30) return false;
  let i = 2;
  if (resp[1]! & 0x80) i = 2 + (resp[1]! & 0x7f); // long-form outer length
  if (resp[i] !== 0x30) return false; // PKIStatusInfo SEQUENCE
  const statusSeqStart = i + 2;
  if (resp[statusSeqStart] === 0x02 && resp[statusSeqStart + 1] === 0x01) {
    const status = resp[statusSeqStart + 2]!;
    return status === 0 || status === 1;
  }
  return false;
}

/**
 * Signed chain anchors (#124) — a tamper-evident checkpoint over a contiguous
 * chain segment, so a cold range can be verified (and safely purged) without a
 * full chain walk. Produced at retention time over the segment being purged:
 * verify the segment, then sign `{firstPrevHash, lastHash, count, segmentDigest,
 * pricingVersions, verifiedAgentIds}` with the audit HMAC key.
 *
 * Post-purge, the signed anchor is the evidence the segment existed and chained
 * (firstPrevHash → lastHash), and its retained pricingVersions/verifiedAgentIds
 * keep per-agent cost reconciliation possible after the raw rows are gone.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { verifyChain, verifyRecords, type ChainEvent } from '@agentkitai/agentlens-core';
import { canonicalJson } from './evidence.js';

export interface AnchorEventRow {
  id: string;
  hash: string;
  prevHash: string | null;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  payload: unknown;
  metadata: Record<string, unknown>;
  verifiedAgentId?: string | null;
  pricingVersion?: string | null;
}

export interface AnchorBody {
  tenantId: string;
  scope: 'session';
  sessionId: string;
  firstPrevHash: string | null;
  lastHash: string;
  eventCount: number;
  segmentDigest: string;
  chained: boolean;
  tsMin: string;
  tsMax: string;
  pricingVersions: string[];
  verifiedAgentIds: string[];
}

export interface AnchorBuildResult {
  body: AnchorBody;
  /** Whether the segment's chain (or record integrity, for unchained) verified. */
  valid: boolean;
  reason?: string;
}

/** Digest over the ordered event hashes — binds the exact segment contents. */
export function segmentDigest(events: { hash: string }[]): string {
  return createHash('sha256').update(events.map((e) => e.hash).join('\n')).digest('hex');
}

/** Build an anchor body for an ordered (timestamp, id) segment + verify its chain. */
export function buildAnchor(tenantId: string, sessionId: string, events: AnchorEventRow[]): AnchorBuildResult {
  const chainEvents: ChainEvent[] = events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    sessionId: e.sessionId,
    agentId: e.agentId,
    eventType: e.eventType,
    severity: e.severity,
    payload: e.payload,
    metadata: e.metadata,
    prevHash: e.prevHash,
    hash: e.hash,
  }));
  // OTLP/unchained segments (prevHash=null throughout) → record integrity only.
  const unchained = events.length > 0 && events.every((e) => e.prevHash === null);
  const result = unchained ? verifyRecords(chainEvents) : verifyChain(chainEvents);

  const pricingVersions = [...new Set(events.map((e) => e.pricingVersion).filter((v): v is string => !!v))].sort();
  const verifiedAgentIds = [...new Set(events.map((e) => e.verifiedAgentId).filter((v): v is string => !!v))].sort();

  const body: AnchorBody = {
    tenantId,
    scope: 'session',
    sessionId,
    firstPrevHash: events[0]?.prevHash ?? null,
    lastHash: events[events.length - 1]?.hash ?? '',
    eventCount: events.length,
    segmentDigest: segmentDigest(events),
    chained: !unchained,
    tsMin: events[0]?.timestamp ?? '',
    tsMax: events[events.length - 1]?.timestamp ?? '',
    pricingVersions,
    verifiedAgentIds,
  };
  return { body, valid: result.valid, reason: result.reason ?? undefined };
}

/** HMAC-sign an anchor body (returns null when no signing key is configured). */
export function signAnchorBody(body: AnchorBody, signingKey: string | undefined): string | null {
  if (!signingKey) return null;
  return createHmac('sha256', signingKey).update(canonicalJson(body)).digest('hex');
}

/** Verify a stored anchor's signature against its (recomputed) body. */
export function verifyAnchorSignature(body: AnchorBody, signature: string | null, signingKey: string | undefined): boolean {
  if (!signingKey || !signature) return false;
  const expected = createHmac('sha256', signingKey).update(canonicalJson(body)).digest('hex');
  const got = Buffer.from(signature);
  const exp = Buffer.from(expected);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

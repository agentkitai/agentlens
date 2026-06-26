/**
 * Cross-product verifiable evidence (#98, Phase 1).
 *
 * Assembles a per-identity timeline + a signed evidence pack from the existing
 * hash-chained event store, keyed strictly on the server-derived
 * `verified_agent_id` (so the slice is attributable). Pure + testable; the route
 * (routes/audit-evidence.ts) wires these to the store + chain verification.
 *
 * Signing is HMAC today via a pluggable `signature.type` ('hmac' | 'rfc3161'),
 * so RFC-3161 third-party anchoring (#99) is a drop-in upgrade with no format
 * break (owner decision, agentlens#98).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { EventRepository } from '../db/repositories/event-repository.js';

/** A raw event row as returned by the repository range queries. */
export interface RawEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  payload: string;
  metadata: string;
  prevHash: string | null;
  hash: string;
}

/** A timeline entry: a raw event projected + tagged with its source product. */
export interface TimelineEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  product: string;
  severity: string;
  verifiedAgentMethod: string | null;
  hash: string;
}

export interface SessionChainProof {
  sessionId: string;
  verified: boolean;
  firstHash: string | null;
  lastHash: string | null;
}

export interface EvidencePackBody {
  kind: 'agentlens.evidence-pack/v1';
  exportedAt: string;
  tenantId: string;
  verifiedAgentId: string;
  range: { from: string; to: string };
  eventTypes: string[] | null;
  totalEvents: number;
  chains: SessionChainProof[];
  events: TimelineEvent[];
}

export interface PackSignature {
  type: 'hmac' | 'rfc3161';
  alg: string;
  value: string;
}

export type SignedEvidencePack = EvidencePackBody & { signature: PackSignature | null };

const BATCH_SIZE = 500;

/** Map an event type to the product that emits it (for timeline tagging). */
export function productForEventType(eventType: string): string {
  if (eventType.startsWith('approval_')) return 'agentgate';
  if (eventType.startsWith('form_')) return 'formbridge';
  if (eventType === 'eval_result') return 'eval';
  return 'agentlens';
}

function verifiedAgentMethodOf(metadata: string): string | null {
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>;
    return typeof m['verifiedAgentMethod'] === 'string' ? m['verifiedAgentMethod'] : null;
  } catch {
    return null;
  }
}

/** Project a raw event into a timeline entry (drops payload/metadata bulk). */
export function toTimelineEvent(row: RawEvent): TimelineEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.sessionId,
    agentId: row.agentId,
    eventType: row.eventType,
    product: productForEventType(row.eventType),
    severity: row.severity,
    verifiedAgentMethod: verifiedAgentMethodOf(row.metadata),
    hash: row.hash,
  };
}

/**
 * Collect ALL events for one verified agent in a range (paginated), optionally
 * filtered to a set of event types. Returns raw rows, ordered (timestamp, id).
 *
 * ponytail: accumulates the full result set in memory (bounded only by the
 * route's ≤1-year range cap), matching the existing audit /export. If
 * single-agent windows ever get huge, stream to the response / paginate the API.
 */
export function collectAgentEvents(
  repo: EventRepository,
  tenantId: string,
  verifiedAgentId: string,
  from: string,
  to: string,
  types?: string[] | null,
): RawEvent[] {
  const typeSet = types && types.length > 0 ? new Set(types) : null;
  const out: RawEvent[] = [];
  let offset = 0;
  for (;;) {
    const batch = repo.getEventsBatchByTenantAgentAndRange(tenantId, verifiedAgentId, from, to, offset, BATCH_SIZE);
    if (batch.length === 0) break;
    for (const row of batch) {
      if (!typeSet || typeSet.has(row.eventType)) out.push(row);
    }
    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }
  return out;
}

/** Deterministic JSON (recursively sorted keys) so signing/verifying are reorder-safe. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** HMAC-SHA256 over the canonical pack body. */
export function signEvidencePack(body: EvidencePackBody, signingKey: string): PackSignature {
  const value = createHmac('sha256', signingKey).update(canonicalJson(body)).digest('hex');
  return { type: 'hmac', alg: 'sha256', value };
}

/**
 * Verify a pack's signature: recompute the HMAC over the canonical body (minus
 * the signature) and compare in constant time. Returns a typed result rather
 * than throwing.
 */
export function verifyEvidencePackSignature(
  pack: SignedEvidencePack,
  signingKey: string,
): { valid: boolean; reason?: string } {
  const sig = pack.signature;
  if (!sig) return { valid: false, reason: 'pack has no signature' };
  if (sig.type !== 'hmac' || sig.alg !== 'sha256') {
    return { valid: false, reason: `unsupported signature type ${sig.type}/${sig.alg}` };
  }
  const { signature: _omit, ...body } = pack;
  void _omit;
  const expected = createHmac('sha256', signingKey).update(canonicalJson(body)).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(typeof sig.value === 'string' ? sig.value : '', 'hex');
  const valid = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  return valid ? { valid: true } : { valid: false, reason: 'signature mismatch' };
}

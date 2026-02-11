/**
 * @agentlensai/core — Hash Chain Utilities
 *
 * Cryptographic hash chain for tamper evidence per Architecture §4.3
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                     HASH CHAIN ALGORITHM                           │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │                                                                     │
 * │  Each AgentLens event is linked to the previous one via a SHA-256  │
 * │  hash chain — the same principle used in blockchain / git commits. │
 * │  If any event is modified, deleted, or reordered after the fact,   │
 * │  the chain breaks and verification fails.                          │
 * │                                                                     │
 * │  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐  │
 * │  │ Event 0  │────▶│ Event 1  │────▶│ Event 2  │────▶│ Event 3  │  │
 * │  │ (genesis)│     │          │     │          │     │          │  │
 * │  │prevH=null│     │prevH=H(0)│     │prevH=H(1)│     │prevH=H(2)│  │
 * │  │hash=H(0) │     │hash=H(1) │     │hash=H(2) │     │hash=H(3) │  │
 * │  └──────────┘     └──────────┘     └──────────┘     └──────────┘  │
 * │                                                                     │
 * │  H(n) = SHA-256( JSON.stringify({                                  │
 * │           v, id, timestamp, sessionId, agentId,                    │
 * │           eventType, severity, payload, metadata, prevHash         │
 * │         }) )                                                       │
 * │                                                                     │
 * │  Genesis event: prevHash = null  (anchors the chain)               │
 * │                                                                     │
 * │  VERIFICATION (verifyChain):                                       │
 * │    1. Assert events[0].prevHash === null                           │
 * │    2. For each event i:                                            │
 * │       a. Recompute hash from fields → must equal event.hash        │
 * │       b. If i > 0: event[i].prevHash must equal event[i-1].hash   │
 * │    3. If all pass → chain is valid (no tampering detected)         │
 * │                                                                     │
 * │  HASH_VERSION is embedded in the hash input so that if the field   │
 * │  layout ever changes, old and new hashes are distinguishable.      │
 * └─────────────────────────────────────────────────────────────────────┘
 */
import { createHash } from 'node:crypto';

/**
 * Hash format version. Bump when changing hash input structure
 * to distinguish old vs new hashes.
 */
export const HASH_VERSION = 2;

/**
 * Input type for computing event hash.
 * Includes all fields that contribute to the hash.
 */
export interface HashableEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  payload: unknown;
  metadata: Record<string, unknown>;
  prevHash: string | null;
}

/**
 * Compute a deterministic SHA-256 hash for an event.
 *
 * The hash is computed from a canonical JSON representation of the
 * event's key fields plus the previous event's hash (hash chain).
 *
 * @param event - The event fields to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export function computeEventHash(event: HashableEvent): string {
  const canonical = JSON.stringify({
    v: HASH_VERSION,
    id: event.id,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    agentId: event.agentId,
    eventType: event.eventType,
    severity: event.severity,
    payload: event.payload,
    metadata: event.metadata,
    prevHash: event.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Interface for events in chain verification.
 * Must include all hashable fields so hashes can be recomputed.
 */
export interface ChainEvent extends HashableEvent {
  hash: string;
}

/**
 * Detailed result from chain verification.
 */
export interface ChainVerificationResult {
  valid: boolean;
  /** Index of the first event that failed verification, or -1 if valid */
  failedAtIndex: number;
  /** Human-readable reason for the failure, or null if valid */
  reason: string | null;
}

/**
 * Verify the integrity of a hash chain.
 *
 * For each event:
 * 1. Recomputes the hash from event contents and verifies it matches event.hash
 * 2. Checks that prevHash matches the previous event's hash
 *
 * The first event in a chain should have prevHash = null.
 *
 * @param events - Ordered array of full events to verify
 * @returns ChainVerificationResult with details on any failure
 */
export function verifyChain(events: ChainEvent[]): ChainVerificationResult {
  if (events.length === 0) {
    return { valid: true, failedAtIndex: -1, reason: null };
  }

  // First event should have prevHash = null
  if (events[0].prevHash !== null) {
    return {
      valid: false,
      failedAtIndex: 0,
      reason: 'First event must have prevHash = null',
    };
  }

  for (let i = 0; i < events.length; i++) {
    // Recompute hash from contents
    const recomputed = computeEventHash(events[i]);
    if (recomputed !== events[i].hash) {
      return {
        valid: false,
        failedAtIndex: i,
        reason: `Event ${i} hash mismatch: expected ${recomputed}, got ${events[i].hash}`,
      };
    }

    // Verify prevHash chain continuity (skip first event, already checked prevHash === null)
    if (i > 0 && events[i].prevHash !== events[i - 1].hash) {
      return {
        valid: false,
        failedAtIndex: i,
        reason: `Event ${i} prevHash does not match previous event's hash`,
      };
    }
  }

  return { valid: true, failedAtIndex: -1, reason: null };
}

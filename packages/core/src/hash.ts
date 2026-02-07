/**
 * @agentlens/core — Hash Chain Utilities
 *
 * Cryptographic hash chain for tamper evidence per Architecture §4.3
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

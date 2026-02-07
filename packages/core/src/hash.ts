/**
 * @agentlens/core — Hash Chain Utilities
 *
 * Cryptographic hash chain for tamper evidence per Architecture §4.3
 */
import { createHash } from 'node:crypto';

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
  payload: unknown;
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
    id: event.id,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    agentId: event.agentId,
    eventType: event.eventType,
    payload: event.payload,
    prevHash: event.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Interface for events in chain verification.
 */
export interface ChainEvent {
  hash: string;
  prevHash: string | null;
}

/**
 * Verify the integrity of a hash chain.
 *
 * Checks that each event's prevHash matches the previous event's hash.
 * The first event in a chain should have prevHash = null.
 *
 * @param events - Ordered array of events to verify
 * @returns true if the chain is valid, false if any link is broken
 */
export function verifyChain(events: ChainEvent[]): boolean {
  if (events.length === 0) {
    return true;
  }

  // First event should have prevHash = null
  if (events[0].prevHash !== null) {
    return false;
  }

  for (let i = 1; i < events.length; i++) {
    if (events[i].prevHash !== events[i - 1].hash) {
      return false;
    }
  }

  return true;
}

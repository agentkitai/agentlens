/**
 * Anonymous ID Manager (Phase 4 — Story 1.4)
 *
 * Manages rotating anonymous agent IDs with 24h rotation.
 * Old IDs are kept for audit trail purposes.
 */

import { eq, and, gte } from 'drizzle-orm';
import { randomUUID, createHash } from 'crypto';
import type { SqliteDb } from './index.js';
import * as schema from './schema.sqlite.js';

/** Duration of anonymous ID validity (24 hours in milliseconds) */
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Salt for hashing agent IDs in the anonymous ID map (H4 fix) */
const ANON_ID_HASH_SALT = 'agentlens-anon-id-salt-v1';

export interface AnonymousIdManagerOptions {
  /** Override for current time (useful for testing) */
  now?: () => Date;
}

export class AnonymousIdManager {
  private readonly now: () => Date;

  constructor(
    private readonly db: SqliteDb,
    options?: AnonymousIdManagerOptions,
  ) {
    this.now = options?.now ?? (() => new Date());
  }

  /**
   * H4 FIX: Hash the agentId before storing in the DB so that if the DB
   * is compromised, agentId → anonymousId mapping is not directly readable.
   */
  private hashAgentId(tenantId: string, agentId: string): string {
    return createHash('sha256')
      .update(`${ANON_ID_HASH_SALT}:${tenantId}:${agentId}`)
      .digest('hex');
  }

  /**
   * Get the current anonymous ID for a tenant+agent pair,
   * or create/rotate one if needed.
   *
   * - Lazy creation: first call creates the ID
   * - 24h rotation: after expiry, a new ID is created
   * - Old IDs are kept for audit trail
   */
  getOrRotateAnonymousId(tenantId: string, agentId: string): string {
    const now = this.now();
    const nowIso = now.toISOString();

    // H4 FIX: Store hashed agentId to prevent de-anonymization if DB is compromised
    const hashedAgentId = this.hashAgentId(tenantId, agentId);

    // Find a valid (non-expired) anonymous ID
    const existing = this.db
      .select()
      .from(schema.anonymousIdMap)
      .where(
        and(
          eq(schema.anonymousIdMap.tenantId, tenantId),
          eq(schema.anonymousIdMap.agentId, hashedAgentId),
          gte(schema.anonymousIdMap.validUntil, nowIso),
        ),
      )
      .get();

    if (existing) {
      return existing.anonymousAgentId;
    }

    // Create a new anonymous ID with 24h validity
    const newId = randomUUID();
    const validUntil = new Date(now.getTime() + ROTATION_INTERVAL_MS);

    this.db
      .insert(schema.anonymousIdMap)
      .values({
        tenantId,
        agentId: hashedAgentId,
        anonymousAgentId: newId,
        validFrom: nowIso,
        validUntil: validUntil.toISOString(),
      })
      .run();

    return newId;
  }

  /**
   * Get all historical anonymous IDs for a tenant+agent (for audit).
   */
  getAuditTrail(tenantId: string, agentId: string): Array<{
    anonymousAgentId: string;
    validFrom: string;
    validUntil: string;
  }> {
    const hashedAgentId = this.hashAgentId(tenantId, agentId);
    return this.db
      .select({
        anonymousAgentId: schema.anonymousIdMap.anonymousAgentId,
        validFrom: schema.anonymousIdMap.validFrom,
        validUntil: schema.anonymousIdMap.validUntil,
      })
      .from(schema.anonymousIdMap)
      .where(
        and(
          eq(schema.anonymousIdMap.tenantId, tenantId),
          eq(schema.anonymousIdMap.agentId, hashedAgentId),
        ),
      )
      .all();
  }

  /**
   * Get the anonymous contributor ID for a tenant (not agent-specific).
   * Used for lesson sharing where the contributor is the tenant.
   */
  getOrRotateContributorId(tenantId: string): string {
    return this.getOrRotateAnonymousId(tenantId, '__contributor__');
  }
}

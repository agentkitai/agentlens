/**
 * Discovery Service (Story 5.3 — Discovery Protocol + Story 5.4 — Permission Model)
 *
 * Handles capability discovery with composite ranking and permission enforcement.
 */

import { eq, and } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { capabilityRegistry, discoveryConfig } from '../db/schema.sqlite.js';
import type { TaskType, DiscoveryQuery, DiscoveryResult } from '@agentlensai/core';
import { TASK_TYPES } from '@agentlensai/core';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';

// ─── Rate Limiting (in-memory, per-process) ───────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const RATE_WINDOW_MS = 60_000; // 1 minute

export class RateLimiter {
  private buckets = new Map<string, RateBucket>();

  check(key: string, limit: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= limit) {
      return false;
    }
    bucket.count++;
    return true;
  }

  /** Reset for testing */
  reset(): void {
    this.buckets.clear();
  }
}

// ─── Discovery Config Store ───────────────────────────────

export interface DiscoveryConfigData {
  tenantId: string;
  minTrustThreshold: number;
  delegationEnabled: boolean;
  updatedAt: string;
}

// ─── Permission Config (per-agent from capability_registry) ─

export interface AgentPermissionUpdate {
  enabled?: boolean;
  acceptDelegations?: boolean;
  inboundRateLimit?: number;
  outboundRateLimit?: number;
}

// ─── Discovery Service ───────────────────────────────────

export class DiscoveryService {
  private readonly anonIdManager: AnonymousIdManager;
  readonly inboundLimiter = new RateLimiter();
  readonly outboundLimiter = new RateLimiter();

  constructor(private readonly db: SqliteDb) {
    this.anonIdManager = new AnonymousIdManager(db);
  }

  // ─── Discovery Config (tenant-wide) ─────────────────

  getDiscoveryConfig(tenantId: string): DiscoveryConfigData {
    const row = this.db
      .select()
      .from(discoveryConfig)
      .where(eq(discoveryConfig.tenantId, tenantId))
      .get();

    if (row) {
      return {
        tenantId: row.tenantId,
        minTrustThreshold: row.minTrustThreshold,
        delegationEnabled: row.delegationEnabled,
        updatedAt: row.updatedAt,
      };
    }

    // Return defaults
    return {
      tenantId,
      minTrustThreshold: 60,
      delegationEnabled: false,
      updatedAt: new Date().toISOString(),
    };
  }

  updateDiscoveryConfig(tenantId: string, updates: Partial<Pick<DiscoveryConfigData, 'minTrustThreshold' | 'delegationEnabled'>>): DiscoveryConfigData {
    const now = new Date().toISOString();
    const existing = this.db
      .select()
      .from(discoveryConfig)
      .where(eq(discoveryConfig.tenantId, tenantId))
      .get();

    if (existing) {
      const setObj: Record<string, unknown> = { updatedAt: now };
      if (updates.minTrustThreshold !== undefined) setObj.minTrustThreshold = updates.minTrustThreshold;
      if (updates.delegationEnabled !== undefined) setObj.delegationEnabled = updates.delegationEnabled;
      this.db.update(discoveryConfig).set(setObj).where(eq(discoveryConfig.tenantId, tenantId)).run();
    } else {
      this.db.insert(discoveryConfig).values({
        tenantId,
        minTrustThreshold: updates.minTrustThreshold ?? 60,
        delegationEnabled: updates.delegationEnabled ?? false,
        updatedAt: now,
      }).run();
    }

    return this.getDiscoveryConfig(tenantId);
  }

  // ─── Permission: per-agent config ───────────────────

  updateAgentPermissions(tenantId: string, capabilityId: string, updates: AgentPermissionUpdate): boolean {
    const setObj: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.enabled !== undefined) setObj.enabled = updates.enabled;
    if (updates.acceptDelegations !== undefined) setObj.acceptDelegations = updates.acceptDelegations;
    if (updates.inboundRateLimit !== undefined) setObj.inboundRateLimit = updates.inboundRateLimit;
    if (updates.outboundRateLimit !== undefined) setObj.outboundRateLimit = updates.outboundRateLimit;

    const result = this.db
      .update(capabilityRegistry)
      .set(setObj)
      .where(and(eq(capabilityRegistry.id, capabilityId), eq(capabilityRegistry.tenantId, tenantId)))
      .run();

    return result.changes > 0;
  }

  // ─── Rate Limit Checks ─────────────────────────────

  checkInboundRateLimit(agentId: string, limit: number): boolean {
    return this.inboundLimiter.check(`inbound:${agentId}`, limit);
  }

  checkOutboundRateLimit(agentId: string, limit: number): boolean {
    return this.outboundLimiter.check(`outbound:${agentId}`, limit);
  }

  // ─── Discovery ─────────────────────────────────────

  discover(tenantId: string, query: DiscoveryQuery): DiscoveryResult[] {
    // Scope=internal: only local query, never hits external pool
    // (pool integration comes in B4)
    const rows = this.db
      .select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.tenantId, tenantId))
      .all();

    // Get tenant config for trust threshold
    const config = this.getDiscoveryConfig(tenantId);

    let results = rows
      // Only enabled capabilities are discoverable (5.4 opt-in)
      .filter((r) => r.enabled)
      // Filter by taskType
      .filter((r) => r.taskType === query.taskType)
      // Filter by customType if specified
      .filter((r) => !query.customType || r.customType === query.customType);

    // Apply trust filter (minTrustScore from query or tenant minimum)
    const effectiveMinTrust = Math.max(
      query.minTrustScore ?? 0,
      config.minTrustThreshold,
    );

    results = results.filter((r) => {
      const metrics = JSON.parse(r.qualityMetrics) as Record<string, unknown>;
      const trustScore = (metrics.trustScorePercentile as number) ?? 50;
      return trustScore >= effectiveMinTrust;
    });

    // Apply cost filter
    if (query.maxCostUsd !== undefined) {
      results = results.filter(
        (r) => r.estimatedCostUsd === null || r.estimatedCostUsd <= query.maxCostUsd!,
      );
    }

    // Apply latency filter
    if (query.maxLatencyMs !== undefined) {
      results = results.filter(
        (r) => r.estimatedLatencyMs === null || r.estimatedLatencyMs <= query.maxLatencyMs!,
      );
    }

    // Compute composite scores and rank
    const maxCost = query.maxCostUsd ?? 100;
    const maxLatency = query.maxLatencyMs ?? 30000;

    const scored = results.map((r) => {
      const metrics = JSON.parse(r.qualityMetrics) as Record<string, unknown>;
      const trustScore = ((metrics.trustScorePercentile as number) ?? 50) / 100;
      const normalizedCost = r.estimatedCostUsd != null ? Math.min(r.estimatedCostUsd / maxCost, 1.0) : 0.5;
      const normalizedLatency = r.estimatedLatencyMs != null ? Math.min(r.estimatedLatencyMs / maxLatency, 1.0) : 0.5;

      const compositeScore =
        0.5 * trustScore +
        0.3 * (1 - normalizedCost) +
        0.2 * (1 - normalizedLatency);

      return { row: r, compositeScore, metrics };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Limit results (max 20)
    const limit = Math.min(query.limit ?? 20, 20);
    const topResults = scored.slice(0, limit);

    // Map to DiscoveryResult with anonymous IDs
    return topResults.map(({ row, metrics }) => {
      const anonymousAgentId = this.anonIdManager.getOrRotateAnonymousId(tenantId, row.agentId);
      const completedTasks = (metrics.completedTasks as number) ?? 0;

      return {
        anonymousAgentId,
        taskType: row.taskType as TaskType,
        customType: row.customType ?? undefined,
        inputSchema: JSON.parse(row.inputSchema),
        outputSchema: JSON.parse(row.outputSchema),
        trustScorePercentile: ((metrics.trustScorePercentile as number) ?? 50),
        provisional: completedTasks < 10,
        estimatedLatencyMs: row.estimatedLatencyMs ?? undefined,
        estimatedCostUsd: row.estimatedCostUsd ?? undefined,
        qualityMetrics: {
          successRate: (metrics.successRate as number) ?? undefined,
          completedTasks: completedTasks || undefined,
        },
      };
    });
  }
}

/**
 * Trust Service (Story 6.3 — Trust Scoring)
 *
 * Computes trust scores for agents based on health score history and delegation success rate.
 * Formula: 0.6 * healthComponent + 0.4 * delegationSuccessRate (both normalized 0-100)
 */

import { sql } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { HealthSnapshotStore } from '../db/health-snapshot-store.js';

// ─── Types ────────────────────────────────────────────────

export interface TrustScore {
  agentId: string;
  rawScore: number;
  healthComponent: number;
  delegationComponent: number;
  percentile: number;
  provisional: boolean;
  totalDelegations: number;
  successfulDelegations: number;
  updatedAt: string;
}

export interface DelegationStats {
  total: number;
  successful: number;
  failed: number;
  timedOut: number;
}

// ─── Trust Service ────────────────────────────────────────

const PROVISIONAL_THRESHOLD = 10;
const HEALTH_WEIGHT = 0.6;
const DELEGATION_WEIGHT = 0.4;
const DEFAULT_HEALTH_SCORE = 50;
const HEALTH_HISTORY_DAYS = 30;

export class TrustService {
  private readonly healthStore: HealthSnapshotStore;

  constructor(private readonly db: SqliteDb) {
    this.healthStore = new HealthSnapshotStore(db);
  }

  /**
   * Get delegation stats for an agent in a tenant.
   */
  getDelegationStats(tenantId: string, agentId: string): DelegationStats {
    const rows = this.db.all<{ status: string; cnt: number }>(sql`
      SELECT status, COUNT(*) as cnt FROM delegation_log
      WHERE tenant_id = ${tenantId}
        AND agent_id = ${agentId}
        AND direction = 'outbound'
        AND (status = 'completed' OR status = 'error' OR status = 'timeout' OR status = 'rejected')
      GROUP BY status
    `);

    const stats: DelegationStats = { total: 0, successful: 0, failed: 0, timedOut: 0 };
    for (const row of rows) {
      const count = Number(row.cnt);
      stats.total += count;
      if (row.status === 'completed') stats.successful += count;
      else if (row.status === 'timeout') stats.timedOut += count;
      else stats.failed += count;
    }
    return stats;
  }

  /**
   * Compute the health component (average of last 30 days of health scores).
   */
  computeHealthComponent(tenantId: string, agentId: string): number {
    const history = this.healthStore.getHistory(tenantId, agentId, HEALTH_HISTORY_DAYS);
    if (history.length === 0) return DEFAULT_HEALTH_SCORE;
    const sum = history.reduce((acc, s) => acc + s.overallScore, 0);
    return sum / history.length;
  }

  /**
   * Compute the delegation success rate component (0-100).
   */
  computeDelegationComponent(stats: DelegationStats): number {
    if (stats.total === 0) return DEFAULT_HEALTH_SCORE; // default when no data
    return (stats.successful / stats.total) * 100;
  }

  /**
   * Compute the raw trust score for an agent.
   */
  computeRawTrustScore(tenantId: string, agentId: string): number {
    const healthComponent = this.computeHealthComponent(tenantId, agentId);
    const stats = this.getDelegationStats(tenantId, agentId);
    const delegationComponent = this.computeDelegationComponent(stats);
    return HEALTH_WEIGHT * healthComponent + DELEGATION_WEIGHT * delegationComponent;
  }

  /**
   * Compute percentile rank of an agent's trust score among all agents in the tenant.
   */
  computePercentile(tenantId: string, agentId: string): number {
    // Get all unique agent IDs in the tenant (from delegation_log + capability_registry)
    const agentRows = this.db.all<{ agent_id: string }>(sql`
      SELECT DISTINCT agent_id FROM capability_registry WHERE tenant_id = ${tenantId}
      UNION
      SELECT DISTINCT agent_id FROM delegation_log WHERE tenant_id = ${tenantId}
    `);

    const agentIds = agentRows.map((r) => r.agent_id);
    if (agentIds.length <= 1) return 100; // Only agent → 100th percentile

    // Compute scores for all agents
    const scores = agentIds.map((id) => ({
      agentId: id,
      score: this.computeRawTrustScore(tenantId, id),
    }));

    scores.sort((a, b) => a.score - b.score);

    const targetScore = scores.find((s) => s.agentId === agentId)?.score ?? 0;
    const belowCount = scores.filter((s) => s.score < targetScore).length;
    return Math.round((belowCount / (scores.length - 1)) * 100);
  }

  /**
   * Get the full trust score for an agent.
   */
  getTrustScore(tenantId: string, agentId: string): TrustScore {
    const healthComponent = this.computeHealthComponent(tenantId, agentId);
    const stats = this.getDelegationStats(tenantId, agentId);
    const delegationComponent = this.computeDelegationComponent(stats);
    const rawScore = HEALTH_WEIGHT * healthComponent + DELEGATION_WEIGHT * delegationComponent;
    const percentile = this.computePercentile(tenantId, agentId);
    const provisional = stats.total < PROVISIONAL_THRESHOLD;

    return {
      agentId,
      rawScore: Math.round(rawScore * 100) / 100,
      healthComponent: Math.round(healthComponent * 100) / 100,
      delegationComponent: Math.round(delegationComponent * 100) / 100,
      percentile,
      provisional,
      totalDelegations: stats.total,
      successfulDelegations: stats.successful,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Update trust-related quality metrics on the capability registry after a delegation outcome.
   * Called after delegation success/failure/timeout to keep trust score percentile fresh.
   */
  updateAfterDelegation(tenantId: string, agentId: string): void {
    const score = this.getTrustScore(tenantId, agentId);

    // Update all capability_registry entries for this agent with the new trust percentile
    this.db.run(sql`
      UPDATE capability_registry
      SET quality_metrics = json_set(
        quality_metrics,
        '$.trustScorePercentile', ${score.percentile},
        '$.trustRawScore', ${score.rawScore},
        '$.provisional', ${score.provisional ? 1 : 0}
      ),
      updated_at = ${new Date().toISOString()}
      WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}
    `);
  }
}

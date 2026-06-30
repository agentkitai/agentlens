/**
 * Health Snapshot Store (Story 1.3)
 *
 * CRUD operations for the health_snapshots table with tenant isolation.
 * Stores daily health score snapshots for historical tracking.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';
import type { HealthSnapshot } from '@agentkitai/agentlens-core';

/** Full row shape as stored in the database */
interface HealthSnapshotRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  date: string;
  overall_score: number;
  error_rate_score: number;
  cost_efficiency_score: number;
  tool_success_score: number;
  latency_score: number;
  completion_rate_score: number;
  session_count: number;
  created_at: string;
}

/** Parse a DB row into a HealthSnapshot */
function rowToSnapshot(row: HealthSnapshotRow): HealthSnapshot {
  return {
    agentId: row.agent_id,
    date: row.date,
    overallScore: row.overall_score,
    errorRateScore: row.error_rate_score,
    costEfficiencyScore: row.cost_efficiency_score,
    toolSuccessScore: row.tool_success_score,
    latencyScore: row.latency_score,
    completionRateScore: row.completion_rate_score,
    sessionCount: row.session_count,
  };
}

export class HealthSnapshotStore {
  constructor(private readonly db: AnyDb) {}

  /**
   * Upsert a health snapshot (INSERT OR REPLACE by tenant_id + agent_id + date).
   */
  async save(tenantId: string, snapshot: HealthSnapshot): Promise<void> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await dbRun(this.db, sql`
      INSERT INTO health_snapshots (
        id, tenant_id, agent_id, date,
        overall_score, error_rate_score, cost_efficiency_score,
        tool_success_score, latency_score, completion_rate_score,
        session_count, created_at
      ) VALUES (
        ${id}, ${tenantId}, ${snapshot.agentId}, ${snapshot.date},
        ${snapshot.overallScore}, ${snapshot.errorRateScore}, ${snapshot.costEfficiencyScore},
        ${snapshot.toolSuccessScore}, ${snapshot.latencyScore}, ${snapshot.completionRateScore},
        ${snapshot.sessionCount}, ${now}
      )
      ON CONFLICT (tenant_id, agent_id, date) DO UPDATE SET
        id = excluded.id,
        overall_score = excluded.overall_score,
        error_rate_score = excluded.error_rate_score,
        cost_efficiency_score = excluded.cost_efficiency_score,
        tool_success_score = excluded.tool_success_score,
        latency_score = excluded.latency_score,
        completion_rate_score = excluded.completion_rate_score,
        session_count = excluded.session_count,
        created_at = excluded.created_at
    `);
  }

  /**
   * Get a single snapshot by agent ID and date.
   */
  async get(tenantId: string, agentId: string, date: string): Promise<HealthSnapshot | null> {
    const row = await dbGet<HealthSnapshotRow>(this.db, sql`
      SELECT * FROM health_snapshots
      WHERE tenant_id = ${tenantId}
        AND agent_id = ${agentId}
        AND date = ${date}
    `);

    return row ? rowToSnapshot(row) : null;
  }

  /**
   * Get snapshot history for an agent, ordered by date DESC.
   */
  async getHistory(tenantId: string, agentId: string, days: number): Promise<HealthSnapshot[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const rows = await dbAll<HealthSnapshotRow>(this.db, sql`
      SELECT * FROM health_snapshots
      WHERE tenant_id = ${tenantId}
        AND agent_id = ${agentId}
        AND date >= ${cutoffDate}
      ORDER BY date DESC
    `);

    return rows.map(rowToSnapshot);
  }

  /**
   * Get the latest snapshot for each agent in a tenant.
   */
  async getLatest(tenantId: string): Promise<Map<string, HealthSnapshot>> {
    // Use a subquery to get the max date per agent
    const rows = await dbAll<HealthSnapshotRow>(this.db, sql`
      SELECT hs.* FROM health_snapshots hs
      INNER JOIN (
        SELECT agent_id, MAX(date) as max_date
        FROM health_snapshots
        WHERE tenant_id = ${tenantId}
        GROUP BY agent_id
      ) latest ON hs.agent_id = latest.agent_id AND hs.date = latest.max_date
      WHERE hs.tenant_id = ${tenantId}
    `);

    const result = new Map<string, HealthSnapshot>();
    for (const row of rows) {
      result.set(row.agent_id, rowToSnapshot(row));
    }
    return result;
  }

  /**
   * Delete snapshots older than retention period.
   */
  async cleanup(tenantId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const result = await dbRunCount(this.db, sql`
      DELETE FROM health_snapshots
      WHERE tenant_id = ${tenantId}
        AND date < ${cutoffDate}
    `);

    return result;
  }
}

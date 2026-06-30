/**
 * Retention service — rollup-and-anchor-aware data cleanup (#124).
 *
 * Raw events are aggregated into `cost_rollups` on ingest, so purging them keeps
 * cost/usage queryable. Before deleting a session's expired prefix this service
 * VERIFIES the segment's chain and writes a SIGNED `chain_anchors` checkpoint —
 * so a cold range stays tamper-evident after the raw rows are gone, and a
 * broken/tampered segment is never silently purged.
 */
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbAll, dbRun, runInTransaction } from '../dialect-db.js';
import { safeJsonParse } from '../shared/query-helpers.js';
import { buildAnchor, signAnchorBody, type AnchorEventRow } from '../../lib/anchors.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('RetentionService');

interface EventRow {
  id: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  event_type: string;
  severity: string;
  payload: string;
  metadata: string;
  prev_hash: string | null;
  hash: string;
  verified_agent_id: string | null;
  pricing_version: string | null;
}

export class RetentionService {
  constructor(private db: AnyDb) {}

  async applyRetention(
    olderThan: string,
    tenantId?: string,
  ): Promise<{ deletedCount: number; anchoredSegments: number; skippedSegments: number }> {
    const signingKey = process.env.AUDIT_SIGNING_KEY?.trim() || undefined;

    const targetSessions = await dbAll<{ session_id: string; tenant_id: string }>(
      this.db,
      tenantId
        ? sql`SELECT DISTINCT session_id, tenant_id FROM events WHERE timestamp <= ${olderThan} AND tenant_id = ${tenantId}`
        : sql`SELECT DISTINCT session_id, tenant_id FROM events WHERE timestamp <= ${olderThan}`,
    );

    let deletedCount = 0;
    let anchoredSegments = 0;
    let skippedSegments = 0;

    for (const s of targetSessions) {
      const rows = await dbAll<EventRow>(this.db, sql`
        SELECT * FROM events
        WHERE session_id = ${s.session_id} AND tenant_id = ${s.tenant_id} AND timestamp <= ${olderThan}
        ORDER BY timestamp ASC, id ASC
      `);
      if (rows.length === 0) continue;

      const anchorRows: AnchorEventRow[] = rows.map((r) => ({
        id: r.id,
        hash: r.hash,
        prevHash: r.prev_hash,
        timestamp: r.timestamp,
        sessionId: r.session_id,
        agentId: r.agent_id,
        eventType: r.event_type,
        severity: r.severity,
        // pg returns jsonb columns as objects; sqlite returns them as text.
        payload: typeof r.payload === 'string' ? safeJsonParse(r.payload, {}) : (r.payload ?? {}),
        metadata: (typeof r.metadata === 'string' ? safeJsonParse(r.metadata, {}) : (r.metadata ?? {})) as Record<string, unknown>,
        verifiedAgentId: r.verified_agent_id,
        pricingVersion: r.pricing_version,
      }));

      const { body, valid, reason } = buildAnchor(s.tenant_id, s.session_id, anchorRows);
      if (!valid) {
        // Never silently purge a segment that fails verification (possible tamper).
        log.warn(`retention: skipping session ${s.session_id} — segment failed verification: ${reason ?? 'unknown'}`);
        skippedSegments++;
        continue;
      }

      const signature = signAnchorBody(body, signingKey);
      const now = new Date().toISOString();
      // Anchor first, then delete — never delete without a covering anchor.
      // Anchor first, then delete — atomically, on either dialect.
      await runInTransaction(this.db, [
        sql`
          INSERT INTO chain_anchors
            (id, tenant_id, scope, session_id, first_prev_hash, last_hash, event_count, segment_digest,
             chained, ts_min, ts_max, pricing_versions, verified_agent_ids, signature, created_at)
          VALUES
            (${randomUUID()}, ${body.tenantId}, 'session', ${body.sessionId}, ${body.firstPrevHash}, ${body.lastHash},
             ${body.eventCount}, ${body.segmentDigest}, ${body.chained ? 1 : 0}, ${body.tsMin}, ${body.tsMax},
             ${JSON.stringify(body.pricingVersions)}, ${JSON.stringify(body.verifiedAgentIds)}, ${signature ?? null}, ${now})
        `,
        sql`
          DELETE FROM events
          WHERE session_id = ${s.session_id} AND tenant_id = ${s.tenant_id} AND timestamp <= ${olderThan}
        `,
      ]);
      deletedCount += rows.length;
      anchoredSegments++;
    }

    // Orphan-session cleanup (sessions whose every event was purged).
    if (tenantId) {
      await dbRun(this.db, sql`
        DELETE FROM sessions WHERE tenant_id = ${tenantId}
          AND id NOT IN (SELECT DISTINCT session_id FROM events WHERE tenant_id = ${tenantId})
      `);
    } else {
      await dbRun(this.db, sql`DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM events)`);
    }

    return { deletedCount, anchoredSegments, skippedSegments };
  }
}

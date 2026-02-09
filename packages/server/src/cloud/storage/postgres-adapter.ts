/**
 * PostgreSQL Storage Adapter (S-4.2)
 *
 * Implements StorageAdapter for the cloud Postgres backend.
 * Uses the tenant pool from B2A for automatic org scoping via
 * SET LOCAL app.current_org within transactions.
 *
 * All queries use org_id composite indexes. RLS provides automatic
 * tenant scoping as defense-in-depth (queries also filter by org_id
 * explicitly for index usage).
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
} from '@agentlensai/core';
import type { StorageStats } from '@agentlensai/core';
import type { StorageAdapter, PaginatedResult } from './adapter.js';
import type { Pool } from '../tenant-pool.js';
import { withTenantTransaction } from '../tenant-pool.js';

// ─── Helpers ────────────────────────────────────────────────

function safeJson<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val as T;
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return fallback;
}

function mapEventRow(row: Record<string, unknown>): AgentLensEvent {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    sessionId: (row.session_id ?? row.sessionId) as string,
    agentId: (row.agent_id ?? row.agentId) as string,
    eventType: (row.event_type ?? row.eventType) as AgentLensEvent['eventType'],
    severity: row.severity as AgentLensEvent['severity'],
    payload: safeJson(row.payload, {}),
    metadata: safeJson(row.metadata, {}),
    prevHash: (row.prev_hash ?? row.prevHash) as string | null,
    hash: row.hash as string,
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
  };
}

function mapSessionRow(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    agentId: (row.agent_id ?? row.agentId) as string,
    agentName: (row.agent_name ?? row.agentName) as string | undefined,
    startedAt: (row.started_at ?? row.startedAt) as string,
    endedAt: (row.ended_at ?? row.endedAt) as string | undefined,
    status: row.status as Session['status'],
    eventCount: Number(row.event_count ?? row.eventCount ?? 0),
    toolCallCount: Number(row.tool_call_count ?? row.toolCallCount ?? 0),
    errorCount: Number(row.error_count ?? row.errorCount ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? row.totalCostUsd ?? 0),
    llmCallCount: Number(row.llm_call_count ?? row.llmCallCount ?? 0),
    totalInputTokens: Number(row.total_input_tokens ?? row.totalInputTokens ?? 0),
    totalOutputTokens: Number(row.total_output_tokens ?? row.totalOutputTokens ?? 0),
    tags: safeJson(row.tags, [] as string[]),
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
  };
}

function mapAgentRow(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    firstSeenAt: (row.first_seen_at ?? row.firstSeenAt) as string,
    lastSeenAt: (row.last_seen_at ?? row.lastSeenAt) as string,
    sessionCount: Number(row.session_count ?? row.sessionCount ?? 0),
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
    modelOverride: (row.model_override ?? row.modelOverride) as string | undefined,
    pausedAt: (row.paused_at ?? row.pausedAt) as string | undefined,
    pauseReason: (row.pause_reason ?? row.pauseReason) as string | undefined,
  };
}

// ─── Event Query Builder ────────────────────────────────────

interface QueryParts {
  where: string[];
  params: unknown[];
  paramIdx: number;
}

function buildEventWhere(orgId: string, query: EventQuery): QueryParts {
  const where: string[] = [`org_id = $1`];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (query.sessionId) {
    where.push(`session_id = $${idx}`);
    params.push(query.sessionId);
    idx++;
  }
  if (query.agentId) {
    where.push(`agent_id = $${idx}`);
    params.push(query.agentId);
    idx++;
  }
  if (query.eventType) {
    const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
    where.push(`event_type = ANY($${idx})`);
    params.push(types);
    idx++;
  }
  if (query.severity) {
    const sevs = Array.isArray(query.severity) ? query.severity : [query.severity];
    where.push(`severity = ANY($${idx})`);
    params.push(sevs);
    idx++;
  }
  if (query.from) {
    where.push(`timestamp >= $${idx}`);
    params.push(query.from);
    idx++;
  }
  if (query.to) {
    where.push(`timestamp <= $${idx}`);
    params.push(query.to);
    idx++;
  }
  if (query.search) {
    where.push(`payload::text ILIKE $${idx}`);
    params.push(`%${query.search}%`);
    idx++;
  }

  return { where, params, paramIdx: idx };
}

function buildSessionWhere(orgId: string, query: SessionQuery): QueryParts {
  const where: string[] = [`org_id = $1`];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (query.agentId) {
    where.push(`agent_id = $${idx}`);
    params.push(query.agentId);
    idx++;
  }
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    where.push(`status = ANY($${idx})`);
    params.push(statuses);
    idx++;
  }
  if (query.from) {
    where.push(`started_at >= $${idx}`);
    params.push(query.from);
    idx++;
  }
  if (query.to) {
    where.push(`started_at <= $${idx}`);
    params.push(query.to);
    idx++;
  }
  if (query.tags && query.tags.length > 0) {
    // Postgres jsonb array containment: tags @> ANY of the specified tags
    // Use ?| operator: does the jsonb array contain any of these strings?
    where.push(`tags ?| $${idx}`);
    params.push(query.tags);
    idx++;
  }

  return { where, params, paramIdx: idx };
}

// ─── PostgreSQL Storage Adapter ─────────────────────────────

export class PostgresStorageAdapter implements StorageAdapter {
  constructor(private readonly pool: Pool) {}

  async queryEvents(orgId: string, query: EventQuery): Promise<EventQueryResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const { where, params, paramIdx } = buildEventWhere(orgId, query);
      const whereClause = where.join(' AND ');
      const orderDir = query.order === 'asc' ? 'ASC' : 'DESC';
      const limit = Math.min(query.limit ?? 50, 500);
      const offset = query.offset ?? 0;

      // Count query
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM events WHERE ${whereClause}`,
        params,
      );
      const total = (countResult.rows[0] as { total: number })?.total ?? 0;

      // Data query
      const dataResult = await client.query(
        `SELECT * FROM events WHERE ${whereClause} ORDER BY timestamp ${orderDir} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      );

      const events = (dataResult.rows as Record<string, unknown>[]).map(mapEventRow);
      return {
        events,
        total,
        hasMore: offset + events.length < total,
      };
    });
  }

  async getEventsBySession(orgId: string, sessionId: string): Promise<AgentLensEvent[]> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM events WHERE org_id = $1 AND session_id = $2 ORDER BY timestamp ASC`,
        [orgId, sessionId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapEventRow);
    });
  }

  async getSessions(orgId: string, query: SessionQuery): Promise<PaginatedResult<Session>> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const { where, params, paramIdx } = buildSessionWhere(orgId, query);
      const whereClause = where.join(' AND ');
      const limit = Math.min(query.limit ?? 50, 500);
      const offset = query.offset ?? 0;

      // Count
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM sessions WHERE ${whereClause}`,
        params,
      );
      const total = (countResult.rows[0] as { total: number })?.total ?? 0;

      // Data
      const dataResult = await client.query(
        `SELECT * FROM sessions WHERE ${whereClause} ORDER BY started_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      );

      const items = (dataResult.rows as Record<string, unknown>[]).map(mapSessionRow);
      return { items, total, hasMore: offset + items.length < total };
    });
  }

  async getSession(orgId: string, sessionId: string): Promise<Session | null> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM sessions WHERE org_id = $1 AND id = $2 LIMIT 1`,
        [orgId, sessionId],
      );
      if (result.rows.length === 0) return null;
      return mapSessionRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async getAgents(orgId: string): Promise<Agent[]> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM agents WHERE org_id = $1 ORDER BY last_seen_at DESC`,
        [orgId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapAgentRow);
    });
  }

  async getStats(orgId: string): Promise<StorageStats> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const eventCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM events WHERE org_id = $1`, [orgId],
      );
      const sessionCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM sessions WHERE org_id = $1`, [orgId],
      );
      const agentCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM agents WHERE org_id = $1`, [orgId],
      );
      const oldest = await client.query(
        `SELECT timestamp FROM events WHERE org_id = $1 ORDER BY timestamp ASC LIMIT 1`, [orgId],
      );
      const newest = await client.query(
        `SELECT timestamp FROM events WHERE org_id = $1 ORDER BY timestamp DESC LIMIT 1`, [orgId],
      );

      // Postgres: estimate table size for this org (approximate via pg_total_relation_size)
      const sizeResult = await client.query(
        `SELECT pg_total_relation_size('events') AS size_bytes`,
      );

      return {
        totalEvents: (eventCount.rows[0] as { c: number })?.c ?? 0,
        totalSessions: (sessionCount.rows[0] as { c: number })?.c ?? 0,
        totalAgents: (agentCount.rows[0] as { c: number })?.c ?? 0,
        oldestEvent: (oldest.rows[0] as { timestamp: string } | undefined)?.timestamp,
        newestEvent: (newest.rows[0] as { timestamp: string } | undefined)?.timestamp,
        storageSizeBytes: Number((sizeResult.rows[0] as { size_bytes: number })?.size_bytes ?? 0),
      };
    });
  }
}

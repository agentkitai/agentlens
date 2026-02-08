/**
 * SQLite implementation of IEventStore.
 *
 * Write operations (Story 3.4):
 * - insertEvents() — batch insert in single transaction
 * - Auto-create/update session records on event insert
 * - Auto-create agent records on first event
 * - Session status management
 *
 * Read operations (Story 3.5):
 * - queryEvents(), getEvent(), getSessionTimeline(), countEvents()
 * - querySessions(), getSession()
 * - listAgents(), getAgent()
 * - getAnalytics(), getStats()
 */

import { eq, and, gte, lte, inArray, desc, asc, sql, like, count as drizzleCount } from 'drizzle-orm';
import { computeEventHash } from '@agentlens/core';
import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  AlertRule,
  AlertHistory,
} from '@agentlens/core';
import type { IEventStore, AnalyticsResult, StorageStats } from '@agentlens/core';
import type { SqliteDb } from './index.js';
import { events, sessions, agents, alertRules, alertHistory } from './schema.sqlite.js';
import { HashChainError, NotFoundError } from './errors.js';

// ─── Helpers ───────────────────────────────────────────────

/**
 * Safe JSON.parse that returns a fallback on any error instead of throwing.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class SqliteEventStore implements IEventStore {
  constructor(private db: SqliteDb) {}

  // ─── Events — Write ────────────────────────────────────────

  async insertEvents(eventList: AgentLensEvent[]): Promise<void> {
    if (eventList.length === 0) return;

    // Batch insert in a single transaction for atomicity and performance
    this.db.transaction((tx) => {
      // CRITICAL 3: Validate hash chain before inserting
      const firstEvent = eventList[0]!;

      // Check if the first event already exists (idempotent re-insert)
      const existingFirst = tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, firstEvent.id))
        .get();

      if (!existingFirst) {
        // Fresh insert — validate chain continuity against stored events
        const lastStoredEvent = tx
          .select({ hash: events.hash })
          .from(events)
          .where(eq(events.sessionId, firstEvent.sessionId))
          .orderBy(desc(events.timestamp), desc(events.id))
          .limit(1)
          .get();

        const lastStoredHash = lastStoredEvent?.hash ?? null;

        // Validate that the first event's prevHash matches the latest stored hash
        if (firstEvent.prevHash !== lastStoredHash) {
          throw new HashChainError(
            `Chain continuity broken: event ${firstEvent.id} has prevHash=${firstEvent.prevHash} but last stored hash is ${lastStoredHash}`,
          );
        }
      }

      // Validate each event's hash and intra-batch chain links
      for (let i = 0; i < eventList.length; i++) {
        const event = eventList[i]!;

        // Verify intra-batch chain continuity (for events after the first)
        if (i > 0) {
          const prevEvent = eventList[i - 1]!;
          if (event.prevHash !== prevEvent.hash) {
            throw new HashChainError(
              `Chain continuity broken within batch: event ${event.id} has prevHash=${event.prevHash} but previous event hash is ${prevEvent.hash}`,
            );
          }
        }

        // Recompute hash server-side and verify
        const recomputedHash = computeEventHash({
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

        if (event.hash !== recomputedHash) {
          throw new HashChainError(
            `Hash mismatch for event ${event.id}: supplied=${event.hash}, computed=${recomputedHash}`,
          );
        }
      }

      for (const event of eventList) {
        // CRITICAL 4: Idempotent event insertion — ON CONFLICT DO NOTHING
        tx.insert(events)
          .values({
            id: event.id,
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            agentId: event.agentId,
            eventType: event.eventType,
            severity: event.severity,
            payload: JSON.stringify(event.payload),
            metadata: JSON.stringify(event.metadata),
            prevHash: event.prevHash,
            hash: event.hash,
          })
          .onConflictDoNothing({ target: events.id })
          .run();

        // Handle session management
        this._handleSessionUpdate(tx, event);

        // Handle agent auto-creation
        this._handleAgentUpsert(tx, event);
      }
    });
  }

  private _handleSessionUpdate(
    tx: Parameters<Parameters<SqliteDb['transaction']>[0]>[0],
    event: AgentLensEvent,
  ): void {
    if (event.eventType === 'session_started') {
      // Create new session
      const payload = event.payload as Record<string, unknown>;
      const tags = (payload.tags as string[]) ?? [];
      const agentName = (payload.agentName as string) ?? undefined;

      // CRITICAL 4: Use INSERT ... ON CONFLICT DO UPDATE for sessions
      tx.insert(sessions)
        .values({
          id: event.sessionId,
          agentId: event.agentId,
          agentName: agentName,
          startedAt: event.timestamp,
          status: 'active',
          eventCount: 1,
          toolCallCount: 0,
          errorCount: 0,
          totalCostUsd: 0,
          tags: JSON.stringify(tags),
        })
        .onConflictDoUpdate({
          target: sessions.id,
          set: {
            agentName: agentName ?? sql`coalesce(${sessions.agentName}, NULL)`,
            status: 'active',
            eventCount: sql`${sessions.eventCount} + 1`,
            tags: tags.length > 0 ? JSON.stringify(tags) : sql`${sessions.tags}`,
          },
        })
        .run();
      return;
    }

    // For non-session_started events, ensure a session exists first (upsert)
    tx.insert(sessions)
      .values({
        id: event.sessionId,
        agentId: event.agentId,
        startedAt: event.timestamp,
        status: 'active',
        eventCount: 0,
        toolCallCount: 0,
        errorCount: 0,
        totalCostUsd: 0,
        tags: '[]',
      })
      .onConflictDoNothing({ target: sessions.id })
      .run();

    // Build incremental updates
    const isToolCall = event.eventType === 'tool_call';
    const isError =
      event.severity === 'error' ||
      event.severity === 'critical' ||
      event.eventType === 'tool_error';
    const isCost = event.eventType === 'cost_tracked';
    const costPayload = event.payload as Record<string, unknown>;
    const costUsd = isCost ? (Number(costPayload.costUsd) || 0) : 0;

    if (event.eventType === 'session_ended') {
      const payload = event.payload as Record<string, unknown>;
      const reason = payload.reason as string | undefined;
      const status = reason === 'error' ? 'error' : 'completed';

      tx.update(sessions)
        .set({
          endedAt: event.timestamp,
          status: status as 'active' | 'completed' | 'error',
          eventCount: sql`${sessions.eventCount} + 1`,
          errorCount: isError
            ? sql`${sessions.errorCount} + 1`
            : sessions.errorCount,
        })
        .where(eq(sessions.id, event.sessionId))
        .run();
      return;
    }

    // Regular event — increment counters
    tx.update(sessions)
      .set({
        eventCount: sql`${sessions.eventCount} + 1`,
        toolCallCount: isToolCall
          ? sql`${sessions.toolCallCount} + 1`
          : sessions.toolCallCount,
        errorCount: isError
          ? sql`${sessions.errorCount} + 1`
          : sessions.errorCount,
        totalCostUsd: isCost
          ? sql`${sessions.totalCostUsd} + ${costUsd}`
          : sessions.totalCostUsd,
      })
      .where(eq(sessions.id, event.sessionId))
      .run();
  }

  private _handleAgentUpsert(
    tx: Parameters<Parameters<SqliteDb['transaction']>[0]>[0],
    event: AgentLensEvent,
  ): void {
    // CRITICAL 4: Use INSERT ... ON CONFLICT DO UPDATE for agents
    const payload = event.payload as Record<string, unknown>;
    const agentName =
      (payload.agentName as string) ?? event.agentId;

    tx.insert(agents)
      .values({
        id: event.agentId,
        name: agentName,
        firstSeenAt: event.timestamp,
        lastSeenAt: event.timestamp,
        sessionCount: event.eventType === 'session_started' ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          lastSeenAt: event.timestamp,
          sessionCount:
            event.eventType === 'session_started'
              ? sql`${agents.sessionCount} + 1`
              : agents.sessionCount,
        },
      })
      .run();
  }

  // ─── Sessions — Write ──────────────────────────────────────

  async upsertSession(
    session: Partial<Session> & { id: string },
  ): Promise<void> {
    const existing = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .get();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (session.agentId !== undefined) updates.agentId = session.agentId;
      if (session.agentName !== undefined) updates.agentName = session.agentName;
      if (session.startedAt !== undefined) updates.startedAt = session.startedAt;
      if (session.endedAt !== undefined) updates.endedAt = session.endedAt;
      if (session.status !== undefined) updates.status = session.status;
      if (session.eventCount !== undefined) updates.eventCount = session.eventCount;
      if (session.toolCallCount !== undefined) updates.toolCallCount = session.toolCallCount;
      if (session.errorCount !== undefined) updates.errorCount = session.errorCount;
      if (session.totalCostUsd !== undefined) updates.totalCostUsd = session.totalCostUsd;
      if (session.tags !== undefined) updates.tags = JSON.stringify(session.tags);

      if (Object.keys(updates).length > 0) {
        this.db
          .update(sessions)
          .set(updates)
          .where(eq(sessions.id, session.id))
          .run();
      }
    } else {
      this.db
        .insert(sessions)
        .values({
          id: session.id,
          agentId: session.agentId ?? '',
          startedAt: session.startedAt ?? new Date().toISOString(),
          status: session.status ?? 'active',
          agentName: session.agentName,
          endedAt: session.endedAt,
          eventCount: session.eventCount ?? 0,
          toolCallCount: session.toolCallCount ?? 0,
          errorCount: session.errorCount ?? 0,
          totalCostUsd: session.totalCostUsd ?? 0,
          tags: JSON.stringify(session.tags ?? []),
        })
        .run();
    }
  }

  // ─── Agents — Write ────────────────────────────────────────

  async upsertAgent(
    agent: Partial<Agent> & { id: string },
  ): Promise<void> {
    const existing = this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agent.id))
      .get();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (agent.name !== undefined) updates.name = agent.name;
      if (agent.description !== undefined) updates.description = agent.description;
      if (agent.lastSeenAt !== undefined) updates.lastSeenAt = agent.lastSeenAt;
      if (agent.sessionCount !== undefined) updates.sessionCount = agent.sessionCount;

      if (Object.keys(updates).length > 0) {
        this.db
          .update(agents)
          .set(updates)
          .where(eq(agents.id, agent.id))
          .run();
      }
    } else {
      const now = new Date().toISOString();
      this.db
        .insert(agents)
        .values({
          id: agent.id,
          name: agent.name ?? agent.id,
          description: agent.description,
          firstSeenAt: agent.firstSeenAt ?? now,
          lastSeenAt: agent.lastSeenAt ?? now,
          sessionCount: agent.sessionCount ?? 0,
        })
        .run();
    }
  }

  // ─── Events — Read (Story 3.5 stubs, implemented later) ────

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    const orderDir = query.order === 'asc' ? asc : desc;

    const conditions = this._buildEventConditions(query);

    const rows = this.db
      .select()
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderDir(events.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    const total = await this.countEvents(query);

    return {
      events: rows.map(this._mapEventRow),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async getEvent(id: string): Promise<AgentLensEvent | null> {
    const row = this.db
      .select()
      .from(events)
      .where(eq(events.id, id))
      .get();

    return row ? this._mapEventRow(row) : null;
  }

  async getSessionTimeline(sessionId: string): Promise<AgentLensEvent[]> {
    const rows = this.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(asc(events.timestamp))
      .all();

    return rows.map(this._mapEventRow);
  }

  async countEvents(
    query: Omit<EventQuery, 'limit' | 'offset'>,
  ): Promise<number> {
    const conditions = this._buildEventConditions(query);

    const result = this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return result?.count ?? 0;
  }

  // ─── Sessions — Read ───────────────────────────────────────

  async querySessions(
    query: SessionQuery,
  ): Promise<{ sessions: Session[]; total: number }> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;

    const conditions = this._buildSessionConditions(query);

    const rows = this.db
      .select()
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const totalResult = this.db
      .select({ count: drizzleCount() })
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return {
      sessions: rows.map(this._mapSessionRow),
      total: totalResult?.count ?? 0,
    };
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();

    return row ? this._mapSessionRow(row) : null;
  }

  // ─── Agents — Read ─────────────────────────────────────────

  async listAgents(): Promise<Agent[]> {
    const rows = this.db
      .select()
      .from(agents)
      .orderBy(desc(agents.lastSeenAt))
      .all();

    return rows.map(this._mapAgentRow);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const row = this.db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .get();

    return row ? this._mapAgentRow(row) : null;
  }

  // ─── Analytics ─────────────────────────────────────────────

  async getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
  }): Promise<AnalyticsResult> {
    // HIGH 5: Build the time-bucket format string for SQLite strftime
    const formatStr =
      params.granularity === 'hour'
        ? '%Y-%m-%dT%H:00:00Z'
        : params.granularity === 'day'
          ? '%Y-%m-%dT00:00:00Z'
          : '%Y-%W'; // week — true ISO week bucketing

    const conditions = [
      gte(events.timestamp, params.from),
      lte(events.timestamp, params.to),
    ];
    if (params.agentId) {
      conditions.push(eq(events.agentId, params.agentId));
    }

    // HIGH 6: Compute avgLatencyMs and totalCostUsd from payload JSON
    // Bucketed query
    const bucketRows = this.db
      .all<{
        bucket: string;
        eventCount: number;
        toolCallCount: number;
        errorCount: number;
        uniqueSessions: number;
        avgLatencyMs: number;
        totalCostUsd: number;
      }>(
        sql`
          SELECT
            strftime(${formatStr}, timestamp) as bucket,
            COUNT(*) as eventCount,
            SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as toolCallCount,
            SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END) as errorCount,
            COUNT(DISTINCT session_id) as uniqueSessions,
            COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN json_extract(payload, '$.durationMs') ELSE NULL END), 0) as avgLatencyMs,
            COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN json_extract(payload, '$.costUsd') ELSE 0 END), 0) as totalCostUsd
          FROM events
          WHERE timestamp >= ${params.from}
            AND timestamp <= ${params.to}
            ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
      );

    // Totals query
    const totalsRow = this.db.get<{
      eventCount: number;
      toolCallCount: number;
      errorCount: number;
      uniqueSessions: number;
      uniqueAgents: number;
      avgLatencyMs: number;
      totalCostUsd: number;
    }>(
      sql`
        SELECT
          COUNT(*) as eventCount,
          SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as toolCallCount,
          SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END) as errorCount,
          COUNT(DISTINCT session_id) as uniqueSessions,
          COUNT(DISTINCT agent_id) as uniqueAgents,
          COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN json_extract(payload, '$.durationMs') ELSE NULL END), 0) as avgLatencyMs,
          COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN json_extract(payload, '$.costUsd') ELSE 0 END), 0) as totalCostUsd
        FROM events
        WHERE timestamp >= ${params.from}
          AND timestamp <= ${params.to}
          ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
      `,
    );

    return {
      buckets: bucketRows.map((row) => ({
        timestamp: row.bucket,
        eventCount: Number(row.eventCount),
        toolCallCount: Number(row.toolCallCount),
        errorCount: Number(row.errorCount),
        avgLatencyMs: Number(row.avgLatencyMs),
        totalCostUsd: Number(row.totalCostUsd),
        uniqueSessions: Number(row.uniqueSessions),
      })),
      totals: {
        eventCount: Number(totalsRow?.eventCount ?? 0),
        toolCallCount: Number(totalsRow?.toolCallCount ?? 0),
        errorCount: Number(totalsRow?.errorCount ?? 0),
        avgLatencyMs: Number(totalsRow?.avgLatencyMs ?? 0),
        totalCostUsd: Number(totalsRow?.totalCostUsd ?? 0),
        uniqueSessions: Number(totalsRow?.uniqueSessions ?? 0),
        uniqueAgents: Number(totalsRow?.uniqueAgents ?? 0),
      },
    };
  }

  // ─── Alert Rules ───────────────────────────────────────────

  async createAlertRule(rule: AlertRule): Promise<void> {
    this.db
      .insert(alertRules)
      .values({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        condition: rule.condition,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        scope: JSON.stringify(rule.scope),
        notifyChannels: JSON.stringify(rule.notifyChannels),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })
      .run();
  }

  // HIGH 8: Check affected row count and throw NotFoundError when zero
  async updateAlertRule(
    id: string,
    updates: Partial<AlertRule>,
  ): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
    if (updates.condition !== undefined) setValues.condition = updates.condition;
    if (updates.threshold !== undefined) setValues.threshold = updates.threshold;
    if (updates.windowMinutes !== undefined) setValues.windowMinutes = updates.windowMinutes;
    if (updates.scope !== undefined) setValues.scope = JSON.stringify(updates.scope);
    if (updates.notifyChannels !== undefined) setValues.notifyChannels = JSON.stringify(updates.notifyChannels);
    if (updates.updatedAt !== undefined) setValues.updatedAt = updates.updatedAt;

    if (Object.keys(setValues).length === 0) {
      // Even with no actual updates, verify the rule exists
      const existing = this.db
        .select({ id: alertRules.id })
        .from(alertRules)
        .where(eq(alertRules.id, id))
        .get();
      if (!existing) {
        throw new NotFoundError(`Alert rule not found: ${id}`);
      }
      return;
    }

    const result = this.db
      .update(alertRules)
      .set(setValues)
      .where(eq(alertRules.id, id))
      .run();

    if (result.changes === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async deleteAlertRule(id: string): Promise<void> {
    const result = this.db.delete(alertRules).where(eq(alertRules.id, id)).run();
    if (result.changes === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async listAlertRules(): Promise<AlertRule[]> {
    const rows = this.db.select().from(alertRules).all();
    return rows.map(this._mapAlertRuleRow);
  }

  async getAlertRule(id: string): Promise<AlertRule | null> {
    const row = this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.id, id))
      .get();
    return row ? this._mapAlertRuleRow(row) : null;
  }

  // ─── Alert History ─────────────────────────────────────────

  async insertAlertHistory(entry: AlertHistory): Promise<void> {
    this.db
      .insert(alertHistory)
      .values({
        id: entry.id,
        ruleId: entry.ruleId,
        triggeredAt: entry.triggeredAt,
        resolvedAt: entry.resolvedAt ?? null,
        currentValue: entry.currentValue,
        threshold: entry.threshold,
        message: entry.message,
      })
      .run();
  }

  async listAlertHistory(opts?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AlertHistory[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 50, 500);
    const offset = opts?.offset ?? 0;

    const conditions = [];
    if (opts?.ruleId) {
      conditions.push(eq(alertHistory.ruleId, opts.ruleId));
    }

    const rows = this.db
      .select()
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alertHistory.triggeredAt))
      .limit(limit)
      .offset(offset)
      .all();

    const totalResult = this.db
      .select({ count: drizzleCount() })
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return {
      entries: rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        triggeredAt: row.triggeredAt,
        resolvedAt: row.resolvedAt ?? undefined,
        currentValue: row.currentValue,
        threshold: row.threshold,
        message: row.message,
      })),
      total: totalResult?.count ?? 0,
    };
  }

  // ─── Maintenance ───────────────────────────────────────────

  async applyRetention(
    olderThan: string,
  ): Promise<{ deletedCount: number }> {
    // Count events to be deleted
    const countResult = this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(lte(events.timestamp, olderThan))
      .get();
    const deletedCount = countResult?.count ?? 0;

    if (deletedCount === 0) return { deletedCount: 0 };

    this.db.transaction((tx) => {
      // Delete old events
      tx.delete(events).where(lte(events.timestamp, olderThan)).run();

      // Clean up sessions with no remaining events
      tx.run(sql`
        DELETE FROM sessions
        WHERE id NOT IN (SELECT DISTINCT session_id FROM events)
      `);
    });

    return { deletedCount };
  }

  async getStats(): Promise<StorageStats> {
    const eventCount =
      this.db
        .select({ count: drizzleCount() })
        .from(events)
        .get()?.count ?? 0;

    const sessionCount =
      this.db
        .select({ count: drizzleCount() })
        .from(sessions)
        .get()?.count ?? 0;

    const agentCount =
      this.db
        .select({ count: drizzleCount() })
        .from(agents)
        .get()?.count ?? 0;

    const oldest = this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .orderBy(asc(events.timestamp))
      .limit(1)
      .get();

    const newest = this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .orderBy(desc(events.timestamp))
      .limit(1)
      .get();

    // SQLite page_count * page_size for storage size
    const pageCount =
      this.db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        ?.page_count ?? 0;
    const pageSize =
      this.db.get<{ page_size: number }>(sql`PRAGMA page_size`)
        ?.page_size ?? 0;

    return {
      totalEvents: eventCount,
      totalSessions: sessionCount,
      totalAgents: agentCount,
      oldestEvent: oldest?.timestamp,
      newestEvent: newest?.timestamp,
      storageSizeBytes: pageCount * pageSize,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────

  private _buildEventConditions(query: Omit<EventQuery, 'limit' | 'offset'>) {
    const conditions = [];

    if (query.sessionId) {
      conditions.push(eq(events.sessionId, query.sessionId));
    }
    if (query.agentId) {
      conditions.push(eq(events.agentId, query.agentId));
    }
    if (query.eventType) {
      if (Array.isArray(query.eventType)) {
        conditions.push(inArray(events.eventType, query.eventType));
      } else {
        conditions.push(eq(events.eventType, query.eventType));
      }
    }
    if (query.severity) {
      if (Array.isArray(query.severity)) {
        conditions.push(inArray(events.severity, query.severity));
      } else {
        conditions.push(eq(events.severity, query.severity));
      }
    }
    if (query.from) {
      conditions.push(gte(events.timestamp, query.from));
    }
    if (query.to) {
      conditions.push(lte(events.timestamp, query.to));
    }
    if (query.search) {
      conditions.push(like(events.payload, `%${query.search}%`));
    }

    return conditions;
  }

  // HIGH 4: Use json_each() for exact tag matching with OR semantics
  private _buildSessionConditions(query: SessionQuery) {
    const conditions = [];

    if (query.agentId) {
      conditions.push(eq(sessions.agentId, query.agentId));
    }
    if (query.status) {
      if (Array.isArray(query.status)) {
        if (query.status.length === 1) {
          conditions.push(eq(sessions.status, query.status[0]));
        } else if (query.status.length > 1) {
          conditions.push(inArray(sessions.status, query.status));
        }
      } else {
        conditions.push(eq(sessions.status, query.status));
      }
    }
    if (query.from) {
      conditions.push(gte(sessions.startedAt, query.from));
    }
    if (query.to) {
      conditions.push(lte(sessions.startedAt, query.to));
    }
    if (query.tags && query.tags.length > 0) {
      // Use json_each for exact tag matching with OR semantics
      // A session matches if it contains ANY of the specified tags
      const tagPlaceholders = query.tags.map((tag) => sql`${tag}`);
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM json_each(${sessions.tags}) AS je
          WHERE je.value IN (${sql.join(tagPlaceholders, sql`, `)})
        )`,
      );
    }

    return conditions;
  }

  // HIGH 7: Use safeJsonParse everywhere
  private _mapEventRow(row: typeof events.$inferSelect): AgentLensEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.sessionId,
      agentId: row.agentId,
      eventType: row.eventType as AgentLensEvent['eventType'],
      severity: row.severity as AgentLensEvent['severity'],
      payload: safeJsonParse(row.payload, {} as Record<string, unknown>),
      metadata: safeJsonParse(row.metadata, {} as Record<string, unknown>),
      prevHash: row.prevHash,
      hash: row.hash,
    };
  }

  private _mapSessionRow(row: typeof sessions.$inferSelect): Session {
    return {
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName ?? undefined,
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? undefined,
      status: row.status as Session['status'],
      eventCount: row.eventCount,
      toolCallCount: row.toolCallCount,
      errorCount: row.errorCount,
      totalCostUsd: row.totalCostUsd,
      tags: safeJsonParse(row.tags, [] as string[]),
    };
  }

  private _mapAgentRow(row: typeof agents.$inferSelect): Agent {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      sessionCount: row.sessionCount,
    };
  }

  private _mapAlertRuleRow(row: typeof alertRules.$inferSelect): AlertRule {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      condition: row.condition as AlertRule['condition'],
      threshold: row.threshold,
      windowMinutes: row.windowMinutes,
      scope: safeJsonParse(row.scope, {} as AlertRule['scope']),
      notifyChannels: safeJsonParse(row.notifyChannels, [] as string[]),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

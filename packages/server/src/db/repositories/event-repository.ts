/**
 * Event repository — CRUD operations for events table.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, gte, lte, desc, asc, sql, count as drizzleCount } from 'drizzle-orm';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent, EventQuery, EventQueryResult, ChainEvent } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { events, sessions, agents } from '../schema.sqlite.js';
import { HashChainError } from '../errors.js';
import { buildEventConditions, mapEventRow, safeJsonParse } from '../shared/query-helpers.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('EventRepository');

export class EventRepository {
  constructor(private db: SqliteDb) {}

  private warnIfNoTenant(method: string, tenantId?: string): void {
    if (tenantId === undefined) {
      log.warn(
        `${method}() called without tenantId — query is unscoped. ` +
          `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
      );
    }
  }

  insertEvents(
    eventList: AgentLensEvent[],
    handleSessionUpdate: (tx: any, event: AgentLensEvent, tenantId: string) => void,
    handleAgentUpsert: (tx: any, event: AgentLensEvent, tenantId: string) => void,
  ): void {
    if (eventList.length === 0) return;

    this.db.transaction((tx) => {
      const firstEvent = eventList[0]!;
      const tenantId = firstEvent.tenantId ?? 'default';

      const existingFirst = tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, firstEvent.id))
        .get();

      if (!existingFirst) {
        const lastStoredEvent = tx
          .select({ hash: events.hash })
          .from(events)
          .where(and(eq(events.sessionId, firstEvent.sessionId), eq(events.tenantId, tenantId)))
          .orderBy(desc(events.timestamp), desc(events.id))
          .limit(1)
          .get();

        const lastStoredHash = lastStoredEvent?.hash ?? null;

        if (firstEvent.prevHash !== lastStoredHash) {
          throw new HashChainError(
            `Chain continuity broken: event ${firstEvent.id} has prevHash=${firstEvent.prevHash} but last stored hash is ${lastStoredHash}`,
          );
        }
      }

      for (let i = 0; i < eventList.length; i++) {
        const event = eventList[i]!;

        if (i > 0) {
          const prevEvent = eventList[i - 1]!;
          if (event.prevHash !== prevEvent.hash) {
            throw new HashChainError(
              `Chain continuity broken within batch: event ${event.id} has prevHash=${event.prevHash} but previous event hash is ${prevEvent.hash}`,
            );
          }
        }

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
        const tenantId = event.tenantId ?? 'default';

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
            tenantId,
          })
          .onConflictDoNothing({ target: events.id })
          .run();

        handleSessionUpdate(tx, event, tenantId);
        handleAgentUpsert(tx, event, tenantId);
      }
    });
  }

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    const orderDir = query.order === 'asc' ? asc : desc;

    const conditions = buildEventConditions(query);

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
      events: rows.map(mapEventRow),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async getEvent(id: string, tenantId?: string): Promise<AgentLensEvent | null> {
    this.warnIfNoTenant('getEvent', tenantId);
    const conditions = [eq(events.id, id)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const row = this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .get();

    return row ? mapEventRow(row) : null;
  }

  async getSessionTimeline(sessionId: string, tenantId?: string): Promise<AgentLensEvent[]> {
    const conditions = [eq(events.sessionId, sessionId)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const rows = this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.timestamp))
      .all();

    return rows.map(mapEventRow);
  }

  async getLastEventHash(sessionId: string, tenantId?: string): Promise<string | null> {
    const conditions = [eq(events.sessionId, sessionId)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const row = this.db
      .select({ hash: events.hash })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.timestamp), desc(events.id))
      .limit(1)
      .get();

    return row?.hash ?? null;
  }

  async countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number> {
    const conditions = buildEventConditions(query);

    const result = this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return result?.count ?? 0;
  }

  /**
   * Get events for a session in batches, ordered by (timestamp ASC, id ASC).
   * Returns ChainEvent objects suitable for hash chain verification.
   */
  getSessionEventsBatch(
    sessionId: string,
    tenantId: string,
    offset: number,
    limit: number,
  ): ChainEvent[] {
    const rows = this.db
      .select()
      .from(events)
      .where(and(
        eq(events.tenantId, tenantId),
        eq(events.sessionId, sessionId),
      ))
      .orderBy(asc(events.timestamp), asc(events.id))
      .limit(limit)
      .offset(offset)
      .all();

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.sessionId,
      agentId: row.agentId,
      eventType: row.eventType,
      severity: row.severity,
      payload: safeJsonParse(row.payload, {}),
      metadata: safeJsonParse(row.metadata, {}),
      prevHash: row.prevHash,
      hash: row.hash,
    }));
  }

  /**
   * Get distinct session IDs that have at least one event in [from, to].
   */
  getSessionIdsInRange(
    tenantId: string,
    from: string,
    to: string,
  ): string[] {
    const rows = this.db
      .selectDistinct({ sessionId: events.sessionId })
      .from(events)
      .where(and(
        eq(events.tenantId, tenantId),
        gte(events.timestamp, from),
        lte(events.timestamp, to),
      ))
      .all();

    return rows.map(r => r.sessionId);
  }

  async countEventsBatch(
    query: { agentId: string; from: string; to: string; tenantId?: string },
  ): Promise<{ total: number; error: number; critical: number; toolError: number }> {
    const conditions = [];
    if (query.tenantId) conditions.push(eq(events.tenantId, query.tenantId));
    conditions.push(eq(events.agentId, query.agentId));
    conditions.push(gte(events.timestamp, query.from));
    conditions.push(lte(events.timestamp, query.to));

    const result = this.db
      .select({
        total: drizzleCount(),
        error: sql<number>`SUM(CASE WHEN ${events.severity} = 'error' THEN 1 ELSE 0 END)`,
        critical: sql<number>`SUM(CASE WHEN ${events.severity} = 'critical' THEN 1 ELSE 0 END)`,
        toolError: sql<number>`SUM(CASE WHEN ${events.eventType} = 'tool_error' THEN 1 ELSE 0 END)`,
      })
      .from(events)
      .where(and(...conditions))
      .get();

    return {
      total: result?.total ?? 0,
      error: result?.error ?? 0,
      critical: result?.critical ?? 0,
      toolError: result?.toolError ?? 0,
    };
  }
}

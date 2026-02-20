/**
 * Session repository — CRUD operations for sessions table.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, gte, lte, desc, sql, count as drizzleCount } from 'drizzle-orm';
import type { AgentLensEvent, Session, SessionQuery } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { events, sessions } from '../schema.sqlite.js';
import { buildSessionConditions, mapSessionRow } from '../shared/query-helpers.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('SessionRepository');

export class SessionRepository {
  constructor(private db: SqliteDb) {}

  private warnIfNoTenant(method: string, tenantId?: string): void {
    if (tenantId === undefined) {
      log.warn(
        `${method}() called without tenantId — query is unscoped. ` +
          `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
      );
    }
  }

  handleSessionUpdate(
    tx: Parameters<Parameters<SqliteDb['transaction']>[0]>[0],
    event: AgentLensEvent,
    tenantId: string,
  ): void {
    if (event.eventType === 'session_started') {
      const payload = event.payload as Record<string, unknown>;
      const tags = (payload.tags as string[]) ?? [];
      const agentName = (payload.agentName as string) ?? undefined;

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
          tenantId,
        })
        .onConflictDoUpdate({
          target: [sessions.id, sessions.tenantId],
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
        tenantId,
      })
      .onConflictDoNothing({ target: [sessions.id, sessions.tenantId] })
      .run();

    // Build incremental updates
    const isToolCall = event.eventType === 'tool_call';
    const isError =
      event.severity === 'error' ||
      event.severity === 'critical' ||
      event.eventType === 'tool_error';
    const isCost = event.eventType === 'cost_tracked';
    const isLlmResponse = event.eventType === 'llm_response';
    const costPayload = event.payload as Record<string, unknown>;
    const costUsd = isCost ? (Number(costPayload.costUsd) || 0) : 0;
    const llmCostUsd = isLlmResponse ? (Number(costPayload.costUsd) || 0) : 0;
    const llmUsage = isLlmResponse ? (costPayload.usage as Record<string, unknown> | undefined) : undefined;
    const llmInputTokens = llmUsage ? (Number(llmUsage.inputTokens) || 0) : 0;
    const llmOutputTokens = llmUsage ? (Number(llmUsage.outputTokens) || 0) : 0;

    if (event.eventType === 'session_ended') {
      const payload = event.payload as Record<string, unknown>;
      const reason = payload.reason as string | undefined;
      const status = reason === 'error' ? 'error' : 'completed';

      tx.update(sessions)
        .set({
          endedAt: event.timestamp,
          status: status as 'active' | 'completed' | 'error' | 'failed',
          eventCount: sql`${sessions.eventCount} + 1`,
          errorCount: isError
            ? sql`${sessions.errorCount} + 1`
            : sessions.errorCount,
        })
        .where(and(eq(sessions.id, event.sessionId), eq(sessions.tenantId, tenantId)))
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
          : isLlmResponse
            ? sql`${sessions.totalCostUsd} + ${llmCostUsd}`
            : sessions.totalCostUsd,
        llmCallCount: isLlmResponse
          ? sql`${sessions.llmCallCount} + 1`
          : sessions.llmCallCount,
        totalInputTokens: isLlmResponse
          ? sql`${sessions.totalInputTokens} + ${llmInputTokens}`
          : sessions.totalInputTokens,
        totalOutputTokens: isLlmResponse
          ? sql`${sessions.totalOutputTokens} + ${llmOutputTokens}`
          : sessions.totalOutputTokens,
      })
      .where(and(eq(sessions.id, event.sessionId), eq(sessions.tenantId, tenantId)))
      .run();
  }

  async upsertSession(session: Partial<Session> & { id: string }): Promise<void> {
    const tenantId = session.tenantId ?? 'default';
    const existing = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, session.id), eq(sessions.tenantId, tenantId)))
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
      if (session.llmCallCount !== undefined) updates.llmCallCount = session.llmCallCount;
      if (session.totalInputTokens !== undefined) updates.totalInputTokens = session.totalInputTokens;
      if (session.totalOutputTokens !== undefined) updates.totalOutputTokens = session.totalOutputTokens;
      if (session.tags !== undefined) updates.tags = JSON.stringify(session.tags);

      if (Object.keys(updates).length > 0) {
        this.db
          .update(sessions)
          .set(updates)
          .where(and(eq(sessions.id, session.id), eq(sessions.tenantId, tenantId)))
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
          llmCallCount: session.llmCallCount ?? 0,
          totalInputTokens: session.totalInputTokens ?? 0,
          totalOutputTokens: session.totalOutputTokens ?? 0,
          tags: JSON.stringify(session.tags ?? []),
          tenantId,
        })
        .run();
    }
  }

  async querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }> {
    this.warnIfNoTenant('querySessions', query.tenantId);
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;

    const conditions = buildSessionConditions(query);

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
      sessions: rows.map(mapSessionRow),
      total: totalResult?.count ?? 0,
    };
  }

  async getSession(id: string, tenantId?: string): Promise<Session | null> {
    const conditions = [eq(sessions.id, id)];
    if (tenantId) conditions.push(eq(sessions.tenantId, tenantId));

    const row = this.db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .get();

    return row ? mapSessionRow(row) : null;
  }

  async sumSessionCost(
    query: { agentId: string; from: string; tenantId?: string },
  ): Promise<number> {
    const conditions = [];
    if (query.tenantId) conditions.push(eq(sessions.tenantId, query.tenantId));
    conditions.push(eq(sessions.agentId, query.agentId));
    conditions.push(gte(sessions.startedAt, query.from));

    const result = this.db
      .select({ total: sql<number>`COALESCE(SUM(${sessions.totalCostUsd}), 0)` })
      .from(sessions)
      .where(and(...conditions))
      .get();

    return result?.total ?? 0;
  }
}

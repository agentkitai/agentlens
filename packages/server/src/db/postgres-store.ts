/**
 * PostgreSQL implementation of IEventStore.
 *
 * Uses Drizzle ORM with postgres.js driver and the Postgres schema
 * (jsonb columns, native PG functions).
 */

import { eq, and, gte, lte, desc, asc, sql, inArray, count as drizzleCount } from 'drizzle-orm';
import { computeEventHash } from '@agentlensai/core';
import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  AlertRule,
  AlertHistory,
} from '@agentlensai/core';
import type { IEventStore, AnalyticsResult, StorageStats } from '@agentlensai/core';
import type { PostgresDb } from './index.js';
import {
  events,
  sessions,
  agents,
  alertRules,
  alertHistory,
} from './schema.postgres.js';
import { HashChainError, NotFoundError } from './errors.js';
import { createLogger } from '../lib/logger.js';
import { withRetry } from '../lib/db-resilience.js';

const log = createLogger('PostgresEventStore');

// ─── Helpers ────────────────────────────────────────────────

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return fallback;
}

/** Build event WHERE conditions for Postgres schema. */
function buildEventConditions(query: Omit<EventQuery, 'limit' | 'offset'>) {
  const conditions = [];
  if (query.tenantId) conditions.push(eq(events.tenantId, query.tenantId));
  if (query.sessionId) conditions.push(eq(events.sessionId, query.sessionId));
  if (query.agentId) conditions.push(eq(events.agentId, query.agentId));
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
  if (query.from) conditions.push(gte(events.timestamp, query.from));
  if (query.to) conditions.push(lte(events.timestamp, query.to));
  if (query.search) {
    const searchTerm = query.search.slice(0, 500);
    const escaped = searchTerm
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    // Cast jsonb payload to text for LIKE search
    conditions.push(sql`${events.payload}::text LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
  }
  return conditions;
}

/** Build session WHERE conditions for Postgres schema. */
function buildSessionConditions(query: SessionQuery) {
  const conditions = [];
  if (query.tenantId) conditions.push(eq(sessions.tenantId, query.tenantId));
  if (query.agentId) conditions.push(eq(sessions.agentId, query.agentId));
  if (query.status) {
    if (Array.isArray(query.status)) {
      if (query.status.length === 1) conditions.push(eq(sessions.status, query.status[0]));
      else if (query.status.length > 1) conditions.push(inArray(sessions.status, query.status));
    } else {
      conditions.push(eq(sessions.status, query.status));
    }
  }
  if (query.from) conditions.push(gte(sessions.startedAt, query.from));
  if (query.to) conditions.push(lte(sessions.startedAt, query.to));
  if (query.tags && query.tags.length > 0) {
    // Use jsonb ?| operator for tag matching (OR semantics)
    conditions.push(sql`${sessions.tags} ?| array[${sql.join(query.tags.map(t => sql`${t}`), sql`, `)}]`);
  }
  return conditions;
}

/** Map PG event row → AgentLensEvent (jsonb columns are already objects). */
function mapEventRow(row: typeof events.$inferSelect): AgentLensEvent {
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
    tenantId: row.tenantId,
  };
}

function mapSessionRow(row: typeof sessions.$inferSelect): Session {
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
    llmCallCount: row.llmCallCount,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    tags: safeJsonParse(row.tags, [] as string[]),
    tenantId: row.tenantId,
  };
}

function mapAgentRow(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sessionCount: row.sessionCount,
    tenantId: row.tenantId,
    modelOverride: row.modelOverride ?? undefined,
    pausedAt: row.pausedAt ?? undefined,
    pauseReason: row.pauseReason ?? undefined,
  };
}

function mapAlertRuleRow(row: typeof alertRules.$inferSelect): AlertRule {
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
    tenantId: row.tenantId,
  };
}

function warnIfNoTenant(method: string, tenantId?: string): void {
  if (tenantId === undefined) {
    log.warn(
      `${method}() called without tenantId — query is unscoped. ` +
        `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
    );
  }
}

// ─── PostgresEventStore ─────────────────────────────────────

export class PostgresEventStore implements IEventStore {
  constructor(private db: PostgresDb) {}

  // ─── Events ────────────────────────────────────────────────

  async insertEvents(eventList: AgentLensEvent[]): Promise<void> {
    if (eventList.length === 0) return;

    await withRetry(() => this.db.transaction(async (tx) => {
      const firstEvent = eventList[0]!;
      const tenantId = firstEvent.tenantId ?? 'default';

      // Check if first event already exists
      const [existingFirst] = await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, firstEvent.id))
        .limit(1);

      if (!existingFirst) {
        // Verify chain continuity
        const [lastStoredEvent] = await tx
          .select({ hash: events.hash })
          .from(events)
          .where(and(eq(events.sessionId, firstEvent.sessionId), eq(events.tenantId, tenantId)))
          .orderBy(desc(events.timestamp), desc(events.id))
          .limit(1);

        const lastStoredHash = lastStoredEvent?.hash ?? null;
        if (firstEvent.prevHash !== lastStoredHash) {
          throw new HashChainError(
            `Chain continuity broken: event ${firstEvent.id} has prevHash=${firstEvent.prevHash} but last stored hash is ${lastStoredHash}`,
          );
        }
      }

      // Verify hashes within batch
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

      // Insert events and update sessions/agents
      for (const event of eventList) {
        const evTenantId = event.tenantId ?? 'default';

        await tx
          .insert(events)
          .values({
            id: event.id,
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            agentId: event.agentId,
            eventType: event.eventType,
            severity: event.severity,
            payload: event.payload,
            metadata: event.metadata,
            prevHash: event.prevHash,
            hash: event.hash,
            tenantId: evTenantId,
          })
          .onConflictDoNothing({ target: events.id });

        // Handle session update
        await this.handleSessionUpdate(tx, event, evTenantId);

        // Handle agent upsert
        await this.handleAgentUpsert(tx, event, evTenantId);
      }
    }));
  }

  private async handleSessionUpdate(tx: any, event: AgentLensEvent, tenantId: string): Promise<void> {
    if (event.eventType === 'session_started') {
      const payload = event.payload as Record<string, unknown>;
      const tags = (payload.tags as string[]) ?? [];
      const agentName = (payload.agentName as string) ?? undefined;

      await tx
        .insert(sessions)
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
          tags: tags,
          tenantId,
        })
        .onConflictDoUpdate({
          target: [sessions.id, sessions.tenantId],
          set: {
            agentName: agentName ?? sql`coalesce(${sessions.agentName}, NULL)`,
            status: 'active',
            eventCount: sql`${sessions.eventCount} + 1`,
            tags: tags.length > 0 ? tags : sql`${sessions.tags}`,
          },
        });
      return;
    }

    // Ensure session exists
    await tx
      .insert(sessions)
      .values({
        id: event.sessionId,
        agentId: event.agentId,
        startedAt: event.timestamp,
        status: 'active',
        eventCount: 0,
        toolCallCount: 0,
        errorCount: 0,
        totalCostUsd: 0,
        tags: [],
        tenantId,
      })
      .onConflictDoNothing({ target: [sessions.id, sessions.tenantId] });

    const isToolCall = event.eventType === 'tool_call';
    const isError = event.severity === 'error' || event.severity === 'critical' || event.eventType === 'tool_error';
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

      await tx
        .update(sessions)
        .set({
          endedAt: event.timestamp,
          status,
          eventCount: sql`${sessions.eventCount} + 1`,
          errorCount: isError ? sql`${sessions.errorCount} + 1` : sessions.errorCount,
        })
        .where(and(eq(sessions.id, event.sessionId), eq(sessions.tenantId, tenantId)));
      return;
    }

    await tx
      .update(sessions)
      .set({
        eventCount: sql`${sessions.eventCount} + 1`,
        toolCallCount: isToolCall ? sql`${sessions.toolCallCount} + 1` : sessions.toolCallCount,
        errorCount: isError ? sql`${sessions.errorCount} + 1` : sessions.errorCount,
        totalCostUsd: isCost
          ? sql`${sessions.totalCostUsd} + ${costUsd}`
          : isLlmResponse
            ? sql`${sessions.totalCostUsd} + ${llmCostUsd}`
            : sessions.totalCostUsd,
        llmCallCount: isLlmResponse ? sql`${sessions.llmCallCount} + 1` : sessions.llmCallCount,
        totalInputTokens: isLlmResponse ? sql`${sessions.totalInputTokens} + ${llmInputTokens}` : sessions.totalInputTokens,
        totalOutputTokens: isLlmResponse ? sql`${sessions.totalOutputTokens} + ${llmOutputTokens}` : sessions.totalOutputTokens,
      })
      .where(and(eq(sessions.id, event.sessionId), eq(sessions.tenantId, tenantId)));
  }

  private async handleAgentUpsert(tx: any, event: AgentLensEvent, tenantId: string): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const agentName = (payload.agentName as string) ?? event.agentId;

    await tx
      .insert(agents)
      .values({
        id: event.agentId,
        name: agentName,
        firstSeenAt: event.timestamp,
        lastSeenAt: event.timestamp,
        sessionCount: event.eventType === 'session_started' ? 1 : 0,
        tenantId,
      })
      .onConflictDoUpdate({
        target: [agents.id, agents.tenantId],
        set: {
          lastSeenAt: event.timestamp,
          sessionCount:
            event.eventType === 'session_started'
              ? sql`${agents.sessionCount} + 1`
              : agents.sessionCount,
        },
      });
  }

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    const orderDir = query.order === 'asc' ? asc : desc;
    const conditions = buildEventConditions(query);

    const rows = await this.db
      .select()
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderDir(events.timestamp))
      .limit(limit)
      .offset(offset);

    const total = await this.countEvents(query);

    return {
      events: rows.map(mapEventRow),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async getEvent(id: string, tenantId?: string): Promise<AgentLensEvent | null> {
    warnIfNoTenant('getEvent', tenantId);
    const conditions = [eq(events.id, id)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const [row] = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .limit(1);

    return row ? mapEventRow(row) : null;
  }

  async getSessionTimeline(sessionId: string, tenantId?: string): Promise<AgentLensEvent[]> {
    const conditions = [eq(events.sessionId, sessionId)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.timestamp));

    return rows.map(mapEventRow);
  }

  async getLastEventHash(sessionId: string, tenantId?: string): Promise<string | null> {
    const conditions = [eq(events.sessionId, sessionId)];
    if (tenantId) conditions.push(eq(events.tenantId, tenantId));

    const [row] = await this.db
      .select({ hash: events.hash })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.timestamp), desc(events.id))
      .limit(1);

    return row?.hash ?? null;
  }

  async countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number> {
    const conditions = buildEventConditions(query);

    const [result] = await this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return result?.count ?? 0;
  }

  async countEventsBatch(
    query: { agentId: string; from: string; to: string; tenantId?: string },
  ): Promise<{ total: number; error: number; critical: number; toolError: number }> {
    const conditions = [];
    if (query.tenantId) conditions.push(eq(events.tenantId, query.tenantId));
    conditions.push(eq(events.agentId, query.agentId));
    conditions.push(gte(events.timestamp, query.from));
    conditions.push(lte(events.timestamp, query.to));

    // Use PG FILTER clause for efficiency
    const [result] = await this.db
      .select({
        total: drizzleCount(),
        error: sql<number>`count(*) FILTER (WHERE ${events.severity} = 'error')`,
        critical: sql<number>`count(*) FILTER (WHERE ${events.severity} = 'critical')`,
        toolError: sql<number>`count(*) FILTER (WHERE ${events.eventType} = 'tool_error')`,
      })
      .from(events)
      .where(and(...conditions));

    return {
      total: result?.total ?? 0,
      error: Number(result?.error ?? 0),
      critical: Number(result?.critical ?? 0),
      toolError: Number(result?.toolError ?? 0),
    };
  }

  // ─── Sessions ──────────────────────────────────────────────

  async upsertSession(session: Partial<Session> & { id: string }): Promise<void> {
    await withRetry(async () => {
    const tenantId = session.tenantId ?? 'default';
    const [existing] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, session.id), eq(sessions.tenantId, tenantId)))
      .limit(1);

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
      if (session.tags !== undefined) updates.tags = session.tags;

      if (Object.keys(updates).length > 0) {
        await this.db
          .update(sessions)
          .set(updates)
          .where(and(eq(sessions.id, session.id), eq(sessions.tenantId, tenantId)));
      }
    } else {
      await this.db.insert(sessions).values({
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
        tags: session.tags ?? [],
        tenantId,
      });
    }
    });
  }

  async querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }> {
    warnIfNoTenant('querySessions', query.tenantId);
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    const conditions = buildSessionConditions(query);

    const rows = await this.db
      .select()
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await this.db
      .select({ count: drizzleCount() })
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      sessions: rows.map(mapSessionRow),
      total: totalResult?.count ?? 0,
    };
  }

  async getSession(id: string, tenantId?: string): Promise<Session | null> {
    const conditions = [eq(sessions.id, id)];
    if (tenantId) conditions.push(eq(sessions.tenantId, tenantId));

    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .limit(1);

    return row ? mapSessionRow(row) : null;
  }

  async sumSessionCost(
    query: { agentId: string; from: string; tenantId?: string },
  ): Promise<number> {
    const conditions = [];
    if (query.tenantId) conditions.push(eq(sessions.tenantId, query.tenantId));
    conditions.push(eq(sessions.agentId, query.agentId));
    conditions.push(gte(sessions.startedAt, query.from));

    const [result] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${sessions.totalCostUsd}), 0)` })
      .from(sessions)
      .where(and(...conditions));

    return result?.total ?? 0;
  }

  // ─── Agents ────────────────────────────────────────────────

  async upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void> {
    const tenantId = agent.tenantId ?? 'default';
    const [existing] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agent.id), eq(agents.tenantId, tenantId)))
      .limit(1);

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (agent.name !== undefined) updates.name = agent.name;
      if (agent.description !== undefined) updates.description = agent.description;
      if (agent.lastSeenAt !== undefined) updates.lastSeenAt = agent.lastSeenAt;
      if (agent.sessionCount !== undefined) updates.sessionCount = agent.sessionCount;

      if (Object.keys(updates).length > 0) {
        await this.db
          .update(agents)
          .set(updates)
          .where(and(eq(agents.id, agent.id), eq(agents.tenantId, tenantId)));
      }
    } else {
      const now = new Date().toISOString();
      await this.db.insert(agents).values({
        id: agent.id,
        name: agent.name ?? agent.id,
        description: agent.description,
        firstSeenAt: agent.firstSeenAt ?? now,
        lastSeenAt: agent.lastSeenAt ?? now,
        sessionCount: agent.sessionCount ?? 0,
        tenantId,
      });
    }
  }

  async pauseAgent(tenantId: string, agentId: string, reason: string): Promise<boolean> {
    const result = await this.db
      .update(agents)
      .set({ pausedAt: new Date().toISOString(), pauseReason: reason })
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
    return (result as any).rowCount > 0;
  }

  async unpauseAgent(tenantId: string, agentId: string, clearModelOverride?: boolean): Promise<boolean> {
    const updates: Record<string, unknown> = { pausedAt: null, pauseReason: null };
    if (clearModelOverride) updates.modelOverride = null;
    const result = await this.db
      .update(agents)
      .set(updates)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
    return (result as any).rowCount > 0;
  }

  async setModelOverride(tenantId: string, agentId: string, model: string): Promise<boolean> {
    const result = await this.db
      .update(agents)
      .set({ modelOverride: model })
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
    return (result as any).rowCount > 0;
  }

  async listAgents(tenantId?: string): Promise<Agent[]> {
    warnIfNoTenant('listAgents', tenantId);
    const conditions = tenantId ? [eq(agents.tenantId, tenantId)] : [];

    const rows = await this.db
      .select()
      .from(agents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agents.lastSeenAt));

    return rows.map(mapAgentRow);
  }

  async getAgent(id: string, tenantId?: string): Promise<Agent | null> {
    const conditions = [eq(agents.id, id)];
    if (tenantId) conditions.push(eq(agents.tenantId, tenantId));

    const [row] = await this.db
      .select()
      .from(agents)
      .where(and(...conditions))
      .limit(1);

    return row ? mapAgentRow(row) : null;
  }

  // ─── Alerts ────────────────────────────────────────────────

  async createAlertRule(rule: AlertRule): Promise<void> {
    await this.db.insert(alertRules).values({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      condition: rule.condition,
      threshold: rule.threshold,
      windowMinutes: rule.windowMinutes,
      scope: rule.scope,
      notifyChannels: rule.notifyChannels,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      tenantId: rule.tenantId ?? 'default',
    });
  }

  async updateAlertRule(id: string, updates: Partial<AlertRule>, tenantId?: string): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
    if (updates.condition !== undefined) setValues.condition = updates.condition;
    if (updates.threshold !== undefined) setValues.threshold = updates.threshold;
    if (updates.windowMinutes !== undefined) setValues.windowMinutes = updates.windowMinutes;
    if (updates.scope !== undefined) setValues.scope = updates.scope;
    if (updates.notifyChannels !== undefined) setValues.notifyChannels = updates.notifyChannels;
    if (updates.updatedAt !== undefined) setValues.updatedAt = updates.updatedAt;

    const whereConditions = [eq(alertRules.id, id)];
    if (tenantId) whereConditions.push(eq(alertRules.tenantId, tenantId));

    if (Object.keys(setValues).length === 0) {
      const [existing] = await this.db
        .select({ id: alertRules.id })
        .from(alertRules)
        .where(and(...whereConditions))
        .limit(1);
      if (!existing) throw new NotFoundError(`Alert rule not found: ${id}`);
      return;
    }

    const result = await this.db
      .update(alertRules)
      .set(setValues)
      .where(and(...whereConditions));

    if ((result as any).rowCount === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async deleteAlertRule(id: string, tenantId?: string): Promise<void> {
    const whereConditions = [eq(alertRules.id, id)];
    if (tenantId) whereConditions.push(eq(alertRules.tenantId, tenantId));

    const result = await this.db.delete(alertRules).where(and(...whereConditions));
    if ((result as any).rowCount === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async listAlertRules(tenantId?: string): Promise<AlertRule[]> {
    warnIfNoTenant('listAlertRules', tenantId);
    const conditions = tenantId ? [eq(alertRules.tenantId, tenantId)] : [];
    const rows = await this.db
      .select()
      .from(alertRules)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return rows.map(mapAlertRuleRow);
  }

  async getAlertRule(id: string, tenantId?: string): Promise<AlertRule | null> {
    const conditions = [eq(alertRules.id, id)];
    if (tenantId) conditions.push(eq(alertRules.tenantId, tenantId));

    const [row] = await this.db
      .select()
      .from(alertRules)
      .where(and(...conditions))
      .limit(1);

    return row ? mapAlertRuleRow(row) : null;
  }

  async insertAlertHistory(entry: AlertHistory): Promise<void> {
    await this.db.insert(alertHistory).values({
      id: entry.id,
      ruleId: entry.ruleId,
      triggeredAt: entry.triggeredAt,
      resolvedAt: entry.resolvedAt ?? null,
      currentValue: entry.currentValue,
      threshold: entry.threshold,
      message: entry.message,
      tenantId: entry.tenantId ?? 'default',
    });
  }

  async listAlertHistory(opts?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
    tenantId?: string;
  }): Promise<{ entries: AlertHistory[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 50, 500);
    const offset = opts?.offset ?? 0;

    const conditions = [];
    if (opts?.ruleId) conditions.push(eq(alertHistory.ruleId, opts.ruleId));
    if (opts?.tenantId) conditions.push(eq(alertHistory.tenantId, opts.tenantId));

    const rows = await this.db
      .select()
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alertHistory.triggeredAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await this.db
      .select({ count: drizzleCount() })
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      entries: rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        triggeredAt: row.triggeredAt,
        resolvedAt: row.resolvedAt ?? undefined,
        currentValue: row.currentValue,
        threshold: row.threshold,
        message: row.message,
        tenantId: row.tenantId,
      })),
      total: totalResult?.count ?? 0,
    };
  }

  // ─── Analytics & Stats ─────────────────────────────────────

  async getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
    tenantId?: string;
  }): Promise<AnalyticsResult> {
    warnIfNoTenant('getAnalytics', params.tenantId);

    // PG: use to_char + date_trunc instead of strftime
    const truncUnit = params.granularity === 'hour' ? 'hour' : params.granularity === 'day' ? 'day' : 'week';
    const formatStr =
      params.granularity === 'week'
        ? 'IYYY-IW'  // ISO year-week
        : params.granularity === 'day'
          ? 'YYYY-MM-DD"T"00:00:00"Z"'
          : 'YYYY-MM-DD"T"HH24:00:00"Z"';

    const bucketResult = await this.db.execute<{
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
          to_char(date_trunc(${truncUnit}, timestamp::timestamp), ${formatStr}) as bucket,
          COUNT(*)::int as "eventCount",
          count(*) FILTER (WHERE event_type = 'tool_call')::int as "toolCallCount",
          count(*) FILTER (WHERE severity IN ('error', 'critical') OR event_type = 'tool_error')::int as "errorCount",
          COUNT(DISTINCT session_id)::int as "uniqueSessions",
          COALESCE(AVG((payload->>'durationMs')::double precision) FILTER (WHERE event_type = 'tool_response'), 0)::double precision as "avgLatencyMs",
          COALESCE(SUM((payload->>'costUsd')::double precision) FILTER (WHERE event_type = 'cost_tracked'), 0)::double precision as "totalCostUsd"
        FROM events
        WHERE timestamp >= ${params.from}
          AND timestamp <= ${params.to}
          ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
          ${params.tenantId ? sql`AND tenant_id = ${params.tenantId}` : sql``}
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
    );
    const bucketRows = [...bucketResult];

    const totalsResult = await this.db.execute<{
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
          COUNT(*)::int as "eventCount",
          count(*) FILTER (WHERE event_type = 'tool_call')::int as "toolCallCount",
          count(*) FILTER (WHERE severity IN ('error', 'critical') OR event_type = 'tool_error')::int as "errorCount",
          COUNT(DISTINCT session_id)::int as "uniqueSessions",
          COUNT(DISTINCT agent_id)::int as "uniqueAgents",
          COALESCE(AVG((payload->>'durationMs')::double precision) FILTER (WHERE event_type = 'tool_response'), 0)::double precision as "avgLatencyMs",
          COALESCE(SUM((payload->>'costUsd')::double precision) FILTER (WHERE event_type = 'cost_tracked'), 0)::double precision as "totalCostUsd"
        FROM events
        WHERE timestamp >= ${params.from}
          AND timestamp <= ${params.to}
          ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
          ${params.tenantId ? sql`AND tenant_id = ${params.tenantId}` : sql``}
      `,
    );
    const totalsRow = totalsResult[0];

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

  async getStats(tenantId?: string): Promise<StorageStats> {
    const eventConditions = tenantId ? [eq(events.tenantId, tenantId)] : [];
    const sessionConditions = tenantId ? [eq(sessions.tenantId, tenantId)] : [];
    const agentConditions = tenantId ? [eq(agents.tenantId, tenantId)] : [];

    const [eventResult] = await this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(eventConditions.length > 0 ? and(...eventConditions) : undefined);

    const [sessionResult] = await this.db
      .select({ count: drizzleCount() })
      .from(sessions)
      .where(sessionConditions.length > 0 ? and(...sessionConditions) : undefined);

    const [agentResult] = await this.db
      .select({ count: drizzleCount() })
      .from(agents)
      .where(agentConditions.length > 0 ? and(...agentConditions) : undefined);

    const [oldest] = await this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .where(eventConditions.length > 0 ? and(...eventConditions) : undefined)
      .orderBy(asc(events.timestamp))
      .limit(1);

    const [newest] = await this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .where(eventConditions.length > 0 ? and(...eventConditions) : undefined)
      .orderBy(desc(events.timestamp))
      .limit(1);

    // Use pg_database_size for storage estimate
    const sizeQueryResult = await this.db.execute<{ size: number }>(
      sql`SELECT pg_database_size(current_database()) as size`,
    );
    const sizeResult = sizeQueryResult[0];

    return {
      totalEvents: eventResult?.count ?? 0,
      totalSessions: sessionResult?.count ?? 0,
      totalAgents: agentResult?.count ?? 0,
      oldestEvent: oldest?.timestamp,
      newestEvent: newest?.timestamp,
      storageSizeBytes: Number(sizeResult?.size ?? 0),
    };
  }

  // ─── Maintenance ───────────────────────────────────────────

  async applyRetention(
    olderThan: string,
    tenantId?: string,
  ): Promise<{ deletedCount: number }> {
    const countConditions = [lte(events.timestamp, olderThan)];
    if (tenantId) countConditions.push(eq(events.tenantId, tenantId));

    const [countResult] = await this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(and(...countConditions));

    const deletedCount = countResult?.count ?? 0;
    if (deletedCount === 0) return { deletedCount: 0 };

    await this.db.transaction(async (tx) => {
      if (tenantId) {
        await tx
          .delete(events)
          .where(and(lte(events.timestamp, olderThan), eq(events.tenantId, tenantId)));

        await tx.execute(sql`
          DELETE FROM sessions
          WHERE tenant_id = ${tenantId}
            AND id NOT IN (
              SELECT DISTINCT session_id FROM events WHERE tenant_id = ${tenantId}
            )
        `);
      } else {
        await tx.delete(events).where(lte(events.timestamp, olderThan));

        await tx.execute(sql`
          DELETE FROM sessions
          WHERE id NOT IN (SELECT DISTINCT session_id FROM events)
        `);
      }
    });

    return { deletedCount };
  }
}

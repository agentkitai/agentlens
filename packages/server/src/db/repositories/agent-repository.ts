/**
 * Agent repository — CRUD operations for agents table.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, desc, sql, count as drizzleCount } from 'drizzle-orm';
import type { AgentLensEvent, Agent } from '@agentkitai/agentlens-core';
import type { SqliteDb } from '../index.js';
import { agents, sessions } from '../schema.sqlite.js';
import { mapAgentRow } from '../shared/query-helpers.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('AgentRepository');

export class AgentRepository {
  constructor(private db: SqliteDb) {}

  private warnIfNoTenant(method: string, tenantId?: string): void {
    if (tenantId === undefined) {
      log.warn(
        `${method}() called without tenantId — query is unscoped. ` +
          `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
      );
    }
  }

  handleAgentUpsert(
    tx: Parameters<Parameters<SqliteDb['transaction']>[0]>[0],
    event: AgentLensEvent,
    tenantId: string,
  ): void {
    const payload = event.payload as Record<string, unknown>;
    const agentName = (payload.agentName as string) ?? event.agentId;

    tx.insert(agents)
      .values({
        id: event.agentId,
        name: agentName,
        firstSeenAt: event.timestamp,
        lastSeenAt: event.timestamp,
        sessionCount: event.eventType === 'session_started' ? 1 : 0,
        tenantId,
        orgId: event.orgId ?? 'default', // #147
        projectId: event.projectId ?? tenantId, // #147
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
      })
      .run();
  }

  async upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void> {
    const tenantId = agent.tenantId ?? 'default';
    const existing = this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agent.id), eq(agents.tenantId, tenantId)))
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
          .where(and(eq(agents.id, agent.id), eq(agents.tenantId, tenantId)))
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
          tenantId,
          orgId: 'default', // #147
          projectId: tenantId, // #147
        })
        .run();
    }
  }

  async pauseAgent(tenantId: string, agentId: string, reason: string): Promise<boolean> {
    const result = this.db
      .update(agents)
      .set({
        pausedAt: new Date().toISOString(),
        pauseReason: reason,
      })
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
      .run();
    return result.changes > 0;
  }

  async unpauseAgent(tenantId: string, agentId: string, clearModelOverride?: boolean): Promise<boolean> {
    const updates: Record<string, unknown> = {
      pausedAt: null,
      pauseReason: null,
    };
    if (clearModelOverride) {
      updates.modelOverride = null;
    }
    const result = this.db
      .update(agents)
      .set(updates)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
      .run();
    return result.changes > 0;
  }

  async setModelOverride(tenantId: string, agentId: string, model: string): Promise<boolean> {
    const result = this.db
      .update(agents)
      .set({ modelOverride: model })
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
      .run();
    return result.changes > 0;
  }

  async listAgents(tenantId?: string, orgId?: string, projectId?: string): Promise<Agent[]> {
    this.warnIfNoTenant('listAgents', tenantId);
    const conditions = tenantId ? [eq(agents.tenantId, tenantId)] : [];
    if (orgId) conditions.push(eq(agents.orgId, orgId));
    if (projectId) conditions.push(eq(agents.projectId, projectId));

    const rows = this.db
      .select()
      .from(agents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agents.lastSeenAt))
      .all();

    // sessionCount is derived from the sessions table (the source of truth), not
    // the denormalized agents.sessionCount counter — that counter is only bumped
    // by the SDK's session_started event, so OTLP-ingested agents (no
    // session_started) always read 0 despite having sessions.
    const counts = this.sessionCountsByAgent(tenantId, orgId, projectId);
    return rows.map((r) => ({ ...mapAgentRow(r), sessionCount: counts.get(r.id) ?? 0 }));
  }

  /** Actual session counts per agent, from the sessions table. */
  private sessionCountsByAgent(tenantId?: string, orgId?: string, projectId?: string): Map<string, number> {
    const conds = tenantId ? [eq(sessions.tenantId, tenantId)] : [];
    if (orgId) conds.push(eq(sessions.orgId, orgId));
    if (projectId) conds.push(eq(sessions.projectId, projectId));
    const rows = this.db
      .select({ agentId: sessions.agentId, n: drizzleCount() })
      .from(sessions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .groupBy(sessions.agentId)
      .all();
    return new Map(rows.map((r) => [r.agentId, Number(r.n)]));
  }

  async getAgent(id: string, tenantId?: string, orgId?: string, projectId?: string): Promise<Agent | null> {
    const conditions = [eq(agents.id, id)];
    if (tenantId) conditions.push(eq(agents.tenantId, tenantId));
    if (orgId) conditions.push(eq(agents.orgId, orgId));
    if (projectId) conditions.push(eq(agents.projectId, projectId));

    const row = this.db
      .select()
      .from(agents)
      .where(and(...conditions))
      .get();

    if (!row) return null;

    const sessConds = [eq(sessions.agentId, id)];
    if (tenantId) sessConds.push(eq(sessions.tenantId, tenantId));
    if (orgId) sessConds.push(eq(sessions.orgId, orgId));
    if (projectId) sessConds.push(eq(sessions.projectId, projectId));
    const sc = this.db
      .select({ n: drizzleCount() })
      .from(sessions)
      .where(and(...sessConds))
      .get();

    return { ...mapAgentRow(row), sessionCount: Number(sc?.n ?? 0) };
  }
}

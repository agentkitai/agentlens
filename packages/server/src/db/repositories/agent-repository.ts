/**
 * Agent repository — CRUD operations for agents table.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import type { AgentLensEvent, Agent } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { agents } from '../schema.sqlite.js';
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

  async listAgents(tenantId?: string): Promise<Agent[]> {
    this.warnIfNoTenant('listAgents', tenantId);
    const conditions = tenantId ? [eq(agents.tenantId, tenantId)] : [];

    const rows = this.db
      .select()
      .from(agents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agents.lastSeenAt))
      .all();

    return rows.map(mapAgentRow);
  }

  async getAgent(id: string, tenantId?: string): Promise<Agent | null> {
    const conditions = [eq(agents.id, id)];
    if (tenantId) conditions.push(eq(agents.tenantId, tenantId));

    const row = this.db
      .select()
      .from(agents)
      .where(and(...conditions))
      .get();

    return row ? mapAgentRow(row) : null;
  }
}

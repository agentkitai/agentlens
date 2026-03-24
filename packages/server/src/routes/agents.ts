/**
 * Agent Endpoints (Story 4.7 + B1 — Story 1.2)
 *
 * GET  /api/agents          — list all agents (with error rate from sessions)
 * GET  /api/agents/:id      — single agent
 * PUT  /api/agents/:id/unpause — unpause an agent (clear paused_at, pause_reason, optionally model_override)
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';

export function agentsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/agents — list all agents with computed error rates
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const agents = await tenantStore.listAgents();

    return c.json({ agents });
  });

  // PUT /api/agents/:id/unpause — Unpause an agent (B1 — Story 1.2)
  app.put('/:id/unpause', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');

    // Verify agent exists (tenant-scoped)
    const agent = await tenantStore.getAgent(id);
    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    // Parse optional body for clearModelOverride
    let clearModelOverride = false;
    try {
      const body = await c.req.json().catch(() => ({}));
      clearModelOverride = body?.clearModelOverride === true;
    } catch {
      // No body or invalid JSON — that's fine
    }

    // Unpause by clearing pause fields via dedicated method
    if ('unpauseAgent' in tenantStore && typeof tenantStore.unpauseAgent === 'function') {
      await (tenantStore as { unpauseAgent(agentId: string, clear: boolean): Promise<boolean> }).unpauseAgent(id, clearModelOverride);
    }

    // Return the updated agent
    const updated = await tenantStore.getAgent(id);
    return c.json(updated);
  });

  /**
   * @summary Get aggregated agent insights (Phase 2 — Feature 7)
   * @param {string} id — Agent name/ID (path)
   * @returns {200} `{ agent, totalSessions, avgScore, toolUsage, delegationCount, recentSessions, healthTrend }`
   * @throws {404} Agent not found
   */
  app.get('/:id/insights', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');
    const agent = await tenantStore.getAgent(id);

    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    // Fetch recent sessions for this agent
    const sessionsResult = await tenantStore.querySessions({
      agentId: id,
      limit: 20,
      offset: 0,
    });
    const sessions = sessionsResult.sessions ?? [];

    // Compute tool usage distribution and delegation count from events
    const toolUsage: Record<string, number> = {};
    let totalScore = 0;
    let scoreCount = 0;
    let delegationCount = 0;

    for (const session of sessions) {
      const eventsResult = await tenantStore.queryEvents({
        sessionId: session.id,
        limit: 200,
        offset: 0,
      });
      for (const event of eventsResult.events) {
        if (event.eventType === 'tool_call' || event.eventType === 'tool_response') {
          const toolName = (event.payload as Record<string, unknown>)?.toolName as string ?? 'unknown';
          toolUsage[toolName] = (toolUsage[toolName] ?? 0) + 1;
        }
        // Extract health scores and delegation counts from custom events
        if (event.eventType === 'custom') {
          const payload = event.payload as Record<string, unknown>;
          if (payload?.type === 'health_score' || payload?.type === 'health_check') {
            const score = payload?.score as number;
            if (typeof score === 'number') {
              totalScore += score;
              scoreCount++;
            }
          }
          if (payload?.type === 'delegation') {
            delegationCount++;
          }
        }
      }
    }

    // Health trend: last 10 sessions with their timestamps
    const healthTrend = sessions.slice(0, 10).map((s) => ({
      sessionId: s.id,
      startedAt: s.startedAt,
      score: (s as unknown as Record<string, unknown>).healthScore as number | undefined,
    }));

    return c.json({
      agent,
      totalSessions: agent.sessionCount ?? sessions.length,
      avgScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 100) / 100 : null,
      toolUsage,
      delegationCount,
      recentSessions: sessions.slice(0, 10).map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        eventCount: s.eventCount,
      })),
      healthTrend,
    });
  });

  // GET /api/agents/:id — single agent
  app.get('/:id', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');
    const agent = await tenantStore.getAgent(id);

    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    return c.json(agent);
  });

  return app;
}

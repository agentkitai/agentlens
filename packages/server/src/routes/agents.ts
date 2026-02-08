/**
 * Agent Endpoints (Story 4.7)
 *
 * GET /api/agents     — list all agents (with error rate from sessions)
 * GET /api/agents/:id — single agent
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';

export function agentsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/agents — list all agents with computed error rates
  app.get('/', async (c) => {
    const agents = await store.listAgents();

    // Enrich agents with error rate computed from their sessions
    const enriched = await Promise.all(
      agents.map(async (agent) => {
        const { sessions } = await store.querySessions({ agentId: agent.id, limit: 10000 });
        const totalErrors = sessions.reduce((sum, s) => sum + s.errorCount, 0);
        const totalEvents = sessions.reduce((sum, s) => sum + s.eventCount, 0);
        const errorRate = totalEvents > 0 ? totalErrors / totalEvents : 0;
        return { ...agent, errorRate };
      }),
    );

    return c.json({ agents: enriched });
  });

  // GET /api/agents/:id — single agent
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const agent = await store.getAgent(id);

    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    return c.json(agent);
  });

  return app;
}

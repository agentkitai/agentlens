/**
 * Agent Endpoints (Story 4.7)
 *
 * GET /api/agents     — list all agents
 * GET /api/agents/:id — single agent
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlens/core';
import type { AuthVariables } from '../middleware/auth.js';

export function agentsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/agents — list all agents
  app.get('/', async (c) => {
    const agents = await store.listAgents();
    return c.json({ agents });
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

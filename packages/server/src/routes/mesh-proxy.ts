/**
 * Mesh proxy routes — forwards requests to the agentkit-mesh HTTP server.
 */

import { Hono } from 'hono';
import type { MeshAdapter } from '../lib/mesh-client.js';
import { MeshError } from '../lib/mesh-client.js';

function handleError(err: unknown) {
  if (err instanceof MeshError) {
    return { status: err.statusCode, body: { error: err.message } };
  }
  return { status: 502, body: { error: 'Mesh service unavailable' } };
}

export function meshProxyRoutes(adapter: MeshAdapter) {
  const app = new Hono();

  app.get('/agents', async (c) => {
    try {
      return c.json(await adapter.listAgents());
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.post('/agents', async (c) => {
    try {
      const data = await c.req.json();
      return c.json(await adapter.registerAgent(data), 201);
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.get('/agents/:name', async (c) => {
    try {
      return c.json(await adapter.getAgent(c.req.param('name')));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.delete('/agents/:name', async (c) => {
    try {
      return c.json(await adapter.unregisterAgent(c.req.param('name')));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.post('/agents/:name/heartbeat', async (c) => {
    try {
      return c.json(await adapter.heartbeatAgent(c.req.param('name')));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.get('/discover', async (c) => {
    try {
      const query = c.req.query('query') ?? '';
      const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
      return c.json(await adapter.discover(query, limit));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.post('/delegate', async (c) => {
    try {
      const data = await c.req.json();
      return c.json(await adapter.delegate(data));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  app.get('/delegations', async (c) => {
    try {
      const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
      const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined;
      return c.json(await adapter.listDelegations(limit, offset));
    } catch (err) {
      const { status, body } = handleError(err);
      return c.json(body, status as 502);
    }
  });

  return app;
}

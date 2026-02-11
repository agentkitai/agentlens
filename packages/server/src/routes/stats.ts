/**
 * Stats Endpoint (Story 4.7)
 *
 * GET /api/stats — storage statistics
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';

export function statsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/stats — storage statistics
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const stats = await tenantStore.getStats();
    return c.json(stats);
  });

  // GET /api/stats/overview — consolidated overview metrics (Story S-3.2)
  app.get('/overview', async (c) => {
    const tenantStore = getTenantStore(store, c);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const todayIso = todayStart.toISOString();
    const yesterdayIso = yesterdayStart.toISOString();
    const nowIso = now.toISOString();

    // Run all queries in parallel
    const [
      eventsToday,
      eventsYesterday,
      errorsToday,
      errorsYesterday,
      sessionsToday,
      sessionsYesterday,
      agents,
    ] = await Promise.all([
      tenantStore.queryEvents({ from: todayIso, limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: yesterdayIso, to: todayIso, limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: todayIso, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: yesterdayIso, to: todayIso, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
      tenantStore.querySessions({ from: todayIso, limit: 1 }),
      tenantStore.querySessions({ from: yesterdayIso, to: todayIso, limit: 1 }),
      tenantStore.listAgents(),
    ]);

    const todayEventCount = eventsToday.total;
    const todayErrorCount = errorsToday.total;

    return c.json({
      eventsTodayCount: todayEventCount,
      eventsYesterdayCount: eventsYesterday.total,
      errorsTodayCount: todayErrorCount,
      errorsYesterdayCount: errorsYesterday.total,
      sessionsTodayCount: sessionsToday.total,
      sessionsYesterdayCount: sessionsYesterday.total,
      totalAgents: agents.length,
      errorRate: todayEventCount > 0 ? todayErrorCount / todayEventCount : 0,
    });
  });

  return app;
}

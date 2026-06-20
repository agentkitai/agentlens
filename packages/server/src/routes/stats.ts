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
  // Accepts optional ?from=&to= to scope metrics to a custom time range.
  // Without params, defaults to today vs yesterday.
  app.get('/overview', async (c) => {
    const tenantStore = getTenantStore(store, c);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Support custom time range via query params
    const qFrom = c.req.query('from');
    const qTo = c.req.query('to');

    const rangeFrom = qFrom || todayStart.toISOString();
    const rangeTo = qTo || now.toISOString();

    // Calculate the "previous" comparison bucket.
    let prevFrom: string;
    let prevTo: string;
    if (qFrom || qTo) {
      // Custom range: previous period of equal length immediately preceding it.
      const rangeMs = new Date(rangeTo).getTime() - new Date(rangeFrom).getTime();
      prevFrom = new Date(new Date(rangeFrom).getTime() - rangeMs).toISOString();
      prevTo = rangeFrom;
    } else {
      // Default (today-vs-yesterday): use the FULL prior calendar day so that
      // eventsYesterdayCount means "yesterday" regardless of the time of day.
      const prevStart = new Date(todayStart);
      prevStart.setDate(prevStart.getDate() - 1);
      prevFrom = prevStart.toISOString();
      prevTo = todayStart.toISOString();
    }

    // Run all queries in parallel
    const [
      eventsCurrent,
      eventsPrev,
      errorsCurrent,
      errorsPrev,
      sessionsCurrent,
      sessionsPrev,
      agents,
    ] = await Promise.all([
      tenantStore.queryEvents({ from: rangeFrom, to: rangeTo, limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: prevFrom, to: prevTo, limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: rangeFrom, to: rangeTo, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
      tenantStore.queryEvents({ from: prevFrom, to: prevTo, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
      tenantStore.querySessions({ from: rangeFrom, to: rangeTo, limit: 1 }),
      tenantStore.querySessions({ from: prevFrom, to: prevTo, limit: 1 }),
      tenantStore.listAgents(),
    ]);

    const currentEventCount = eventsCurrent.total;
    const currentErrorCount = errorsCurrent.total;

    return c.json({
      eventsTodayCount: currentEventCount,
      eventsYesterdayCount: eventsPrev.total,
      errorsTodayCount: currentErrorCount,
      errorsYesterdayCount: errorsPrev.total,
      sessionsTodayCount: sessionsCurrent.total,
      sessionsYesterdayCount: sessionsPrev.total,
      totalAgents: agents.length,
      errorRate: currentEventCount > 0 ? currentErrorCount / currentEventCount : 0,
    });
  });

  return app;
}

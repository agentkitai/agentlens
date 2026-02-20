/**
 * Route Coverage Audit Test [F2-S7]
 *
 * Discovers all registered Hono routes and verifies that every /api/*
 * route (except the explicit allowlist) returns 401 when accessed
 * without credentials. This is the "fail-closed verification" safety net.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp } from './test-helpers.js';

/** Routes that are intentionally public (no auth required) */
const PUBLIC_ALLOWLIST = new Set([
  'GET /api/health',
  'GET /api/config/features',
]);

/** Routes with their own auth model (excluded from 401 check) */
const SEPARATE_AUTH = new Set([
  '/api/events/ingest',
  '/api/stream',
]);

function shouldSkip(method: string, path: string): boolean {
  if (PUBLIC_ALLOWLIST.has(`${method} ${path}`)) return true;
  for (const prefix of SEPARATE_AUTH) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

describe('Route Coverage Auth Audit [F2-S7]', () => {
  it('all /api/* routes (except allowlisted) return 401 without auth', async () => {
    const { app } = await createTestApp();

    // Discover all routes registered on the Hono app
    const routes = (app as any).routes as Array<{ method: string; path: string }>;
    expect(routes).toBeDefined();
    expect(routes.length).toBeGreaterThan(0);

    // Filter to /api/* routes
    const apiRoutes = routes.filter((r: any) =>
      r.path.startsWith('/api') &&
      !r.path.includes('*') &&          // skip middleware patterns
      r.method !== 'ALL' &&              // skip catch-alls
      !shouldSkip(r.method, r.path)
    );

    // Deduplicate (method + path)
    const seen = new Set<string>();
    const uniqueRoutes = apiRoutes.filter((r: any) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    expect(uniqueRoutes.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const route of uniqueRoutes) {
      const res = await app.request(route.path, { method: route.method });
      if (res.status !== 401) {
        failures.push(`${route.method} ${route.path} → ${res.status} (expected 401)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `The following /api/* routes are NOT protected by auth:\n` +
        failures.map((f) => `  - ${f}`).join('\n'),
      );
    }
  });

  it('public routes are accessible without auth', async () => {
    const { app } = await createTestApp();

    const res1 = await app.request('/api/health');
    expect(res1.status).toBe(200);

    const res2 = await app.request('/api/config/features');
    expect(res2.status).toBe(200);
  });
});

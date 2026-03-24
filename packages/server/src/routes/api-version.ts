/**
 * API Version Endpoint (Feature 9 — API Contract Governance)
 *
 * GET /api/version — returns current API version and supported versions.
 * No auth required.
 */

import { Hono } from 'hono';
import { CURRENT_API_VERSION, SUPPORTED_API_VERSIONS } from '../lib/api-version.js';

export function apiVersionRoutes() {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({
      current: CURRENT_API_VERSION,
      supported: [...SUPPORTED_API_VERSIONS],
    });
  });

  return app;
}

/**
 * Server Info Endpoint (Feature 10, Story 10.1)
 *
 * GET /api/server-info — returns server version and available feature keys.
 * No auth required. Used by MCP auto-discovery.
 */

import { Hono } from 'hono';
import { getPricingProvenance } from '@agentlensai/core';

export function serverInfoRoutes(features: string[]) {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({
      version: process.env.npm_package_version ?? '0.12.1',
      features,
      // Dated, provenance-tracked pricing catalog (#100): source/date/version so
      // operators can see which prices reconstructed any no-SDK cost.
      pricing: getPricingProvenance(),
    });
  });

  return app;
}
